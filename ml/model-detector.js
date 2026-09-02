/*
 * Community model preprocessing/calibration is derived from
 * agentatwork/local-ai-image-detector (MIT). See third_party notices.
 */
import * as ort from "../vendor/ort.bundle.min.mjs";
import { CROP, toCHW, viewNative, viewOfficial, viewSquash, viewViTResize } from "./preprocess.js";

ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/");
ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
ort.env.wasm.proxy = false;
ort.env.webgpu.powerPreference = "high-performance";
ort.env.logLevel = "error";

const sessions = new Map();
const backends = new Map();
const sessionPreferences = new Map();
const gpuErrors = new Map();
const loading = new Map();
const weightsCache = new Map();
let registryPromise = null;

const COMMUNITY_VIEWS = {
  official: viewOfficial,
  native: viewNative,
  squash: viewSquash
};

async function getRegistry() {
  if (!registryPromise) {
    registryPromise = fetch(chrome.runtime.getURL("model/config.json"))
      .then((response) => {
        if (!response.ok) throw new Error("model config unavailable");
        return response.json();
      })
      .then((registry) => {
        if (!registry?.models || !registry.models[registry.default_model]) {
          throw new Error("model registry is invalid");
        }
        return registry;
      });
  }
  return registryPromise;
}

async function resolveModel(modelId) {
  const registry = await getRegistry();
  const id = registry.models[modelId] ? modelId : registry.default_model;
  const config = registry.models[id];
  if (!Number.isInteger(config.input_size) || config.input_size < 32) {
    throw new Error(`invalid input size for ${id}`);
  }
  if (config.preprocess === "community") {
    if (config.input_size !== CROP || !config.views?.every((name) => COMMUNITY_VIEWS[name])) {
      throw new Error(`invalid Community preprocessing for ${id}`);
    }
  } else if (config.preprocess !== "vit-bilinear" || config.views?.some((name) => name !== "resize")) {
    throw new Error(`unknown preprocessing for ${id}`);
  }
  return { id, config };
}

function canUseWebGpu() {
  return typeof navigator !== "undefined" && Boolean(navigator.gpu);
}

function errorMessage(error) {
  return String(error?.message || error || "GPUを初期化できませんでした").replace(/\s+/g, " ").slice(0, 240);
}

async function releaseSession(modelId) {
  const session = sessions.get(modelId);
  sessions.delete(modelId);
  backends.delete(modelId);
  sessionPreferences.delete(modelId);
  if (!session?.release) return;
  try {
    await session.release();
  } catch {}
}

async function getWeights(id, config) {
  if (!weightsCache.has(id)) {
    weightsCache.set(id, fetch(chrome.runtime.getURL(`model/${config.weights}`))
      .then((response) => {
        if (!response.ok) throw new Error(`model weights unavailable: ${id}`);
        return response.arrayBuffer();
      })
      .then((buffer) => new Uint8Array(buffer)));
  }
  return weightsCache.get(id);
}

function createSession(weights, provider) {
  return ort.InferenceSession.create(weights, {
    executionProviders: [provider],
    graphOptimizationLevel: "all"
  });
}

export async function modelStatus(modelId = "community", useGpuAcceleration = false) {
  const { id, config } = await resolveModel(modelId);
  const gpuRequested = Boolean(useGpuAcceleration);
  const preferenceMatches = sessionPreferences.get(id) === gpuRequested;
  const ready = sessions.has(id) && preferenceMatches;
  const backend = ready ? (backends.get(id) || "unknown") : "loading";
  return {
    ready,
    backend,
    modelId: id,
    model: config.model_id,
    label: config.label,
    threshold: config.threshold ?? 0.5,
    gpuRequested,
    gpuAvailable: canUseWebGpu(),
    gpuFallback: ready && gpuRequested && backend === "wasm",
    gpuError: preferenceMatches ? (gpuErrors.get(id) || "") : ""
  };
}

