import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readOptional(path) {
  try {
    return await readFile(new URL(path, root), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertManifestBrand(manifest) {
  const expected = manifest.name.endsWith("教育・管理者版")
    ? "AI IMAGE BADGE 教育・管理者版"
    : "AI IMAGE BADGE";
  assert.equal(manifest.name, expected);
  assert.equal(manifest.action.default_title, expected);
}

test("extension display names use AI IMAGE BADGE", async () => {
  assertManifestBrand(JSON.parse(await readFile(new URL("manifest.json", root), "utf8")));

  const adminSource = await readOptional("manifest.admin.json");
  if (adminSource) assertManifestBrand(JSON.parse(adminSource));
});

test("visible extension pages show the manifest version", async () => {
  for (const file of ["popup/popup.html", "options/options.html", "training/admin.html", "test/test.html"]) {
    const html = await readOptional(file);
    if (html === null) continue;
    assert.match(html, /id="app-version"/);
    assert.doesNotMatch(html, /ChatGPT AI Image Badge/i);
  }
  for (const file of ["popup/popup.js", "options/options.js", "training/admin.js", "test/test-page.js"]) {
    const source = await readOptional(file);
    if (source === null) continue;
    assert.match(source, /chrome\.runtime\.getManifest\(\)/);
    assert.match(source, /manifest\.version/);
  }
});
