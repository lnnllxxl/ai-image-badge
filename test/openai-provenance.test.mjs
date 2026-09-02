import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_PROVENANCE_ENDPOINT,
  requestOpenAiProvenance,
  summarizeOpenAiProvenance
} from "../openai-provenance.js";

test("SynthID detected response is normalized", () => {
  const result = summarizeOpenAiProvenance({
    object: "content_provenance_check",
    results: [{ type: "synthid", outcome: "detected", model: "gpt-image-test" }]
  });
  assert.equal(result.detected, true);
  assert.equal(result.synthIdDetected, true);
  assert.equal(result.model, "gpt-image-test");
});

test("trusted C2PA is detected but an untrusted result is not", () => {
  const trusted = summarizeOpenAiProvenance({
    object: "content_provenance_check",
    results: [{ type: "c2pa", outcome: "detected", validation_state: "trusted", issuer: "OpenAI" }]
  });
  const untrusted = summarizeOpenAiProvenance({
    object: "content_provenance_check",
    results: [{ type: "c2pa", outcome: "detected", validation_state: "untrusted" }]
  });
  assert.equal(trusted.trustedC2paDetected, true);
  assert.equal(untrusted.detected, false);
});

test("not_detected is preserved as checked without claiming non-AI", () => {
  const result = summarizeOpenAiProvenance({
    object: "content_provenance_check",
    results: [
      { type: "synth_id", outcome: "not_detected" },
      { type: "c2pa", outcome: "not_detected", validation_state: "none" }
    ]
  });
  assert.equal(result.checked, true);
  assert.equal(result.detected, false);
});

test("request uses the official multipart endpoint and bearer key", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, OPENAI_PROVENANCE_ENDPOINT);
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-api-key-12345678901234567890");
    assert.ok(options.body instanceof FormData);
    assert.ok(options.body.get("file") instanceof Blob);
    return new Response(JSON.stringify({
      object: "content_provenance_check",
      results: [{ type: "synthid", outcome: "detected" }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await requestOpenAiProvenance({
    apiKey: "test-api-key-12345678901234567890",
    blob: new Blob(["image"], { type: "image/png" }),
    filename: "sample.png",
    fetchImpl
  });
  assert.equal(result.synthIdDetected, true);
});

test("missing API key fails before a network request", async () => {
  await assert.rejects(
    requestOpenAiProvenance({ apiKey: "", blob: new Blob(["x"]) }),
    (error) => error.code === "missing-api-key"
  );
});
