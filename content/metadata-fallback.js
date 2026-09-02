(() => {
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

  const C2PA_PATTERNS = [
    /c2pa/i,
    /content credentials/i,
    /contentauthenticity/i,
    /jumbf/i
  ];

  const AI_SOURCE_PATTERNS = [
    /trainedalgorithmicmedia/i,
    /compositewithtrainedalgorithmicmedia/i,
    /algorithmicallyenhancedmedia/i,
    /digitalSourceType[^\n]{0,160}(?:generative|algorithmic)/i
  ];

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function decodeBytes(bytes) {
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const latin1 = new TextDecoder("windows-1252", { fatal: false }).decode(bytes);
    return `${utf8}\n${latin1}`;
  }

  function inspectBytes(input, metadata = {}) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    const text = decodeBytes(bytes);
    const c2paDetected = C2PA_PATTERNS.some((pattern) => pattern.test(text));
    if (!c2paDetected) return null;

    const aiSourceDetected = AI_SOURCE_PATTERNS.some((pattern) => pattern.test(text));
    return {
      status: aiSourceDetected ? "confirmed" : "none",
      confidence: aiSourceDetected ? 0.98 : 0,
      reasons: aiSourceDetected
        ? ["Content Credentials に生成AI由来の記録があります"]
        : ["C2PA / Content Credentials を検出しました"],
      evidence: unique([
        aiSourceDetected ? "trained-algorithmic-media" : null,
        "C2PA / Content Credentials",
        "ページ内画像から再取得"
      ]),
      hasProvenance: true,
      c2paDetected: true,
      mimeType: metadata.mimeType || ""
    };
  }

  async function readPrefix(response) {
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer.slice(0, MAX_IMAGE_BYTES));
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (total < MAX_IMAGE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = MAX_IMAGE_BYTES - total;
        const chunk = value.length > remaining ? value.subarray(0, remaining) : value;
        chunks.push(chunk);
        total += chunk.length;
        if (chunk.length < value.length) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  async function inspectSource(url) {
    try {
      const protocol = new URL(url, document.baseURI).protocol;
      if (!["http:", "https:", "blob:", "file:"].includes(protocol)) return null;

      const response = await fetch(url, {
        cache: "force-cache",
        credentials: "include"
      });
      if (!response.ok) return null;

      const mimeType = response.headers.get("content-type") || "";
      if (/^(?:text\/html|application\/(?:json|xml))/i.test(mimeType)) return null;
      return inspectBytes(await readPrefix(response), { mimeType });
    } catch {
      return null;
    }
  }

  globalThis.ChatGptAiMetadataFallback = Object.freeze({
    inspectBytes,
    inspectSource
  });
})();
