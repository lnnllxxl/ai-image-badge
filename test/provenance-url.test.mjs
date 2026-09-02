import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProvenanceImageUrl } from "../provenance-url.js";

test("X small WebP is upgraded to the original-size JPEG for provenance", () => {
  assert.equal(
    normalizeProvenanceImageUrl("https://pbs.twimg.com/media/ExampleMediaId12345?format=webp&name=small"),
    "https://pbs.twimg.com/media/ExampleMediaId12345?format=jpg&name=orig"
  );
});

test("X display sizes share one provenance cache URL", () => {
  const small = normalizeProvenanceImageUrl(
    "https://pbs.twimg.com/media/ExampleMediaId12345?format=webp&name=small"
  );
  const medium = normalizeProvenanceImageUrl(
    "https://pbs.twimg.com/media/ExampleMediaId12345?format=webp&name=medium"
  );
  assert.equal(small, medium);
});

test("ordinary image URLs are unchanged", () => {
  const url = "https://example.com/images/photo.webp?size=small";
  assert.equal(normalizeProvenanceImageUrl(url), url);
});
