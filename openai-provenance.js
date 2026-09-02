export const OPENAI_PROVENANCE_ENDPOINT = "https://api.openai.com/v1/content_provenance_checks";

export class OpenAiProvenanceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "OpenAiProvenanceError";
    this.code = code;
  }
}

function isDetected(result) {
  return String(result?.outcome || "").toLowerCase() === "detected";
}

export function summarizeOpenAiProvenance(payload) {
  if (!payload || payload.object !== "content_provenance_check" || !Array.isArray(payload.results)) {
    throw new OpenAiProvenanceError("invalid-response");
  }

  const results = payload.results.map((result) => ({
    type: String(result?.type || "").toLowerCase(),
    outcome: String(result?.outcome || "").toLowerCase(),
    validationState: String(result?.validation_state || "").toLowerCase(),
    issuer: String(result?.issuer || ""),
    model: String(result?.model || ""),
    generatedAt: String(result?.generated_at || "")
  }));
  const synthId = results.find((result) =>
    result.type.replace(/[_-]/g, "") === "synthid" && isDetected(result)
  );
  const trustedC2pa = results.find((result) =>
    result.type === "c2pa" && isDetected(result) && result.validationState === "trusted"
  );

  return {
    checked: true,
    detected: Boolean(synthId || trustedC2pa),
    synthIdDetected: Boolean(synthId),
    trustedC2paDetected: Boolean(trustedC2pa),
    issuer: trustedC2pa?.issuer || "OpenAI",
    model: synthId?.model || trustedC2pa?.model || "",
    generatedAt: synthId?.generatedAt || trustedC2pa?.generatedAt || "",
    results
  };
}

export async function requestOpenAiProvenance({
  apiKey,
  blob,
  filename = "image.png",
  fetchImpl = fetch,
  signal
}) {
  if (!apiKey || apiKey.trim().length < 20) {
    throw new OpenAiProvenanceError("missing-api-key");
  }
  if (!(blob instanceof Blob)) throw new OpenAiProvenanceError("invalid-file");

  const form = new FormData();
  form.append("file", blob, filename);
  let response;
  try {
    response = await fetchImpl(OPENAI_PROVENANCE_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      body: form,
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new OpenAiProvenanceError("timeout");
    throw new OpenAiProvenanceError("network-error");
  }

  if (!response.ok) {
    throw new OpenAiProvenanceError(`api-http-${response.status}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new OpenAiProvenanceError("invalid-response");
  }
  return summarizeOpenAiProvenance(payload);
}