export async function loadModel(modelId = "community", useGpuAcceleration = false) {
  const { id, config } = await resolveModel(modelId);
  const gpuRequested = Boolean(useGpuAcceleration);
  if (sessions.has(id) && sessionPreferences.get(id) === gpuRequested) return sessions.get(id);
  const loadKey = `${id}:${gpuRequested ? "gpu" : "wasm"}`;
  if (loading.has(loadKey)) return loading.get(loadKey);

  const promise = (async () => {
    await releaseSession(id);
    const weights = await getWeights(id, config);
    const webGpuAvailable = canUseWebGpu();
    const providers = gpuRequested && webGpuAvailable ? ["webgpu", "wasm"] : ["wasm"];
    if (gpuRequested && !webGpuAvailable) {
      gpuErrors.set(id, "このChrome環境ではWebGPUを利用できません");
    } else if (!gpuRequested) {
      gpuErrors.delete(id);
    }
    let lastError;
    for (const provider of providers) {
      try {
        const session = await createSession(weights, provider);
        sessions.set(id, session);
        backends.set(id, provider);
        sessionPreferences.set(id, gpuRequested);
        if (provider === "webgpu") gpuErrors.delete(id);
        return session;
      } catch (error) {
        lastError = error;
        if (provider === "webgpu") gpuErrors.set(id, errorMessage(error));
      }
    }
    backends.set(id, "failed");
    throw lastError || new Error(`model failed to load: ${id}`);
  })().finally(() => loading.delete(loadKey));

  loading.set(loadKey, promise);
  return promise;
}

async function fallBackToWasm(id, config, gpuError) {
  gpuErrors.set(id, errorMessage(gpuError));
  await releaseSession(id);
  const session = await createSession(await getWeights(id, config), "wasm");
  sessions.set(id, session);
  backends.set(id, "wasm");
  // GPUを希望した結果としてWASMへ切り替えたことを状態表示に残す。
  sessionPreferences.set(id, true);
  return session;
}

const sigmoid = (value) => 1 / (1 + Math.exp(-value));

function probabilityFromOutput(data, output) {
  if (output.type === "binary-logit") return sigmoid(Number(data[0]));
  if (output.type === "softmax") {
    const values = Array.from(data, Number);
    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp(value - max));
    const total = exps.reduce((sum, value) => sum + value, 0);
    const index = Number(output.ai_index);
    if (!Number.isInteger(index) || index < 0 || index >= exps.length || total === 0) {
      throw new Error("model output mapping is invalid");
    }
    return exps[index] / total;
  }
  throw new Error(`unknown model output type: ${output.type}`);
}

async function runView(session, config, rgb) {
  const size = config.input_size;
  const input = new ort.Tensor(
    "float32",
    toCHW(rgb, config.image_mean, config.image_std, size),
    [1, 3, size, size]
  );
  const result = await session.run({ [session.inputNames[0]]: input });
  return probabilityFromOutput(result[session.outputNames[0]].data, config.output);
}

function calibrate(probability, calibration) {
  if (!calibration) return probability;
  const bounded = Math.min(Math.max(probability, 1e-12), 1 - 1e-12);
  return sigmoid(calibration.a * Math.log(bounded / (1 - bounded)) + calibration.b);
}

function createView(bitmap, config, viewName) {
  if (config.preprocess === "vit-bilinear") return viewViTResize(bitmap, config.input_size);
  return COMMUNITY_VIEWS[viewName](bitmap);
}

async function scoreViews(bitmap, config, session) {
  const viewScores = [];
  for (const viewName of config.views) {
    viewScores.push(await runView(session, config, createView(bitmap, config, viewName)));
  }
  return viewScores;
}

export async function scoreBitmap(bitmap, modelId = "community", useGpuAcceleration = false) {
  const { id, config } = await resolveModel(modelId);
  const gpuRequested = Boolean(useGpuAcceleration);
  let session = await loadModel(id, gpuRequested);
  let viewScores;
  try {
    viewScores = await scoreViews(bitmap, config, session);
  } catch (error) {
    if (!gpuRequested || backends.get(id) !== "webgpu") throw error;
    session = await fallBackToWasm(id, config, error);
    viewScores = await scoreViews(bitmap, config, session);
  }
  const raw = viewScores.reduce((sum, value) => sum + value, 0) / viewScores.length;
  return {
    probability: calibrate(raw, config.calibration),
    raw,
    views: viewScores,
    viewNames: config.views,
    backend: backends.get(id) || "unknown",
    threshold: config.threshold ?? 0.5,
    modelId: id,
    modelLabel: config.label,
    model: config.model_id
  };
}
