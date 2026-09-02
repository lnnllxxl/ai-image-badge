import {
  MAX_IMAGE_BYTES,
  fuseDetectionResults,
  inspectBytes,
  inspectPageHints,
  inspectUrl
} from "./detector.js";
import { requestOpenAiProvenance } from "./openai-provenance.js";
import { normalizeProvenanceImageUrl } from "./provenance-url.js";

// APIキーを含むローカル保存領域は拡張機能自身のページと
// service workerだけから参照できるようにし、content scriptから分離する。
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

const resultCache = new Map();
const MAX_CACHE_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 12_000;
const localAnalysisCache = new Map();
const openAiProvenanceCache = new Map();
const OPENAI_IMAGE_LIMIT_BYTES = 20 * 1024 * 1024;
const OPENAI_TIMEOUT_MS = 30_000;
const OPENAI_MAX_CONCURRENCY = 2;
const openAiQueue = [];
let openAiActive = 0;
let creatingOffscreen = null;
const LOCAL_MODELS = new Set([
  "community",
  "distilled",
  "capcheck",
  "community-forensics-custom",
  "resnet18-custom",
  "chatgpt-custom"
]);

function normalizeLocalModel(value) {
  return LOCAL_MODELS.has(value) ? value : "community";
}

function normalizeThresholdPercent(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(99, Math.max(1, number)) : fallback;
}

function putCache(key, value) {
  if (resultCache.size >= MAX_CACHE_ENTRIES) {
    resultCache.delete(resultCache.keys().next().value);
  }
  resultCache.set(key, value);
}

function isAllowedImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" ||
      url.protocol === "https:" ||
      rawUrl.startsWith(chrome.runtime.getURL(""));
  } catch {
    return false;
  }
}

async function readPrefix(response) {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer.slice(0, MAX_IMAGE_BYTES));
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (total < MAX_IMAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_IMAGE_BYTES - total;
      const chunk = value.length > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.length;
      if (chunk.length < value.length) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function fetchOnce(url, useRange) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers = {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    };
    if (useRange) headers.Range = `bytes=0-${MAX_IMAGE_BYTES - 1}`;

    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "include",
      redirect: "follow",
      headers,
      signal: controller.signal
    });
    return {
      response,
      cleanup: () => clearTimeout(timeout)
    };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function fetchImagePrefix(url) {
  let request = await fetchOnce(url, true);
  let response = request.response;

  // 一部の画像CDNはRangeヘッダーを拒否するため、通常取得へ一度だけ切り替える。
  if ([400, 403, 405, 416].includes(response.status)) {
    await response.body?.cancel().catch(() => {});
    request.cleanup();
    request = await fetchOnce(url, false);
    response = request.response;
  }

  try {
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const error = new Error(`HTTP ${response.status}`);
      error.code = `http-${response.status}`;
      throw error;
    }

    const mimeType = response.headers.get("content-type") || "";
    if (/^(?:text\/html|application\/(?:json|xml))/i.test(mimeType)) {
      await response.body?.cancel().catch(() => {});
      const error = new Error("The URL returned a document instead of an image");
      error.code = "not-an-image";
      throw error;
    }

    const bytes = await readPrefix(response);

    return {
      bytes,
      bytesRead: bytes.length,
      mimeType,
      resolvedUrl: response.url || url,
      httpStatus: response.status
    };
  } finally {
    request.cleanup();
  }
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "ml/offscreen.html",
    reasons: ["WORKERS"],
    justification: "画像分類モデルを端末内で実行し、全タブで1つのモデルを共有するため。"
  }).catch((error) => {
    if (!String(error).includes("Only a single offscreen")) throw error;
  }).finally(() => {
    creatingOffscreen = null;
  });
  return creatingOffscreen;
}

async function analyzeLocalPixels(
  url,
  usePixelClassifier,
  useFrequencyAnalysis,
  localModel,
  useGpuAcceleration
) {
  if (!usePixelClassifier && !useFrequencyAnalysis) return null;
  const selectedModel = normalizeLocalModel(localModel);
  const key = `${url}\n${usePixelClassifier ? 1 : 0}${useFrequencyAnalysis ? 1 : 0}\nmodel:${selectedModel}\ngpu:${useGpuAcceleration ? 1 : 0}`;
  if (localAnalysisCache.has(key)) return localAnalysisCache.get(key);
  await ensureOffscreen();
  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "analyze-pixels",
    url,
    usePixelClassifier,
    useFrequencyAnalysis,
    localModel: selectedModel,
    useGpuAcceleration: Boolean(useGpuAcceleration)
  });
  if (result && !result.error) {
    if (localAnalysisCache.size >= MAX_CACHE_ENTRIES) {
      localAnalysisCache.delete(localAnalysisCache.keys().next().value);
    }
    localAnalysisCache.set(key, result);
  }
  return result;
}

