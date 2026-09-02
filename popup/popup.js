async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tab, message) {
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null;
  }
}

async function sendToActiveTab(message) {
  return sendToTab(await activeTab(), message);
}

function isChromeWebStore(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "chromewebstore.google.com" ||
      (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore"));
  } catch {
    return false;
  }
}

function canInject(url) {
  return /^https?:\/\//i.test(url || "") && !isChromeWebStore(url);
}

async function connectToActivePage() {
  const tab = await activeTab();
  let stats = await sendToTab(tab, { type: "get-stats" });
  let injected = false;
  let injectionError = "";

  if (!stats && tab?.id && canInject(tab.url)) {
    try {
      const injectionFiles = chrome.runtime.getManifest().content_scripts?.[0]?.js || [];
      if (injectionFiles.length === 0) throw new Error("content-script-list-missing");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: injectionFiles
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      stats = await sendToTab(tab, { type: "get-stats" });
      injected = Boolean(stats);
    } catch (error) {
      injectionError = error?.message || "inject-failed";
    }
  }

  return { stats, tab, injected, injectionError };
}

function renderPower(enabled) {
  const toggle = document.querySelector("#enabled-toggle");
  const label = document.querySelector("#power-state");
  toggle.checked = Boolean(enabled);
  label.textContent = enabled ? "オン：画像を確認します" : "オフ：バッジを表示しません";
}

function renderOpenAiLogs(stats) {
  const panel = document.querySelector("#openai-log");
  const list = document.querySelector("#openai-log-list");
  const enabled = Boolean(stats?.openAiEnabled && stats?.active !== false);
  panel.hidden = !enabled;
  list.replaceChildren();
  if (!enabled) {
    panel.open = false;
    return;
  }

  const logs = Array.isArray(stats.openAiLogs) ? stats.openAiLogs : [];
  if (logs.length === 0) {
    const item = document.createElement("li");
    item.className = "info";
    item.textContent = "まだAPI結果はありません。画像が表示領域に近づくと検証します。";
    list.append(item);
    return;
  }

  for (const entry of logs) {
    const item = document.createElement("li");
    item.className = ["success", "error", "info"].includes(entry.level) ? entry.level : "info";
    const time = Number.isFinite(Number(entry.at))
      ? new Date(Number(entry.at)).toLocaleTimeString("ja-JP", { hour12: false })
      : "時刻不明";
    const heading = document.createElement("b");
    heading.textContent = `${time} ${entry.message || "結果不明"}`;
    const source = document.createElement("small");
    source.textContent = `対象: ${entry.source || "画像"}${entry.code ? ` / コード: ${entry.code}` : ""}`;
    item.append(heading, source);
    list.append(item);
  }
  if (stats.openAiErrors > 0) panel.open = true;
}

function render(stats, context = {}) {
  const state = document.querySelector("#state");
  const pageUrl = document.querySelector("#page-url");
  const networkNote = document.querySelector("#network-note");
  if (!stats) {
    const url = context.tab?.url || "";
    pageUrl.textContent = url || "URLを取得できませんでした";
    pageUrl.title = url;
    networkNote.hidden = false;

    if (isChromeWebStore(url)) {
      state.textContent = "Chromeウェブストアでは動作できません";
      networkNote.textContent = "Chromeの保護仕様により、拡張機能はウェブストアのページへ処理を追加できません。別のWebサイトでお試しください。";
    } else if (!/^https?:\/\//i.test(url)) {
      state.textContent = "このページはChromeの保護対象です";
      networkNote.textContent = "通常の http:// または https:// ページを開いてください。chrome://、新しいタブ、設定画面などでは動作しません。";
    } else {
      state.textContent = "このタブへ接続できませんでした";
      networkNote.textContent = "ページを一度再読み込みしてから、もう一度このポップアップを開いてください。";
    }
    document.querySelector("#rescan").disabled = !canInject(url);
    renderOpenAiLogs(null);
    return;
  }

  renderPower(stats.enabled);

  state.textContent = !stats.enabled
    ? "設定で一時停止中"
    : stats.pageAllowed === false
      ? stats.urlAccessReason === "excluded"
        ? "URL除外リストにより停止中"
        : "URL許可リストの対象外です"
      : context.injected
        ? "このページへ接続しました"
        : `${stats.totalImages}件の画像があるページで動作中`;
  pageUrl.textContent = stats.pageUrl;
  pageUrl.title = stats.pageUrl;
  document.querySelector("#confirmed").textContent = stats.confirmed;
  document.querySelector("#likely").textContent = stats.likely;
  document.querySelector("#undetermined").textContent = stats.undetermined ?? 0;
  document.querySelector("#inspected").textContent = stats.inspected;
  const openAiNote = document.querySelector("#openai-note");
  if (stats.openAiEnabled && stats.active !== false) {
    openAiNote.hidden = false;
    openAiNote.textContent = stats.openAiErrors > 0
      ? `OpenAI SynthID: ${stats.openAiScheduled}/${stats.openAiLimit}件を予定、${stats.openAiErrors}件でAPI未実行またはエラー。下のAPIログで原因を確認してください。`
      : `OpenAI SynthID: ${stats.openAiScheduled}/${stats.openAiLimit}件、OpenAI由来 ${stats.openAiDetected}件。`;
  } else {
    openAiNote.hidden = true;
  }
  renderOpenAiLogs(stats);
  if (stats.pageAllowed === false) {
    networkNote.hidden = false;
    networkNote.textContent = stats.urlAccessReason === "excluded"
      ? `このページは除外ルール「${stats.matchedUrlRule || "指定ルール"}」に一致しています。設定画面で変更できます。`
      : "許可リストにルールがあるため、このページでは解析しません。設定画面でURLを追加できます。";
  } else if (stats.unavailable > 0) {
    networkNote.hidden = false;
    networkNote.textContent = `${stats.unavailable}件は画像配信元の制限によりファイル内情報を取得できませんでした。URL・説明文の判定は継続しています。`;
  } else {
    networkNote.hidden = true;
  }
}

