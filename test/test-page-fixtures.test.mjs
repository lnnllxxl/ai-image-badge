import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("local test images exceed the default 400 by 304 pixel scan size", async () => {
  for (const name of [
    "ai-generated.svg",
    "authentic.svg",
    "c2pa-ai-generated.svg",
    "c2pa-authentic.svg",
    "openai-synthid-demo.svg"
  ]) {
    const source = await readFile(new URL(`test/${name}`, root), "utf8");
    assert.match(source, /<svg[^>]+width="800"[^>]+height="500"/);
  }
});

test("the background-image test is rendered above the default scan size on desktop", async () => {
  const html = await readFile(new URL("test/test.html", root), "utf8");
  assert.match(html, /minmax\(min\(500px, 100%\), 1fr\)/);
  assert.match(html, /aspect-ratio:\s*8\s*\/\s*5/);
});

test("the SynthID UI demo is isolated to the extension test page and skips the API", async () => {
  const html = await readFile(new URL("test/test.html", root), "utf8");
  const fixtureSource = await readFile(new URL("test/test-page.js", root), "utf8");
  const contentSource = await readFile(new URL("content/content.js", root), "utf8");
  assert.match(html, /data-ai-image-badge-demo="openai-synthid"/);
  assert.ok(html.indexOf('src="test-page.js"') < html.indexOf('src="..\/content\/content.js"'));
  assert.match(fixtureSource, /currentPage !== testPageUrl/);
  assert.match(fixtureSource, /synthIdDetected:\s*true/);
  assert.match(fixtureSource, /実際のOpenAI APIは呼び出していません/);
  assert.match(contentSource, /if \(!testFixture && settings\.useOpenAiProvenance\)/);
  assert.match(contentSource, /testFixture \? Promise\.resolve\(testFixture\) : sendMessage/);
});
