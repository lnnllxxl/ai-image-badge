import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const popup = await readFile(new URL("popup/popup.js", root), "utf8");
const content = await readFile(new URL("content/content.js", root), "utf8");
const provenanceUrlTest = await readFile(new URL("test/provenance-url.test.mjs", root), "utf8");
const readme = await readFile(new URL("README.md", root), "utf8");

test("shared public scripts derive their injection list from the installed manifest", () => {
  assert.match(popup, /getManifest\(\)\.content_scripts/);
  assert.match(content, /AiImageBadgeDetailExtension/);
});

test("test URLs use an explicit fictional X media identifier", () => {
  assert.match(provenanceUrlTest, /ExampleMediaId12345/);
  assert.doesNotMatch(provenanceUrlTest, /HQkhQyAagAA9HTy/);
});

test("README warns about Git LFS pointers and definitive use of image labels", () => {
  assert.match(readme, /git lfs install/);
  assert.match(readme, /ポインターファイル/);
  assert.match(readme, /制作者や掲載者への評価/);
});
