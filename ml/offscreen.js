import { analyzeBitmap } from "./forensics.js";
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
  return createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none"
  });
}

async function analyze(url, usePixelClassifier, useFrequencyAnalysis, localModel, useGpuAcceleration) {
  const bitmap = await fetchBitmap(url);
  try {
    if (bitmap.width < 96 || bitmap.height < 96) {
      return { skipped: "too-small", width: bitmap.width, height: bitmap.height };
    }
    const frequency = useFrequencyAnalysis ? analyzeBitmap(bitmap) : null;
    const pixel = usePixelClassifier
      ? await scoreBitmap(bitmap, localModel, useGpuAcceleration)
      : null;
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
      localModel: message.localModel,
      useGpuAcceleration: Boolean(message.useGpuAcceleration),
      resolve: sendResponse
    });
    void pump();
    return true;
  }
  return false;
});
