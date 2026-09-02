import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseBestResult,
  fuseDetectionResults,
  inspectBytes,
  inspectPageHints,
  inspectUrl
} from "../detector.js";

const encode = (value) => new TextEncoder().encode(value);

test("Stable Diffusion metadata is confirmed", async () => {
  const result = await inspectBytes(encode("Generator: Stable Diffusion XL; Steps: 30"));
  assert.equal(result.status, "confirmed");
  assert.ok(result.reasons.some((reason) => reason.includes("Stable Diffusion")));
});

test("C2PA provenance alone is not treated as AI", async () => {
  const result = await inspectBytes(encode("c2pa.assertions camera capture Content Credentials"));
  assert.equal(result.status, "none");
  assert.equal(result.hasProvenance, true);
  assert.equal(result.c2paDetected, true);
});

test("trained algorithmic media provenance is confirmed", async () => {
  const result = await inspectBytes(encode("digitalSourceType: trainedAlgorithmicMedia; c2pa"));
  assert.equal(result.status, "confirmed");
  assert.equal(result.hasProvenance, true);
  assert.equal(result.c2paDetected, true);
});

test("known generator host is advisory rather than an AI badge by itself", () => {
  const result = inspectUrl("https://cdn.midjourney.com/example/image.png");
  assert.equal(result.status, "likely");
  assert.equal(result.advisory, true);
  assert.ok(result.confidence < 0.9);

  const fused = fuseDetectionResults({ urlResult: result });
  assert.equal(fused.status, "none");
  assert.equal(fused.basis, "no-sufficient-signal");
  assert.deepEqual(fused.analysis.contextAdvisories, result.reasons);
});

test("generator words in a URL do not create an AI badge by themselves", () => {
  const result = inspectUrl("https://example.com/articles/midjourney-explainer.jpg");
  assert.equal(result.advisory, true);
  assert.equal(fuseDetectionResults({ urlResult: result }).status, "none");
});

test("page description is only a likely signal", () => {
  const result = inspectPageHints("AI-generated landscape made with Midjourney");
  assert.equal(result.status, "likely");
});

