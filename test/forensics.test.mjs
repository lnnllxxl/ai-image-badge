import assert from "node:assert/strict";
import test from "node:test";

import { analyzeRgbaPixels } from "../ml/forensics.js";

function pixels(generator, size = 64) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = generator(x, y);
      const index = (y * size + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return data;
}

test("frequency analysis is deterministic and bounded", () => {
  const sample = pixels((x, y) => ((x * 17 + y * 31) % 256));
  const first = analyzeRgbaPixels(sample, 64, 64);
  const second = analyzeRgbaPixels(sample, 64, 64);
  assert.equal(first.anomalyScore, second.anomalyScore);
  assert.ok(first.anomalyScore >= 0 && first.anomalyScore <= 1);
  for (const value of Object.values(first.metrics)) assert.ok(Number.isFinite(value));
});

test("small pixel buffers are skipped safely", () => {
  const result = analyzeRgbaPixels(new Uint8ClampedArray(8 * 8 * 4), 8, 8);
  assert.equal(result.skipped, "too-small");
  assert.equal(result.anomalyScore, 0);
});

test("smooth gradients do not produce invalid metrics", () => {
  const result = analyzeRgbaPixels(pixels((x, y) => Math.round((x + y) * 255 / 126)), 64, 64);
  assert.ok(result.anomalyScore >= 0 && result.anomalyScore <= 1);
  assert.ok(Number.isFinite(result.metrics.spectralPeak));
});
