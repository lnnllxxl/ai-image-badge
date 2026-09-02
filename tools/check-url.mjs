import { chooseBestResult, inspectBytes, inspectUrl } from "../detector.js";

const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error("Usage: node tools/check-url.mjs <image-url>");
  process.exitCode = 1;
} else {
  const response = await fetch(targetUrl, {
    redirect: "follow",
    headers: { Range: "bytes=0-2097151" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array((await response.arrayBuffer()).slice(0, 2 * 1024 * 1024));
  const result = chooseBestResult(
    await inspectBytes(bytes, { mimeType: response.headers.get("content-type") || "" }),
    inspectUrl(targetUrl)
  );
  console.log(JSON.stringify({
    requestedUrl: targetUrl,
    resolvedUrl: response.url,
    httpStatus: response.status,
    mimeType: response.headers.get("content-type"),
    bytesRead: bytes.length,
    result
  }, null, 2));
}
