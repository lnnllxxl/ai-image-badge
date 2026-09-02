export function normalizeProvenanceImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.toLowerCase() === "pbs.twimg.com" && /^\/media\//i.test(url.pathname)) {
      // Xの表示用small/medium WebPは縮小・再圧縮される。
      // Content Provenance APIには、利用可能な最大解像度のJPEGを送る。
      url.searchParams.set("format", "jpg");
      url.searchParams.set("name", "orig");
    }
    return url.href;
  } catch {
    return rawUrl;
  }
}
