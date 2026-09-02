import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const background = await readFile(new URL("background.js", root), "utf8");
const fallback = await readFile(new URL("content/metadata-fallback.js", root), "utf8");
const options = await readFile(new URL("options/options.html", root), "utf8");
const optionsScript = await readFile(new URL("options/options.js", root), "utf8");

function functionSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} was not found`);
  assert.notEqual(end, -1, `${endMarker} was not found`);
  return source.slice(start, end);
}

test("OpenAI upload fetch never uses browsing credentials or an authenticated cache", () => {
  const uploadFetch = functionSource(
    background,
    "async function fetchImageForOpenAi",
    "function pumpOpenAiQueue"
  );
  assert.match(uploadFetch, /credentials:\s*"omit"/);
  assert.match(uploadFetch, /cache:\s*"no-store"/);
  assert.doesNotMatch(uploadFetch, /credentials:\s*"include"/);
  assert.match(uploadFetch, /image-auth-required/);
});

test("local metadata fetches keep existing authenticated-page behavior", () => {
  const metadataFetch = functionSource(background, "async function fetchOnce", "async function fetchImagePrefix");
  assert.match(metadataFetch, /credentials:\s*"include"/);
  assert.match(fallback, /credentials:\s*"include"/);
});

test("the local API-key store is limited to trusted extension contexts", () => {
  assert.match(background, /storage\.local\.setAccessLevel\(\{\s*accessLevel:\s*"TRUSTED_CONTEXTS"\s*\}\)/);
});

test("the settings page discloses unencrypted API-key storage and safer key isolation", () => {
  assert.match(options, /暗号化されない/);
  assert.match(options, /本拡張専用のOpenAIプロジェクト/);
  assert.match(options, /利用上限/);
});

test("reset deletes synchronized settings and the local API key", () => {
  const resetHandler = functionSource(
    optionsScript,
    'document.querySelector("#reset")',
    'document.querySelector("#toggle-key")'
  );
  assert.match(resetHandler, /storage\.sync\.clear\(\)/);
  assert.match(resetHandler, /storage\.local\.remove\("openAiApiKey"\)/);
  assert.doesNotMatch(resetHandler, /storage\.sync\.set\(DEFAULTS\)/);
});
