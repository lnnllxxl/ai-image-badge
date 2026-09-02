import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const registry = JSON.parse(await readFile(new URL("tools/model.json", root), "utf8"));
const runtimeConfig = JSON.parse(await readFile(new URL("model/config.json", root), "utf8"));

test("three selectable local models are registered", () => {
  assert.equal(registry.default_model, "community");
  assert.deepEqual(registry.models.map((model) => model.id), [
    "community",
    "distilled",
    "capcheck"
  ]);
  assert.deepEqual(Object.keys(runtimeConfig.models).slice(0, 3), ["community", "distilled", "capcheck"]);
  const extraModels = Object.keys(runtimeConfig.models).slice(3);
  assert.ok(extraModels.every((id) => [
    "community-forensics-custom",
    "resnet18-custom",
    "chatgpt-custom"
  ].includes(id)));
});

test("both trainable custom models are accepted across extension contexts", async () => {
  const customIds = ["community-forensics-custom", "resnet18-custom"];
  const background = await readFile(new URL("background.js", root), "utf8");
  const content = await readFile(new URL("content/content.js", root), "utf8");
  const options = await readFile(new URL("options/options.js", root), "utf8");
  for (const id of customIds) {
    assert.match(background, new RegExp(`['\"]${id}['\"]`));
    assert.match(content, new RegExp(`['\"]${id}['\"]`));
    assert.match(options, new RegExp(`id: ['\"]${id}['\"]`));
  }
});

test("GPU acceleration is opt-in and falls back from WebGPU to WASM", async () => {
  const source = await readFile(new URL("ml/model-detector.js", root), "utf8");
  assert.match(source, /Boolean\(useGpuAcceleration\)/);
  assert.match(source, /\["webgpu", "wasm"\]/);
  assert.match(source, /\["wasm"\]/);
  assert.match(source, /fallBackToWasm/);
  assert.match(source, /powerPreference = "high-performance"/);
});

test("GPU acceleration defaults to off across extension settings", async () => {
  const files = [
    "content/content.js",
    "options/options.js",
    "popup/popup.js"
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.match(source, /useGpuAcceleration:\s*false/);
  }
});

for (const model of registry.models) {
  test(`${model.id} bundled weights match the pinned SHA-256`, async () => {
    const bytes = await readFile(new URL(`model/${model.weights}`, root));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, model.sha256);
    assert.equal(runtimeConfig.models[model.id].weights, model.weights);
    assert.deepEqual(runtimeConfig.models[model.id].output, model.output);
  });
}
