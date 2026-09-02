#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = JSON.parse(await readFile(join(ROOT, "tools", "model.json"), "utf8"));
const ORT_FILES = [
  "ort.bundle.min.mjs",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm"
];

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function vendorRuntime() {
  const source = join(ROOT, "node_modules", "onnxruntime-web", "dist");
  if (!existsSync(source)) throw new Error("onnxruntime-web がありません。先に pnpm install を実行してください。");
  const target = join(ROOT, "vendor");
  await mkdir(target, { recursive: true });
  const available = new Set(await readdir(source));
  for (const name of ORT_FILES) {
    if (!available.has(name)) throw new Error(`ONNX Runtime ファイルがありません: ${name}`);
    await copyFile(join(source, name), join(target, name));
  }
}

async function fetchWeights(model) {
  const targetDir = join(ROOT, "model");
  const target = join(targetDir, model.weights);
  await mkdir(targetDir, { recursive: true });
  if (existsSync(target) && await sha256(target) === model.sha256) return target;

  const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`モデル取得失敗: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== model.sha256) {
    throw new Error(`モデルのSHA-256が一致しません: ${actual}`);
  }
  await writeFile(target, bytes);
  return target;
}

async function writeConfig() {
  const models = Object.fromEntries(REGISTRY.models.map((model) => [model.id, {
    label: model.label,
    model_id: `${model.repo}@${model.revision.slice(0, 12)}`,
    weights: model.weights,
    input_size: model.input_size,
    preprocess: model.preprocess,
    image_mean: model.image_mean,
    image_std: model.image_std,
    views: model.views,
    output: model.output,
    ...(model.calibration ? { calibration: model.calibration } : {}),
    threshold: model.threshold,
    source: model.source
  }]));
  const configPath = join(ROOT, "model", "config.json");
  if (existsSync(configPath)) {
    try {
      const existing = JSON.parse(await readFile(configPath, "utf8"));
      const customIds = ["community-forensics-custom", "resnet18-custom", "chatgpt-custom"];
      for (const customId of customIds) {
        const custom = existing?.models?.[customId];
        if (custom?.weights && existsSync(join(ROOT, "model", custom.weights))) {
          models[customId] = custom;
        }
      }
    } catch {}
  }
  const config = { default_model: REGISTRY.default_model, models };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

await vendorRuntime();
const modelPaths = [];
for (const model of REGISTRY.models) modelPaths.push(await fetchWeights(model));
await writeConfig();
let size = 0;
for (const modelPath of modelPaths) size += (await stat(modelPath)).size;
console.log(`3モデルとONNX Runtimeを準備しました (${(size / 1e6).toFixed(1)} MB)`);