function inferOpenAiImageType(url, responseType) {
  const normalized = String(responseType || "").split(";", 1)[0].trim().toLowerCase();
  if (["image/png", "image/jpeg", "image/webp"].includes(normalized)) return normalized;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".webp")) return "image/webp";
  } catch {}
  return "";
}

function extensionForMime(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function fetchImageForOpenAi(url, signal) {
  const response = await fetch(url, {
    // OpenAIへ送る画像の取得では、閲覧セッションのCookieや認証済みキャッシュを使わない。
    cache: "no-store",
    credentials: "omit",
    redirect: "follow",
    headers: { Accept: "image/png,image/jpeg,image/webp" },
    signal
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.code = [401, 403].includes(response.status)
      ? "image-auth-required"
      : `image-http-${response.status}`;
    throw error;
  }
  const declaredLength = Number(response.headers.get("content-length")) || 0;
  if (declaredLength > OPENAI_IMAGE_LIMIT_BYTES) {
    const error = new Error("Image exceeds the OpenAI upload limit configured by this extension");
    error.code = "image-too-large";
    throw error;
  }
  const mimeType = inferOpenAiImageType(response.url || url, response.headers.get("content-type"));
  if (!mimeType) {
    const error = new Error("OpenAI provenance supports PNG, JPEG, and WebP images");
    error.code = "unsupported-image-format";
    throw error;
  }
  const downloaded = await response.blob();
  if (downloaded.size > OPENAI_IMAGE_LIMIT_BYTES) {
    const error = new Error("Image exceeds the OpenAI upload limit configured by this extension");
    error.code = "image-too-large";
    throw error;
  }
  return {
    blob: downloaded.type === mimeType ? downloaded : downloaded.slice(0, downloaded.size, mimeType),
    filename: `provenance-check.${extensionForMime(mimeType)}`
  };
}

function pumpOpenAiQueue() {
  while (openAiActive < OPENAI_MAX_CONCURRENCY && openAiQueue.length > 0) {
    const job = openAiQueue.shift();
    openAiActive += 1;
    job.task()
      .then(job.resolve, job.reject)
      .finally(() => {
        openAiActive -= 1;
        pumpOpenAiQueue();
      });
  }
}

function enqueueOpenAi(task) {
  return new Promise((resolve, reject) => {
    openAiQueue.push({ task, resolve, reject });
    pumpOpenAiQueue();
  });
}

async function analyzeOpenAiProvenance(url) {
  const provenanceUrl = normalizeProvenanceImageUrl(url);
  if (openAiProvenanceCache.has(provenanceUrl)) return openAiProvenanceCache.get(provenanceUrl);
  const { openAiApiKey = "" } = await chrome.storage.local.get({ openAiApiKey: "" });
  if (!openAiApiKey) return { checked: false, detected: false, error: "missing-api-key" };

  return enqueueOpenAi(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
    try {
      const file = await fetchImageForOpenAi(provenanceUrl, controller.signal);
      const result = await requestOpenAiProvenance({
        apiKey: openAiApiKey,
        blob: file.blob,
        filename: file.filename,
        signal: controller.signal
      });
      if (openAiProvenanceCache.size >= MAX_CACHE_ENTRIES) {
        openAiProvenanceCache.delete(openAiProvenanceCache.keys().next().value);
      }
      openAiProvenanceCache.set(provenanceUrl, result);
      return result;
    } catch (error) {
      return {
        checked: false,
        detected: false,
        error: error?.code || (error?.name === "AbortError" ? "timeout" : "openai-check-failed")
      };
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function inspectImage(message) {
  const {
    url,
    hints = "",
    usePageHints = true,
    usePixelClassifier = true,
    useFrequencyAnalysis = true,
    localModel = "community",
    useGpuAcceleration = false,
    useOpenAiProvenance = false,
    localLikelyThreshold = 50,
    localConfirmedThreshold = 90
  } = message;
  const selectedModel = normalizeLocalModel(localModel);
  const likelyThresholdPercent = normalizeThresholdPercent(localLikelyThreshold, 50);
  const confirmedThresholdPercent = Math.max(
    likelyThresholdPercent,
    normalizeThresholdPercent(localConfirmedThreshold, 90)
  );
  const hintKey = usePageHints ? hints.slice(0, 500) : "";
  const cacheKey = `${url}\n${hintKey}\n${usePixelClassifier ? 1 : 0}${useFrequencyAnalysis ? 1 : 0}${useOpenAiProvenance ? 1 : 0}\nmodel:${selectedModel}\ngpu:${useGpuAcceleration ? 1 : 0}\nthresholds:${likelyThresholdPercent}:${confirmedThresholdPercent}`;
  if (resultCache.has(cacheKey)) return resultCache.get(cacheKey);

  const urlResult = inspectUrl(url);
  const hintResult = usePageHints ? inspectPageHints(hints) : null;
  let byteResult = null;
  let unavailable = false;
  let localAnalysis = null;
  let openAiProvenance = null;
  let diagnostic = {
    fetched: false,
    bytesRead: 0,
    mimeType: "",
    resolvedUrl: url,
    errorCode: ""
  };

  if (isAllowedImageUrl(url)) {
    // 公式来歴検証を先に開始し、メタデータ解析とローカルモデルは並行して進める。
    // 結果の統合ではOpenAI SynthIDが最優先される。
    const [openAiOutcome, metadataOutcome, localOutcome] = await Promise.allSettled([
      useOpenAiProvenance ? analyzeOpenAiProvenance(url) : Promise.resolve(null),
      fetchImagePrefix(url),
      analyzeLocalPixels(
        url,
        usePixelClassifier,
        useFrequencyAnalysis,
        selectedModel,
        useGpuAcceleration
      )
    ]);
    if (metadataOutcome.status === "fulfilled") {
      const payload = metadataOutcome.value;
      byteResult = await inspectBytes(payload.bytes, { mimeType: payload.mimeType });
      diagnostic = {
        fetched: true,
        bytesRead: payload.bytesRead,
        mimeType: payload.mimeType,
        resolvedUrl: payload.resolvedUrl,
        httpStatus: payload.httpStatus,
        errorCode: ""
      };
    } else {
      const error = metadataOutcome.reason;
      diagnostic.errorCode = error?.name === "AbortError"
        ? "timeout"
        : (error?.code || "fetch-failed");
    }
    if (localOutcome.status === "fulfilled") {
      localAnalysis = localOutcome.value;
      diagnostic.localError = localAnalysis?.error || "";
    } else {
      diagnostic.localError = localOutcome.reason?.message || "local-analysis-failed";
    }
    if (openAiOutcome.status === "fulfilled") {
      openAiProvenance = openAiOutcome.value;
      diagnostic.openAiChecked = Boolean(openAiProvenance?.checked);
      diagnostic.openAiError = openAiProvenance?.error || "";
    } else {
      diagnostic.openAiChecked = false;
      diagnostic.openAiError = openAiOutcome.reason?.code || "openai-check-failed";
    }
    unavailable = !diagnostic.fetched && (!localAnalysis || Boolean(localAnalysis.error));
  } else {
    unavailable = true;
    diagnostic.errorCode = "unsupported-url";
  }

  const result = {
    ...fuseDetectionResults({
      byteResult,
      urlResult,
      hintResult,
      localAnalysis,
      openAiProvenance,
      localThresholds: {
        likely: likelyThresholdPercent / 100,
        confirmed: confirmedThresholdPercent / 100
      }
    }),
    unavailable,
    diagnostic
  };
  if (!unavailable && !(useOpenAiProvenance && diagnostic.openAiError)) putCache(cacheKey, result);
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target === "offscreen") {
    return false;
  }

  if (message?.type === "get-model-status") {
    const localModel = normalizeLocalModel(message.localModel);
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({
        target: "offscreen",
        type: "model-status",
        localModel,
        useGpuAcceleration: Boolean(message.useGpuAcceleration)
      }))
      .then(sendResponse)
      .catch((error) => sendResponse({ ready: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type !== "inspect-image") return false;

  inspectImage(message)
    .then(sendResponse)
    .catch(() => sendResponse({
      status: "none",
      confidence: 0,
      reasons: [],
      evidence: [],
      unavailable: true,
      diagnostic: { fetched: false, errorCode: "internal-error" }
    }));
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.openAiApiKey) {
    openAiProvenanceCache.clear();
    resultCache.clear();
  }
  if (areaName === "sync" && (changes.localModel || changes.useGpuAcceleration)) {
    localAnalysisCache.clear();
    resultCache.clear();
  }
});
