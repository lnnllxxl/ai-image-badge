import { analyzeBitmap, inspectJpegCompression } from "./forensics.js";
import { analyzeBitmapGpu } from "./forensics-gpu.js";
import { loadModel, modelStatus, scoreBitmap } from "./model-detector.js";

const MAX_FULL_IMAGE_BYTES = 32 * 1024 * 1024;
const queue = [];
let running = false;

async function fetchBitmap(url) {
  const response = await fetch(url, {
    cache: "force-cache",
    credentials: "omit",
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`http-${response.status}`);
  const contentLength = Number(response.headers.get("content-length")) || 0;
  if (contentLength > MAX_FULL_IMAGE_BYTES) throw new Error("image-too-large");
  const blob = await response.blob();
  if (blob.size > MAX_FULL_IMAGE_BYTES) throw new Error("image-too-large");
  if (blob.type && !blob.type.startsWith("image/")) throw new Error("not-an-image");
  if (blob.size < 128) throw new Error("image-too-small");
  const header = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const jpegInfo = inspectJpegCompression(header, blob.type);
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none"
  });
  return { bitmap, jpegInfo };
}

function normalizeFrequencyMode(value) {
  return ["fast", "standard", "detailed"].includes(value) ? value : "fast";
}

async function analyze(
  url,
  usePixelClassifier,
  useFrequencyAnalysis,
  frequencyAnalysisMode,
  localConfirmedThreshold,
  localModel,
  useGpuAcceleration
) {
  const { bitmap, jpegInfo } = await fetchBitmap(url);
  try {
    if (bitmap.width < 96 || bitmap.height < 96) {
      return { skipped: "too-small", width: bitmap.width, height: bitmap.height };
    }
    const pixel = usePixelClassifier
      ? await scoreBitmap(bitmap, localModel, useGpuAcceleration)
      : null;
    const requestedProfile = normalizeFrequencyMode(frequencyAnalysisMode);
    const confirmedThreshold = Math.min(0.99, Math.max(0.01,
      (Number(localConfirmedThreshold) || 90) / 100));
    const profile = requestedProfile === "detailed"
      ? "detailed"
      : requestedProfile === "standard" && Number(pixel?.probability) >= confirmedThreshold
        ? "standard"
        : "fast";
    let frequency = null;
    if (useFrequencyAnalysis) {
      if (profile === "detailed" && useGpuAcceleration) {
        try {
          frequency = await analyzeBitmapGpu(bitmap, { jpegInfo });
        } catch (error) {
          frequency = {
            ...analyzeBitmap(bitmap, { profile: "detailed", jpegInfo }),
            backend: "cpu",
            gpuFallback: true,
            gpuError: error?.code || String(error?.message || error)
          };
        }
      } else {
        frequency = {
          ...analyzeBitmap(bitmap, { profile, jpegInfo }),
          backend: "cpu",
          gpuFallback: false
        };
      }
    }
    return { pixel, frequency, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        const result = await analyze(
          job.url,
          job.usePixelClassifier,
          job.useFrequencyAnalysis,
          job.frequencyAnalysisMode,
          job.localConfirmedThreshold,
          job.localModel,
          job.useGpuAcceleration
        );
        job.resolve({ url: job.url, ...result });
      } catch (error) {
        job.resolve({ url: job.url, error: String(error?.message || error) });
      }
    }
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;
  if (message.type === "model-status") {
    modelStatus(message.localModel, message.useGpuAcceleration)
      .then(sendResponse)
      .catch((error) => sendResponse({ ready: false, error: String(error?.message || error) }));
    return true;
  }
  if (message.type === "warm-model") {
    loadModel(message.localModel, message.useGpuAcceleration)
      .then(() => modelStatus(message.localModel, message.useGpuAcceleration))
      .then(sendResponse)
      .catch((error) => sendResponse({ ready: false, error: String(error?.message || error) }));
    return true;
  }
  if (message.type === "analyze-pixels") {
    queue.push({
      url: message.url,
      usePixelClassifier: message.usePixelClassifier !== false,
      useFrequencyAnalysis: message.useFrequencyAnalysis !== false,
      frequencyAnalysisMode: normalizeFrequencyMode(message.frequencyAnalysisMode),
      localConfirmedThreshold: message.localConfirmedThreshold,
      localModel: message.localModel,
      useGpuAcceleration: Boolean(message.useGpuAcceleration),
      resolve: sendResponse
    });
    void pump();
    return true;
  }
  return false;
});