test("a generator URL may support a strong local model without acting alone", () => {
  const result = fuseDetectionResults({
    urlResult: inspectUrl("https://cdn.midjourney.com/example/image.png"),
    localAnalysis: { pixel: { probability: 0.95, backend: "wasm" } }
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.basis, "multiple-signals");
});

test("X AI-generated label is recognized as a likely signal", () => {
  const result = inspectPageHints("AIで生成");
  assert.equal(result.status, "likely");
  assert.ok(result.reasons.some((reason) => reason.includes("説明文")));
});

test("ordinary bytes and URL produce no result", async () => {
  const bytes = await inspectBytes(encode("Camera: Example 35mm; Date: 2026-08-25"));
  const url = inspectUrl("https://example.com/photos/mountain.jpg");
  const result = chooseBestResult(bytes, url);
  assert.equal(result.status, "none");
});

test("strong metadata wins over a weaker URL result", async () => {
  const bytes = await inspectBytes(encode("Generator: DALL-E 3"));
  const url = inspectUrl("https://cdn.midjourney.com/example/image.png");
  assert.equal(chooseBestResult(bytes, url).status, "confirmed");
});

test("high pixel score plus frequency evidence produces the double-circle class", () => {
  const result = fuseDetectionResults({
    localAnalysis: {
      pixel: { probability: 0.96, backend: "wasm" },
      frequency: { anomalyScore: 0.7, reasons: ["周期性あり"] },
      width: 512,
      height: 512
    }
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.basis, "multiple-signals");
});

test("pixel model on its own produces only the single-circle class", () => {
  const result = fuseDetectionResults({
    localAnalysis: {
      pixel: { probability: 0.8, backend: "wasm" },
      frequency: { anomalyScore: 0.2, reasons: [] }
    }
  });
  assert.equal(result.status, "likely");
  assert.equal(result.basis, "pixel-model");
});

test("selected local model is included in the reason and diagnostics", () => {
  const result = fuseDetectionResults({
    localAnalysis: {
      pixel: {
        probability: 0.8,
        backend: "wasm",
        modelId: "distilled",
        modelLabel: "Distilled ViT Q4"
      }
    }
  });
  assert.equal(result.analysis.localModel, "distilled");
  assert.equal(result.analysis.localModelLabel, "Distilled ViT Q4");
  assert.ok(result.reasons.some((reason) => reason.includes("Distilled ViT Q4")));
});

test("default local thresholds are 50 percent and 90 percent", () => {
  const belowLikely = fuseDetectionResults({
    localAnalysis: { pixel: { probability: 0.49, backend: "wasm" } }
  });
  const atLikely = fuseDetectionResults({
    localAnalysis: { pixel: { probability: 0.5, backend: "wasm" } }
  });
  const atConfirmed = fuseDetectionResults({
    localAnalysis: {
      pixel: { probability: 0.9, backend: "wasm" },
      frequency: { anomalyScore: 0.7, reasons: ["周期性あり"] }
    }
  });
  assert.equal(belowLikely.status, "none");
  assert.equal(atLikely.status, "likely");
  assert.equal(atConfirmed.status, "confirmed");
});

test("local likely threshold can be lowered or raised", () => {
  const localAnalysis = { pixel: { probability: 0.6, backend: "wasm" } };
  const lowered = fuseDetectionResults({
    localAnalysis,
    localThresholds: { likely: 0.58, confirmed: 0.88 }
  });
  const raised = fuseDetectionResults({
    localAnalysis,
    localThresholds: { likely: 0.7, confirmed: 0.9 }
  });
  assert.equal(lowered.status, "likely");
  assert.equal(raised.status, "none");
});

test("local confirmed threshold controls the double-circle class", () => {
  const localAnalysis = {
    pixel: { probability: 0.91, backend: "wasm" },
    frequency: { anomalyScore: 0.7, reasons: ["周期性あり"] }
  };
  const strict = fuseDetectionResults({
    localAnalysis,
    localThresholds: { likely: 0.65, confirmed: 0.95 }
  });
  const permissive = fuseDetectionResults({
    localAnalysis,
    localThresholds: { likely: 0.65, confirmed: 0.9 }
  });
  assert.equal(strict.status, "likely");
  assert.equal(permissive.status, "confirmed");
});

test("frequency evidence cannot bypass the configured local likely threshold", () => {
  const result = fuseDetectionResults({
    localAnalysis: {
      pixel: { probability: 0.6, backend: "wasm" },
      frequency: { anomalyScore: 0.8, reasons: ["周期性あり"] }
    },
    localThresholds: { likely: 0.65, confirmed: 0.88 }
  });
  assert.equal(result.status, "none");
});

test("frequency evidence alone never labels an image as AI", () => {
  const result = fuseDetectionResults({
    localAnalysis: { frequency: { anomalyScore: 1, reasons: ["周期性あり"] } }
  });
  assert.equal(result.status, "none");
});

test("strong disagreement is shown as undetermined", () => {
  const result = fuseDetectionResults({
    hintResult: { status: "likely", confidence: 0.72, reasons: ["AI生成との説明"], evidence: ["ページ上の説明"] },
    localAnalysis: { pixel: { probability: 0.2, backend: "wasm" } }
  });
  assert.equal(result.status, "none");
  assert.equal(result.basis, "conflicting-signals");
});

test("official OpenAI SynthID detection wins over all heuristic signals", () => {
  const result = fuseDetectionResults({
    localAnalysis: { pixel: { probability: 0.05, backend: "wasm" } },
    openAiProvenance: {
      checked: true,
      detected: true,
      synthIdDetected: true,
      trustedC2paDetected: false,
      issuer: "OpenAI",
      model: "gpt-image"
    }
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.basis, "openai-provenance");
  assert.equal(result.provenancePriority, "openai-synthid");
  assert.ok(result.evidence.includes("OpenAI SynthID"));
  assert.equal(result.c2paDetected, false);
});

test("trusted OpenAI C2PA is exposed to the badge presentation", () => {
  const result = fuseDetectionResults({
    openAiProvenance: {
      checked: true,
      detected: true,
      synthIdDetected: false,
      trustedC2paDetected: true,
      issuer: "OpenAI"
    }
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.basis, "openai-provenance");
  assert.equal(result.provenancePriority, "openai-c2pa");
  assert.equal(result.c2paDetected, true);
  assert.ok(result.evidence.includes("OpenAI C2PA"));
});

test("OpenAI not-detected does not suppress local analysis", () => {
  const result = fuseDetectionResults({
    localAnalysis: { pixel: { probability: 0.8, backend: "wasm" } },
    openAiProvenance: { checked: true, detected: false }
  });
  assert.equal(result.status, "likely");
  assert.equal(result.basis, "pixel-model");
});
