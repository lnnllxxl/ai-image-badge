(() => {
  if (globalThis.__aiImageBadgeLoaded) return;
  globalThis.__aiImageBadgeLoaded = true;

  const DEFAULTS = {
    enabled: true,
    urlAllowList: "",
    urlExcludeList: "",
    showLikely: true,
    showUndetermined: true,
    usePageHints: true,
    usePixelClassifier: true,
    localModel: "community",
    useGpuAcceleration: false,
    useFrequencyAnalysis: true,
    localLikelyThreshold: 50,
    localConfirmedThreshold: 90,
    useOpenAiProvenance: false,
    openAiMaxChecksPerPage: 20,
    scanCssBackgrounds: false,
    minWidth: 400,
    minHeight: 304
  };

  const records = new Map();
  const sourceCache = new Map();
  const metadataFallbackCache = new Map();
  const openAiSourceKeys = new Set();
  const openAiLogKeys = new Set();
  const openAiLogs = [];
  const MAX_OPENAI_LOG_ENTRIES = 50;
  const loadListeners = new WeakSet();
  const observedRoots = new WeakSet();
  const queuedUrls = new WeakMap();
  let settings = { ...DEFAULTS };
  let overlayHost;
  let overlayRoot;
  let scanTimer;
  let positionFrame;
  let inspectedCount = 0;
  let unavailableCount = 0;
  let lastScanAt = 0;
  let lastPageUrl = location.href;
  let detailSequence = 0;
  const viewportObserver = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        viewportObserver.unobserve(entry.target);
        const url = queuedUrls.get(entry.target);
        if (url) void inspectElement(entry.target, url);
      }
    }, { rootMargin: "700px" });

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response);
        });
      } catch {
        // 拡張機能の更新後に古いタブが残っていても未処理のPromiseエラーを出さない。
        resolve(null);
      }
    });
  }

  function testFixtureResult(element, url) {
    const provider = globalThis.ChatGptAiBadgeTestFixtures;
    if (!provider?.resultFor) return null;
    try {
      return provider.resultFor({ element, url, pageUrl: location.href }) || null;
    } catch {
      return null;
    }
  }

  function pageAccess() {
    return globalThis.ChatGptAiUrlRules?.evaluateUrlAccess(location.href, settings) || {
      allowed: true,
      reason: "rules-unavailable",
      matchedRule: ""
    };
  }

  function isPageActive() {
    return settings.enabled && pageAccess().allowed;
  }

  function createOverlay() {
    if (overlayHost?.isConnected) return;

    overlayHost = document.createElement("div");
    overlayHost.id = "__ai-image-badge-host";
    overlayHost.style.cssText = [
      "position:fixed",
      "inset:0",
      "width:0",
      "height:0",
      "z-index:2147483647",
      "pointer-events:none"
    ].join(";");
    overlayRoot = overlayHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .badge {
        all: initial;
        box-sizing: border-box;
        position: fixed;
        transform: translateX(-100%);
        display: inline-flex;
        align-items: center;
        height: 24px;
        padding: 0 8px;
        border: 1px solid rgba(255,255,255,.88);
        border-radius: 999px;
        color: #fff;
        background: #5b21b6;
        box-shadow: 0 2px 9px rgba(0,0,0,.28);
        font: 700 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
        letter-spacing: .02em;
        cursor: pointer;
        pointer-events: auto;
      }
      .badge.likely { background: #a16207; }
      .badge.undetermined { background: #475569; }
      .badge:focus-visible { outline: 3px solid #38bdf8; outline-offset: 2px; }
      .badge[hidden], .detail[hidden] { display: none; }
      .detail {
        all: initial;
        box-sizing: border-box;
        position: fixed;
        transform: translateX(-100%);
        width: max-content;
        max-width: min(320px, calc(100vw - 16px));
        padding: 10px 12px;
        border: 1px solid rgba(255,255,255,.2);
        border-radius: 10px;
        color: #f8fafc;
        background: rgba(15,23,42,.96);
        box-shadow: 0 8px 28px rgba(0,0,0,.36);
        font: 12px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
        pointer-events: auto;
      }
      .detail strong { color: #fff; font-weight: 750; }
      .detail p { margin: 4px 0 0; }
    `;
    overlayRoot.append(style);
    (document.documentElement || document.body).append(overlayHost);
  }

  function contextForImage(element) {
    const values = [
      element.getAttribute?.("alt"),
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-label")
    ];
    const figure = element.closest?.("figure");
    if (figure) values.push(figure.querySelector("figcaption")?.textContent);
    const article = element.closest?.("article");
    if (article && /AI\s*で\s*生成/i.test(article.textContent || "")) {
      values.push("AIで生成");
    }
    return values.filter(Boolean).join(" | ").replace(/\s+/g, " ").slice(0, 700);
  }

  function openAiErrorMessage(code) {
    const messages = {
      "missing-api-key": "OpenAI APIキーが未設定です。",
      "api-http-400": "OpenAI APIが画像を受け付けませんでした。",
      "api-http-401": "OpenAI APIキーが無効です。",
      "api-http-403": "Content Provenance APIを利用する権限がありません。",
      "api-http-404": "Content Provenance APIを利用できません。",
      "api-http-413": "OpenAI APIへ送る画像が大きすぎます。",
      "api-http-429": "OpenAI APIの利用上限に達しました。",
      "api-http-500": "OpenAI APIで一時的な内部エラーが発生しました。",
      "api-http-502": "OpenAI APIの接続先で一時的なエラーが発生しました。",
      "api-http-503": "OpenAI APIが一時的に利用できません。",
      "network-error": "OpenAI APIへ接続できませんでした。",
      "timeout": "OpenAI APIがタイムアウトしました。",
      "image-auth-required": "認証なしで取得できない画像のため、プライバシー保護のためOpenAIへ送信しませんでした。",
      "image-too-large": "画像がOpenAI検証のサイズ上限を超えています。",
      "unsupported-image-format": "OpenAI検証に対応していない画像形式です。",
      "invalid-file": "OpenAI検証へ送る画像ファイルが無効です。",
      "invalid-response": "OpenAI APIから想定外の応答が返りました。",
      "openai-check-failed": "OpenAI検証を完了できませんでした。"
    };
    if (messages[code]) return messages[code];
    const imageHttp = String(code || "").match(/^image-http-(\d+)$/);
    if (imageHttp) return `対象画像の取得に失敗しました（HTTP ${imageHttp[1]}）。`;
    const apiHttp = String(code || "").match(/^api-http-(\d+)$/);
    if (apiHttp) return `OpenAI APIエラー（HTTP ${apiHttp[1]}）。`;
    return String(code || "不明なエラー");
  }

  function openAiDiagnosticText(result) {
    if (!settings.useOpenAiProvenance || result.synthIdDetected) return "";
    const diagnostic = result.diagnostic || {};
    const analysis = result.analysis || {};
    if (!diagnostic.openAiScheduled) {
      return "OpenAI SynthID検証は1ページあたりの上限により未実行です。";
    }
    if (diagnostic.openAiError) {
      if (diagnostic.openAiError === "image-auth-required") {
        return `OpenAI SynthID検証は未実行です: ${openAiErrorMessage(diagnostic.openAiError)}`;
      }
      return `OpenAI SynthID検証エラー: ${openAiErrorMessage(diagnostic.openAiError)}`;
    }
    if (analysis.openAiChecked && !analysis.openAiDetected) {
      return "OpenAI SynthID検証: 対応する信号は検出されませんでした。SNSの変換・縮小・再圧縮で検出できない場合があります。";
    }
    return "";
  }

  function openAiLogSource(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const rawName = parsed.pathname.split("/").filter(Boolean).pop() || "画像";
      let name = rawName;
      try { name = decodeURIComponent(rawName); } catch {}
      return `${parsed.hostname}/${name}`.slice(0, 160);
    } catch {
      return "画像URLを取得できません";
    }
  }

  function recordOpenAiLog(sourceUrl, result) {
    if (!result?.diagnostic?.openAiScheduled || openAiLogKeys.has(sourceUrl)) return;
    openAiLogKeys.add(sourceUrl);
    const errorCode = result.diagnostic.openAiError || "";
    let level = "info";
    let message = "OpenAI由来の信号は検出されませんでした。";
    if (errorCode) {
      level = errorCode === "image-auth-required" ? "info" : "error";
      message = openAiErrorMessage(errorCode);
    } else if (result.synthIdDetected) {
      level = "success";
      message = "OpenAI SynthIDを検出しました。";
    } else if (result.basis === "openai-provenance" && result.c2paDetected) {
      level = "success";
      message = "信頼済みC2PAを検出しました。";
    } else if (!result.analysis?.openAiChecked) {
      message = "OpenAI検証は実行されませんでした。";
    }
    openAiLogs.push({
      at: Date.now(),
      source: openAiLogSource(sourceUrl),
      level,
      code: errorCode,
      message
    });
    if (openAiLogs.length > MAX_OPENAI_LOG_ENTRIES) openAiLogs.shift();
  }

  function clearOpenAiLogs() {
    openAiLogKeys.clear();
    openAiLogs.length = 0;
  }

  function isLargeEnough(element) {
    const rect = element.getBoundingClientRect();
    const width = element.naturalWidth || rect.width;
    const height = element.naturalHeight || rect.height;
    return width >= settings.minWidth && height >= settings.minHeight;
  }

  function closeOpenDetails(restoreFocus = false) {
    let closedButton = null;
    for (const record of records.values()) {
      if (!record.detail.hidden) closedButton = record.button;
      record.detail.hidden = true;
      record.button.setAttribute("aria-expanded", "false");
    }
    if (restoreFocus && closedButton?.isConnected) {
      closedButton.focus({ preventScroll: true });
    }
    return Boolean(closedButton);
  }

  function appendDetailParagraph(detail, text, label = "") {
    const paragraph = document.createElement("p");
    if (label) {
      const strong = document.createElement("b");
      strong.textContent = label;
      paragraph.append(strong);
    }
    paragraph.append(String(text));
    detail.append(paragraph);
  }

  function createBadge(element, result, sourceUrl) {
    createOverlay();
    const button = document.createElement("button");
    button.type = "button";
    const presentation = globalThis.ChatGptAiBadgePresentation?.getBadgePresentation(result) || {
      kind: result.status === "confirmed" ? "confirmed" : result.status === "likely" ? "likely" : "undetermined",
      text: result.status === "confirmed" ? "AI【モデル判定】" : result.status === "likely" ? "AIかも" : "非生成かも",
      method: "総合判定",
      heading: "画像の判定結果"
    };
    button.className = `badge ${presentation.kind}`;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-haspopup", "dialog");
    button.textContent = presentation.text;

    const detail = document.createElement("div");
    detail.className = "detail";
    detail.hidden = true;
    detail.id = `__ai-image-badge-detail-${++detailSequence}`;
    detail.setAttribute("role", "dialog");
    button.setAttribute("aria-controls", detail.id);
    const heading = presentation.heading;
    const defaultReason = result.unavailable
      ? "画像ファイルを取得できなかったため、生成AIかどうかを確認できませんでした。"
      : "生成AIと判断するのに十分な根拠は見つかりませんでした。";
    const providedReasons = Array.isArray(result.reasons) ? result.reasons : [];
    const reasons = providedReasons.length > 0 ? providedReasons : [defaultReason];
    const openAiDiagnostic = openAiDiagnosticText(result);
    const detailHeading = document.createElement("strong");
    detailHeading.textContent = heading;
    detail.replaceChildren(detailHeading);
    appendDetailParagraph(detail, presentation.method || "総合判定", "判定方式：");
    if (presentation.localScore) {
      appendDetailParagraph(detail, presentation.localScore, "ローカルモデルスコア：");
    }
    for (const reason of reasons) appendDetailParagraph(detail, reason);
    for (const advisory of result.analysis?.contextAdvisories || []) {
      appendDetailParagraph(detail, advisory, "参考情報：");
    }
    if (openAiDiagnostic) appendDetailParagraph(detail, openAiDiagnostic);
    appendDetailParagraph(
      detail,
      "本判定は参考情報です。画像の真贋、著作権、制作者や掲載者への評価を確定するものではありません。",
      "注意："
    );
    button.title = `${heading}: ${providedReasons.join(" / ")}`;

    globalThis.AiImageBadgeDetailExtension?.attach({
      detail,
      element,
      result,
      sourceUrl,
      pageUrl: location.href,
      altText: contextForImage(element),
      sendMessage
    });

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = detail.hidden;
      closeOpenDetails();
      detail.hidden = !willOpen;
      button.setAttribute("aria-expanded", String(willOpen));
      schedulePositionUpdate();
    });
    // 詳細内の教育ボタンなどを操作しても、外側クリック扱いで閉じない。
    detail.addEventListener("click", (event) => event.stopPropagation());

    overlayRoot.append(button, detail);
    records.set(element, { button, detail, result });
    schedulePositionUpdate();
  }

  function removeRecord(element) {
    const record = records.get(element);
    if (!record) return;
    record.button.remove();
    record.detail.remove();
    records.delete(element);
  }

  function mergeUnique(...groups) {
    return [...new Set(groups.flat().filter(Boolean))];
  }

  async function inspectPageSourceMetadata(url) {
    if (!globalThis.ChatGptAiMetadataFallback) return null;
    if (!metadataFallbackCache.has(url)) {
      metadataFallbackCache.set(url, globalThis.ChatGptAiMetadataFallback.inspectSource(url));
    }
    return metadataFallbackCache.get(url);
  }

  function mergeMetadataResult(result, metadataResult) {
    if (!metadataResult?.c2paDetected) return result;
    const explicitAi = metadataResult.status === "confirmed";
    return {
      ...result,
      status: explicitAi ? "confirmed" : result.status,
      confidence: explicitAi
        ? Math.max(Number(result.confidence) || 0, metadataResult.confidence)
        : result.confidence,
      reasons: mergeUnique(metadataResult.reasons, result.reasons),
      evidence: mergeUnique(metadataResult.evidence, result.evidence),
      hasProvenance: true,
      c2paDetected: true,
      basis: explicitAi ? "explicit-metadata" : result.basis,
      unavailable: false,
      diagnostic: {
        ...(result.diagnostic || {}),
        pageMetadataFallback: true
      }
    };
  }

  async function inspectElement(element, url) {
    if (!isPageActive() || !url || url.length > 8192 || /^data:/i.test(url) || !isLargeEnough(element)) {
      removeRecord(element);
      return;
    }

    const hints = settings.usePageHints ? contextForImage(element) : "";
    const testFixture = testFixtureResult(element, url);
    const baseKey = `${url}\n${hints}`;
    let useOpenAiProvenance = false;
    if (!testFixture && settings.useOpenAiProvenance) {
      if (openAiSourceKeys.has(url)) {
        useOpenAiProvenance = true;
      } else if (openAiSourceKeys.size < settings.openAiMaxChecksPerPage) {
        openAiSourceKeys.add(url);
        useOpenAiProvenance = true;
      }
    }
    const key = `${baseKey}\nfixture:${testFixture ? 1 : 0}\nopenai:${useOpenAiProvenance ? 1 : 0}\nmodel:${settings.localModel}\ngpu:${settings.useGpuAcceleration ? 1 : 0}\nthresholds:${settings.localLikelyThreshold}:${settings.localConfirmedThreshold}`;
    if (element.dataset.aiImageBadgeKey === key) return;
    element.dataset.aiImageBadgeKey = key;
    removeRecord(element);

    let pending = sourceCache.get(key);
    if (!pending) {
      pending = testFixture ? Promise.resolve(testFixture) : sendMessage({
        type: "inspect-image",
        url,
        hints,
        usePageHints: settings.usePageHints,
        usePixelClassifier: settings.usePixelClassifier,
        localModel: settings.localModel,
        useGpuAcceleration: settings.useGpuAcceleration,
        useFrequencyAnalysis: settings.useFrequencyAnalysis,
        localLikelyThreshold: settings.localLikelyThreshold,
        localConfirmedThreshold: settings.localConfirmedThreshold,
        useOpenAiProvenance,
        pageUrl: location.href
      });
      sourceCache.set(key, pending);
    }

    let result = await pending;
    const shouldRetryMetadata = result && !result.c2paDetected && (
      result.status === "likely" ||
      !result.diagnostic?.fetched ||
      /^(?:blob:|file:)/i.test(url)
    );
    if (shouldRetryMetadata) {
      result = mergeMetadataResult(result, await inspectPageSourceMetadata(url));
    }
    if (result) {
      result = {
        ...result,
        diagnostic: {
          ...(result.diagnostic || {}),
          openAiScheduled: useOpenAiProvenance
        }
      };
      recordOpenAiLog(url, result);
    }
    if (!element.isConnected || element.dataset.aiImageBadgeKey !== key || !result || !isPageActive()) {
      removeRecord(element);
      return;
    }
    inspectedCount += 1;
    if (result.unavailable) unavailableCount += 1;

    const presentation = globalThis.ChatGptAiBadgePresentation?.getBadgePresentation(result);
    const displayKind = presentation?.kind || (
      result.status === "confirmed" ? "confirmed" : result.status === "likely" ? "likely" : "undetermined"
    );
    if (displayKind === "confirmed" ||
        (settings.showLikely && displayKind === "likely") ||
        (settings.showUndetermined && displayKind === "undetermined")) {
      createBadge(element, result, url);
    }
  }

  function scheduleElementInspection(element, url) {
    queuedUrls.set(element, url);
    if (!viewportObserver) {
      void inspectElement(element, url);
      return;
    }
    viewportObserver.observe(element);
  }

  function inspectImageElement(image) {
    const url = image.currentSrc || image.src;
    if (!image.complete) {
      if (!loadListeners.has(image)) {
        loadListeners.add(image);
        // src/srcset が何度切り替わる lazyload 実装でも、各 load 後に再判定する。
        image.addEventListener("load", () => inspectImageElement(image));
      }
      return;
    }
    scheduleElementInspection(image, url);
  }

  function backgroundUrl(element) {
    const value = getComputedStyle(element).backgroundImage;
    if (!value || value === "none") return "";
    const match = value.match(/url\((?:["']?)(.*?)(?:["']?)\)/i);
    if (!match) return "";
    try {
      return new URL(match[1], document.baseURI).href;
    } catch {
      return "";
    }
  }

  function scan(root = document) {
    lastScanAt = Date.now();
    if (!isPageActive()) {
      for (const element of [...records.keys()]) removeRecord(element);
      return;
    }

    if (root instanceof HTMLImageElement) inspectImageElement(root);
    root.querySelectorAll?.("img").forEach(inspectImageElement);

    const shadowRoots = [];
    if (root instanceof Element && root.shadowRoot) shadowRoots.push(root.shadowRoot);
    root.querySelectorAll?.("*").forEach((element) => {
      if (element.shadowRoot) shadowRoots.push(element.shadowRoot);
    });
    shadowRoots.forEach((shadowRoot) => {
      observeRoot(shadowRoot);
      scan(shadowRoot);
    });

    if (settings.scanCssBackgrounds) {
      const elements = root === document
        ? [...document.querySelectorAll("body *")].slice(0, 3000)
        : [root, ...(root.querySelectorAll?.("*") || [])];
      elements.forEach((element) => {
        if (!(element instanceof Element) || element instanceof HTMLImageElement) return;
        const url = backgroundUrl(element);
        if (url) scheduleElementInspection(element, url);
      });
    }
  }

  function scheduleScan(root = document) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(root), 120);
  }

  function updatePositions() {
    positionFrame = null;
    for (const [element, record] of records) {
      if (!element.isConnected) {
        removeRecord(element);
        continue;
      }

      const rect = element.getBoundingClientRect();
      const visible = rect.width >= 24 && rect.height >= 24 &&
        rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth;
      record.button.hidden = !visible;
      if (!visible) {
        record.detail.hidden = true;
        record.button.setAttribute("aria-expanded", "false");
        continue;
      }

      const right = Math.min(innerWidth - 6, Math.max(46, rect.right - 6));
      const top = Math.max(6, rect.top + 6);
      record.button.style.left = `${right}px`;
      record.button.style.top = `${top}px`;
      record.detail.style.left = `${right}px`;
      record.detail.style.top = `${Math.min(innerHeight - 90, top + 30)}px`;
    }
  }

  function schedulePositionUpdate() {
    if (!positionFrame) positionFrame = requestAnimationFrame(updatePositions);
  }

  async function loadSettings() {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
    settings.urlAllowList = String(settings.urlAllowList || "");
    settings.urlExcludeList = String(settings.urlExcludeList || "");
    if (![
      "community",
      "distilled",
      "capcheck",
      "community-forensics-custom",
      "resnet18-custom",
      "chatgpt-custom"
    ].includes(settings.localModel)) {
      settings.localModel = DEFAULTS.localModel;
    }
    settings.useGpuAcceleration = Boolean(settings.useGpuAcceleration);
    settings.localLikelyThreshold = Math.min(99, Math.max(1,
      Number(settings.localLikelyThreshold) || DEFAULTS.localLikelyThreshold));
    settings.localConfirmedThreshold = Math.min(99, Math.max(settings.localLikelyThreshold,
      Number(settings.localConfirmedThreshold) || DEFAULTS.localConfirmedThreshold));
  }

  function stats() {
    let confirmed = 0;
    let likely = 0;
    let undetermined = 0;
    for (const record of records.values()) {
      const kind = globalThis.ChatGptAiBadgePresentation?.getBadgePresentation(record.result)?.kind ||
        (record.result.status === "confirmed" ? "confirmed" : record.result.status === "likely" ? "likely" : "undetermined");
      if (kind === "confirmed") confirmed += 1;
      if (kind === "likely") likely += 1;
      if (kind === "undetermined") undetermined += 1;
    }
    const access = pageAccess();
    return {
      enabled: settings.enabled,
      active: settings.enabled && access.allowed,
      pageAllowed: access.allowed,
      urlAccessReason: access.reason,
      matchedUrlRule: access.matchedRule,
      inspected: inspectedCount,
      confirmed,
      likely,
      undetermined,
      unavailable: unavailableCount,
      localModel: settings.localModel,
      useGpuAcceleration: settings.useGpuAcceleration,
      localLikelyThreshold: settings.localLikelyThreshold,
      localConfirmedThreshold: settings.localConfirmedThreshold,
      openAiEnabled: settings.useOpenAiProvenance,
      openAiScheduled: openAiSourceKeys.size,
      openAiLimit: settings.openAiMaxChecksPerPage,
      openAiDetected: openAiLogs.filter((entry) => entry.level === "success").length,
      openAiErrors: openAiLogs.filter((entry) => entry.level === "error").length,
      openAiLogs: openAiLogs.slice().reverse(),
      pageUrl: location.href,
      totalImages: document.images.length,
      lastScanAt
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "get-stats") {
      sendResponse(stats());
    } else if (message?.type === "rescan") {
      sourceCache.clear();
      openAiSourceKeys.clear();
      clearOpenAiLogs();
      inspectedCount = 0;
      unavailableCount = 0;
      document.querySelectorAll("[data-ai-image-badge-key]").forEach((element) => {
        delete element.dataset.aiImageBadgeKey;
      });
      scheduleScan();
      sendResponse({ ok: true });
    }
    return false;
  });

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    const apiKeyChanged = areaName === "local" && Boolean(changes.openAiApiKey);
    if (areaName !== "sync" && !apiKeyChanged) return;
    if (areaName === "sync") await loadSettings();
    sourceCache.clear();
    openAiSourceKeys.clear();
    clearOpenAiLogs();
    document.querySelectorAll("[data-ai-image-badge-key]").forEach((element) => {
      delete element.dataset.aiImageBadgeKey;
    });
    scheduleScan();
  });

  // Shadow DOM内のバッジ／詳細は伝播を止め、通常ページ側のクリックだけで閉じる。
  document.addEventListener("click", () => closeOpenDetails());
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !closeOpenDetails(true)) return;
    event.preventDefault();
    event.stopPropagation();
  });

  function checkPageUrl() {
    if (location.href === lastPageUrl) return;
    lastPageUrl = location.href;
    sourceCache.clear();
    openAiSourceKeys.clear();
    clearOpenAiLogs();
    document.querySelectorAll("[data-ai-image-badge-key]").forEach((element) => {
      delete element.dataset.aiImageBadgeKey;
    });
    scheduleScan();
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof HTMLImageElement) inspectImageElement(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
    schedulePositionUpdate();
  });

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "style", "class", "alt", "title", "aria-label"]
    });
  }

  async function start() {
    await loadSettings();
    createOverlay();
    observeRoot(document.documentElement);
    scan();
    addEventListener("scroll", schedulePositionUpdate, true);
    addEventListener("resize", schedulePositionUpdate, { passive: true });
    addEventListener("popstate", checkPageUrl);
    addEventListener("hashchange", checkPageUrl);
    setInterval(checkPageUrl, 1000);
  }

  void start();
})();
