import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("default scan size is 400 by 304 pixels", async () => {
  for (const path of ["content/content.js", "options/options.js"]) {
    const text = await source(path);
    assert.match(text, /minWidth:\s*400/);
    assert.match(text, /minHeight:\s*304/);
  }
});

test("browser settings default to 50 and 90 percent thresholds", async () => {
  for (const path of ["content/content.js", "options/options.js", "popup/popup.js", "background.js"]) {
    const text = await source(path);
    assert.match(text, /localLikelyThreshold(?:\s*=|:)\s*50/);
    assert.match(text, /localConfirmedThreshold(?:\s*=|:)\s*90/);
  }
});
