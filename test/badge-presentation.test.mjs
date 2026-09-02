import assert from "node:assert/strict";
import test from "node:test";

await import("../content/badge-presentation.js");
const { getBadgePresentation } = globalThis.ChatGptAiBadgePresentation;

test("confirmed C2PA result gives C2PA display priority", () => {
  const result = getBadgePresentation({
    status: "confirmed",
    basis: "explicit-metadata",
    c2paDetected: true
  });
  assert.equal(result.text, "AI【C2PA】");
  assert.equal(result.method, "C2PA / Content Credentials");
});

test("trusted OpenAI C2PA also uses the C2PA badge", () => {
  const result = getBadgePresentation({
    status: "confirmed",
    basis: "openai-provenance",
    c2paDetected: true
  });
  assert.equal(result.text, "AI【C2PA】");
  assert.match(result.method, /OpenAI公式Content Provenance API/);
});

test("OpenAI SynthID gets the highest-priority badge label", () => {
  const result = getBadgePresentation({
    status: "confirmed",
    basis: "openai-provenance",
    synthIdDetected: true,
    c2paDetected: false
  });
  assert.equal(result.text, "AI【SynthID】");
});

test("OpenAI SynthID wins when trusted C2PA is also detected", () => {
  const result = getBadgePresentation({
    status: "confirmed",
    basis: "openai-provenance",
    synthIdDetected: true,
    c2paDetected: true
  });
  assert.equal(result.text, "AI【SynthID】");
  assert.match(result.heading, /SynthIDと信頼済みC2PA/);
});

test("non-AI C2PA result is difficult rather than an AI or non-generated claim", () => {
  const result = getBadgePresentation({ status: "none", c2paDetected: true });
  assert.equal(result.kind, "likely");
  assert.equal(result.text, "AIかも【C2PA】");
  assert.match(result.method, /生成AI由来の記録を未確認/);
});

test("likely C2PA result remains difficult without confirmed generative provenance", () => {
  const result = getBadgePresentation({ status: "likely", c2paDetected: true });
  assert.equal(result.text, "AIかも【C2PA】");
});

test("confirmed local result uses the model badge and exposes its method", () => {
  const result = getBadgePresentation({
    status: "confirmed",
    basis: "multiple-signals",
    analysis: { localModelLabel: "Community Forensics ViT" }
  });
  assert.equal(result.text, "AI【モデル判定】");
  assert.match(result.method, /Community Forensics ViT/);
});

test("C2PA without generative provenance does not replace a confirmed model method", () => {
  const result = getBadgePresentation({
    status: "confirmed",
    basis: "multiple-signals",
    c2paDetected: true,
    analysis: { localModelLabel: "Community Forensics ViT" }
  });
  assert.equal(result.text, "AI【モデル判定】");
  assert.match(result.method, /Community Forensics ViT/);
});

test("likely local result uses the difficult badge", () => {
  const result = getBadgePresentation({
    status: "likely",
    basis: "pixel-model",
    analysis: { localModelLabel: "Distilled ViT Q4" }
  });
  assert.equal(result.text, "AIかも");
  assert.equal(result.method, "Distilled ViT Q4");
});

test("unavailable images are difficult instead of non-generated", () => {
  const result = getBadgePresentation({ status: "none", unavailable: true });
  assert.equal(result.kind, "likely");
  assert.equal(result.text, "AIかも");
  assert.match(result.method, /判定未完了/);
});

test("conflicting signals are difficult instead of non-generated", () => {
  const result = getBadgePresentation({ status: "none", basis: "conflicting-signals" });
  assert.equal(result.kind, "likely");
  assert.equal(result.text, "AIかも");
  assert.match(result.method, /根拠が不一致/);
});

test("a result without AI evidence displays the non-generated label", () => {
  const result = getBadgePresentation({
    status: "none",
    c2paDetected: false,
    analysis: {
      localModelLabel: "Community Forensics ViT",
      pixelProbability: 0.314
    }
  });
  assert.equal(result.text, "非生成かも");
  assert.equal(result.localScore, "Community Forensics ViT／生成AIらしさ 31%");
});

test("a non-generated result explains when no local model score is available", () => {
  const result = getBadgePresentation({ status: "none", c2paDetected: false });
  assert.equal(result.text, "非生成かも");
  assert.match(result.localScore, /未取得/);
});
