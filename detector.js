export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LOCAL_THRESHOLDS = Object.freeze({
  likely: 0.5,
  confirmed: 0.9
});

const EXPLICIT_AI_RULES = [
  {
    id: "trained-algorithmic-media",
    label: "Content Credentials に生成AI由来の記録があります",
    patterns: [
      /trainedalgorithmicmedia/i,
      /compositewithtrainedalgorithmicmedia/i,
      /algorithmicallyenhancedmedia/i,
      /digitalSourceType[^\n]{0,160}(?:generative|algorithmic)/i
    ]
  },
  {
    id: "stable-diffusion",
    label: "Stable Diffusion 系の生成メタデータがあります",
    patterns: [
      /stable[\s_-]*diffusion/i,
      /automatic1111/i,
      /comfy[\s_-]*ui/i,
      /invoke[\s_-]*ai/i,
      /fooocus/i,
      /novel[\s_-]*ai/i
    ]
  },
  {
    id: "diffusion-parameters",
    label: "拡散モデル特有の生成パラメータがあります",
    allPatterns: [
      /negative prompt/i,
      /steps\s*[:=]\s*\d+/i,
      /(?:sampler|cfg scale)\s*[:=]/i
    ]
  },
  {
    id: "openai-image",
    label: "OpenAI の画像生成ツールを示すメタデータがあります",
    patterns: [
      /dall[\s·._-]*e/i,
      /gpt-image(?:-\d+)?/i,
      /openai[^\n]{0,80}(?:image|generated)/i
    ]
  },
  {
    id: "midjourney",
    label: "Midjourney を示すメタデータがあります",
    patterns: [/midjourney/i]
  },
  {
    id: "adobe-firefly",
    label: "Adobe Firefly／生成塗りつぶしを示すメタデータがあります",
    patterns: [/adobe[\s_-]*firefly/i, /generative[\s_-]*fill/i]
  },
  {
    id: "other-generators",
    label: "画像生成サービスを示すメタデータがあります",
    patterns: [
      /black[\s_-]*forest[\s_-]*labs/i,
      /(?:model|generator)[\s:=\"']{1,12}flux(?:\.|-|\s|\d)/i,
      /leonardo[\s._-]*ai/i,
      /ideogram[\s._-]*(?:ai)?/i,
      /runway[\s._-]*ml/i,
      /playground[\s._-]*ai/i,
      /dreamstudio/i
    ]
  }
];

const PROVENANCE_PATTERNS = [
  /c2pa/i,
  /content credentials/i,
  /contentauthenticity/i,
  /jumbf/i
];

const LIKELY_HOSTS = [
  [/(?:^|\.)cdn\.midjourney\.com$/i, "Midjourney の配信元です"],
  [/(?:^|\.)oaidalleapiprodscus\.blob\.core\.windows\.net$/i, "OpenAI 画像生成の配信元です"],
  [/(?:^|\.)images\.openai\.com$/i, "OpenAI の画像配信元です"],
  [/(?:^|\.)image\.pollinations\.ai$/i, "画像生成サービスの配信元です"],
  [/(?:^|\.)replicate\.delivery$/i, "生成モデル実行サービスの配信元です"],
  [/(?:^|\.)fal\.media$/i, "生成モデル実行サービスの配信元です"],
  [/(?:^|\.)ideogram\.ai$/i, "画像生成サービスの配信元です"]
];

const LIKELY_PATH_PATTERN = /(?:dall[._-]?e|midjourney|stable[._-]?diffusion|ai[._-]?generated|generated[._-]?image)/i;

function unique(values) {
  return [...new Set(values)];
}

function matchRules(text) {
  return EXPLICIT_AI_RULES.filter((rule) => {
    if (rule.allPatterns) {
      return rule.allPatterns.every((pattern) => pattern.test(text));
    }
    return rule.patterns.some((pattern) => pattern.test(text));
  });
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function decodeBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(view);
  const latin1 = new TextDecoder("windows-1252", { fatal: false }).decode(view);
  return `${utf8}\n${latin1}`;
}

async function inflate(compressed) {
  if (typeof DecompressionStream === "undefined") {
    return "";
  }

  try {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new TextDecoder("utf-8", { fatal: false }).decode(await new Response(stream).arrayBuffer());
  } catch {
    return "";
  }
}

async function extractPngText(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || !signature.every((value, index) => bytes[index] === value)) {
    return [];
  }

  const texts = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    if (length > MAX_IMAGE_BYTES || offset + 12 + length > bytes.length) {
      break;
    }

    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);

    if (type === "tEXt") {
      texts.push(new TextDecoder("windows-1252").decode(data));
    } else if (type === "zTXt") {
      const separator = data.indexOf(0);
      if (separator >= 0 && separator + 2 <= data.length) {
        const keyword = new TextDecoder("windows-1252").decode(data.subarray(0, separator));
        texts.push(`${keyword}\n${await inflate(data.subarray(separator + 2))}`);
      }
    } else if (type === "iTXt") {
      const keywordEnd = data.indexOf(0);
      if (keywordEnd >= 0 && keywordEnd + 3 <= data.length) {
        let cursor = keywordEnd + 3;
        const languageEnd = data.indexOf(0, cursor);
        if (languageEnd < 0) break;
        cursor = languageEnd + 1;
        const translatedEnd = data.indexOf(0, cursor);
        if (translatedEnd < 0) break;
        cursor = translatedEnd + 1;
        const keyword = new TextDecoder("utf-8").decode(data.subarray(0, keywordEnd));
        const value = data[keywordEnd + 1] === 1
          ? await inflate(data.subarray(cursor))
          : new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(cursor));
        texts.push(`${keyword}\n${value}`);
      }
    }

    offset += length + 12;
    if (type === "IEND") break;
  }

  return texts;
}

