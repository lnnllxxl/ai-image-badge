import assert from "node:assert/strict";
import test from "node:test";

await import("../content/metadata-fallback.js");
const { inspectBytes } = globalThis.ChatGptAiMetadataFallback;
const encode = (value) => new TextEncoder().encode(value);

test("page fallback detects C2PA trained algorithmic media", () => {
  const result = inspectBytes(encode(
    "JP jumb jumd c2pa digitalSourceType trainedAlgorithmicMedia"
  ), { mimeType: "image/jpeg" });
  assert.equal(result.status, "confirmed");
  assert.equal(result.c2paDetected, true);
  assert.equal(result.hasProvenance, true);
});

test("page fallback reports C2PA without forcing an AI result", () => {
  const result = inspectBytes(encode("JP jumb jumd c2pa camera capture"));
  assert.equal(result.status, "none");
  assert.equal(result.c2paDetected, true);
});

test("page fallback returns null when C2PA is absent", () => {
  assert.equal(inspectBytes(encode("ordinary JPEG metadata")), null);
});
