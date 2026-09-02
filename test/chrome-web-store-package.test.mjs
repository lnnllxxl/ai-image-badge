import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function pngDimensions(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

test("Chrome Web Store manifest metadata and icons are publishable", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(manifest.version, packageJson.version);
  assert.ok(["ai-image-badge", "ai-image-badge-release"].includes(packageJson.name));
  assert.doesNotMatch(packageJson.name, /chatgpt/i);
  assert.doesNotMatch(manifest.name, /chatgpt/i);
  assert.ok(manifest.description.length <= 132);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.permissions.includes("activeTab"));

  for (const size of [16, 32, 48, 128]) {
    const path = manifest.icons[String(size)];
    assert.equal(path, `icons/icon${size}.png`);
    assert.equal(manifest.action.default_icon[String(size)], path);
    const bytes = await readFile(new URL(path, root));
    assert.deepEqual(pngDimensions(bytes), { width: size, height: size });
  }
});