async function renderModelStatus() {
  const note = document.querySelector("#model-note");
  try {
    const thresholds = await chrome.storage.sync.get({
      localModel: "community",
      useGpuAcceleration: false,
      localLikelyThreshold: 50,
      localConfirmedThreshold: 90
    });
    const status = await chrome.runtime.sendMessage({
      type: "get-model-status",
      localModel: thresholds.localModel,
      useGpuAcceleration: thresholds.useGpuAcceleration
    });
    const thresholdText = `AIかも ${thresholds.localLikelyThreshold}%／AI判定 ${thresholds.localConfirmedThreshold}%`;
    const modelText = status?.label || "選択モデル";
    if (status?.ready) {
      const backendText = status.backend === "webgpu" ? "GPU / WebGPU" : "CPU / WASM";
      const fallbackText = status.gpuFallback ? "、GPU利用不可のためCPUへ自動切替" : "";
      note.textContent = `${modelText}: 準備済み（${backendText}${fallbackText}、${thresholdText}）`;
    } else if (status?.error) {
      note.textContent = `${modelText}: 読み込み前または利用不可`;
    } else {
      const preferredBackend = thresholds.useGpuAcceleration
        ? "GPU優先・利用不可時はCPU"
        : "CPU / WASM";
      note.textContent = `${modelText}: 初回に読み込み（${preferredBackend}、${thresholdText}）`;
    }
  } catch {
    note.textContent = "ローカル画像モデル: 状態を取得できませんでした";
  }
}

document.querySelector("#rescan").addEventListener("click", async () => {
  const button = document.querySelector("#rescan");
  button.disabled = true;
  button.textContent = "確認中…";
  let response = await sendToActiveTab({ type: "rescan" });
  if (!response) {
    const connection = await connectToActivePage();
    if (connection.stats) response = await sendToTab(connection.tab, { type: "rescan" });
  }
  setTimeout(async () => {
    const connection = await connectToActivePage();
    render(connection.stats, connection);
    button.disabled = false;
    button.textContent = "このページを再確認";
  }, 650);
});

document.querySelector("#options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#test-page").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("test/test.html") });
});

document.querySelector("#enabled-toggle").addEventListener("change", async (event) => {
  const toggle = event.currentTarget;
  toggle.disabled = true;
  const enabled = toggle.checked;
  renderPower(enabled);
  await chrome.storage.sync.set({ enabled });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const connection = await connectToActivePage();
  render(connection.stats, connection);
  toggle.disabled = false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.enabled) {
    renderPower(changes.enabled.newValue);
  }
});

const manifest = chrome.runtime.getManifest();
const manifestName = manifest.name;
document.querySelector("#app-name").textContent = manifestName;
document.querySelector("#app-version").textContent = `v${manifest.version}`;
document.title = `${manifestName} v${manifest.version}`;
if (manifest.options_page && manifest.options_page !== "options/options.html") {
  document.querySelector("#options").textContent = "管理画面";
}

void chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => renderPower(enabled));
void connectToActivePage().then((connection) => render(connection.stats, connection));
void renderModelStatus();