export function inspectUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const hostRule = LIKELY_HOSTS.find(([pattern]) => pattern.test(url.hostname));
    if (hostRule) {
      return {
        status: "likely",
        confidence: 0.78,
        reasons: [hostRule[1]],
        evidence: ["配信元URL"],
        advisory: true
      };
    }

    if (LIKELY_PATH_PATTERN.test(`${url.pathname}${url.search}`)) {
      return {
        status: "likely",
        confidence: 0.62,
        reasons: ["URLに画像生成を示す名前が含まれます"],
        evidence: ["URL文字列"],
        advisory: true
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function inspectPageHints(hints) {
  const text = String(hints || "").slice(0, 1000);
  const strong = /(?:generated|created|made)\s+(?:by|with|using)\s+(?:an?\s+)?(?:generative\s+)?ai|ai[\s_-]*generated|生成\s*ai|ai\s*(?:で\s*)?生成|生成ai(?:で|によって|を使)/i;
  const generator = /stable diffusion|midjourney|dall[\s._-]*e|adobe firefly|gpt-image|comfyui/i;

  if (strong.test(text) || generator.test(text)) {
    return {
      status: "likely",
      confidence: strong.test(text) && generator.test(text) ? 0.72 : 0.58,
      reasons: ["画像の説明文に生成AIを示す表現があります"],
      evidence: ["ページ上の説明"]
    };
  }

  return null;
}

export async function inspectBytes(input, metadata = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const extractedText = await extractPngText(bytes);
  const searchText = `${decodeBytes(bytes)}\n${extractedText.join("\n")}`;
  const matchedRules = matchRules(searchText);
  const provenance = hasAny(searchText, PROVENANCE_PATTERNS);

  if (matchedRules.length > 0) {
    return {
      status: "confirmed",
      confidence: 0.98,
      reasons: unique(matchedRules.map((rule) => rule.label)),
      evidence: unique([
        ...matchedRules.map((rule) => rule.id),
        provenance ? "C2PA / Content Credentials" : null
      ].filter(Boolean)),
      hasProvenance: provenance,
      c2paDetected: provenance,
      mimeType: metadata.mimeType || ""
    };
  }

  return {
    status: "none",
    confidence: 0,
    reasons: provenance
      ? ["来歴情報はありますが、生成AI由来とは確認できません"]
      : [],
    evidence: provenance ? ["C2PA / Content Credentials"] : [],
    hasProvenance: provenance,
    c2paDetected: provenance,
    mimeType: metadata.mimeType || ""
  };
}

export function chooseBestResult(...results) {
  const valid = results.filter(Boolean);
  if (valid.length === 0) {
    return { status: "none", confidence: 0, reasons: [], evidence: [] };
  }
  return valid.sort((a, b) => b.confidence - a.confidence)[0];
}

function mergeUnique(...groups) {
  return unique(groups.flat().filter(Boolean));
}

function normalizeProbability(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(0.99, Math.max(0.01, number)) : fallback;
}

function normalizeLocalThresholds(value) {
  const likely = normalizeProbability(value?.likely, DEFAULT_LOCAL_THRESHOLDS.likely);
  const confirmed = Math.max(
    likely,
    normalizeProbability(value?.confirmed, DEFAULT_LOCAL_THRESHOLDS.confirmed)
  );
  return { likely, confirmed };
}

/**
 * 明示メタデータ、画像モデル、周波数解析、ページ文脈を統合する。
 * 周波数解析だけではAI判定を出さず、常に補助根拠として扱う。
 */
export function fuseDetectionResults({
  byteResult = null,
  urlResult = null,
  hintResult = null,
  localAnalysis = null,
  openAiProvenance = null,
  localThresholds = DEFAULT_LOCAL_THRESHOLDS
} = {}) {
  const context = chooseBestResult(urlResult, hintResult);
  const labelContext = chooseBestResult(hintResult);
  const pixel = localAnalysis?.pixel || null;
  const frequency = localAnalysis?.frequency || null;
  const probability = Number.isFinite(pixel?.probability) ? pixel.probability : null;
  const anomaly = Number.isFinite(frequency?.anomalyScore) ? frequency.anomalyScore : null;
  const thresholds = normalizeLocalThresholds(localThresholds);
  const c2paDetected = Boolean(byteResult?.c2paDetected || openAiProvenance?.trustedC2paDetected);
  const analysis = {
    pixelProbability: probability,
    frequencyAnomaly: anomaly,
    localLikelyThreshold: thresholds.likely,
    localConfirmedThreshold: thresholds.confirmed,
    backend: pixel?.backend || "",
    localModel: pixel?.modelId || "",
    localModelLabel: pixel?.modelLabel || "",
    width: localAnalysis?.width || 0,
    height: localAnalysis?.height || 0,
    localError: localAnalysis?.error || "",
    contextAdvisories: urlResult?.advisory ? mergeUnique(urlResult.reasons) : []
  };

  analysis.openAiChecked = Boolean(openAiProvenance?.checked);
  analysis.openAiDetected = Boolean(openAiProvenance?.detected);
  analysis.openAiError = openAiProvenance?.error || "";

  if (openAiProvenance?.detected) {
    const reasons = [];
    const evidence = [];
    if (openAiProvenance.synthIdDetected) {
      reasons.push("OpenAI公式APIがSynthIDウォーターマークを検出しました");
      evidence.push("OpenAI SynthID");
    }
    if (openAiProvenance.trustedC2paDetected) {
      reasons.push("OpenAI公式APIが信頼済みContent Credentialsを検出しました");
      evidence.push("OpenAI C2PA");
    }
    if (openAiProvenance.model) reasons.push(`OpenAIモデル: ${openAiProvenance.model}`);
    return {
      status: "confirmed",
      confidence: 0.995,
      reasons,
      evidence,
      basis: "openai-provenance",
      provenancePriority: openAiProvenance.synthIdDetected
        ? "openai-synthid"
        : "openai-c2pa",
      issuer: openAiProvenance.issuer || "OpenAI",
      c2paDetected,
      synthIdDetected: Boolean(openAiProvenance.synthIdDetected),
      analysis
    };
  }

  if (byteResult?.status === "confirmed") {
    return {
      ...byteResult,
      reasons: mergeUnique(byteResult.reasons),
      evidence: mergeUnique(byteResult.evidence),
      basis: "explicit-metadata",
      c2paDetected,
      analysis
    };
  }

  const modelReason = probability === null
    ? ""
    : `ローカル画像モデル${pixel?.modelLabel ? `（${pixel.modelLabel}）` : ""}: 生成AIらしさ ${Math.round(probability * 100)}%`;
  const frequencyStrong = anomaly !== null && anomaly >= 0.55;
  const contextSupport = context.status === "likely";
  const contextStrong = labelContext.status === "likely";

  if (probability !== null && probability >= thresholds.confirmed && (frequencyStrong || contextSupport)) {
    const supportingReasons = frequencyStrong
      ? ["周波数・ノイズ解析でも生成画像に似た特徴を検出しました", ...(frequency.reasons || [])]
      : context.reasons;
    return {
      status: "confirmed",
      confidence: Math.max(0.9, probability),
      reasons: mergeUnique(modelReason, supportingReasons),
      evidence: mergeUnique(
        "ローカル画像モデル",
        frequencyStrong ? "周波数・ノイズ分析" : context.evidence
      ),
      basis: "multiple-signals",
      c2paDetected,
      analysis
    };
  }

  if (probability !== null && probability >= thresholds.likely && anomaly !== null && anomaly >= 0.65) {
    return {
      status: "likely",
      confidence: probability,
      reasons: mergeUnique(modelReason, "周波数・ノイズ解析が画像モデルを補強しました", frequency.reasons),
      evidence: ["ローカル画像モデル", "周波数・ノイズ分析"],
      basis: "pixel-plus-frequency",
      c2paDetected,
      analysis
    };
  }

  if (probability !== null && probability >= thresholds.likely) {
    return {
      status: "likely",
      confidence: probability,
      reasons: mergeUnique(modelReason),
      evidence: ["ローカル画像モデル"],
      basis: "pixel-model",
      c2paDetected,
      analysis
    };
  }

  if (contextStrong && !(probability !== null && probability <= 0.35)) {
    return {
      ...labelContext,
      basis: "page-context",
      c2paDetected,
      analysis
    };
  }

  const disagreement = contextStrong && probability !== null && probability <= 0.35;
  return {
    status: "none",
    confidence: 0,
    reasons: mergeUnique(
      byteResult?.reasons,
      disagreement ? "画像モデルとURL／説明文の手がかりが一致しないためAIかもとして表示します" : null
    ),
    evidence: mergeUnique(byteResult?.evidence),
    hasProvenance: Boolean(byteResult?.hasProvenance),
    c2paDetected,
    basis: disagreement ? "conflicting-signals" : "no-sufficient-signal",
    analysis
  };
}
