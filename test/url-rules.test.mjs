import assert from "node:assert/strict";
import test from "node:test";

await import("../url-rules.js");
const { evaluateUrlAccess, matchesRule, rulesFromText } = globalThis.ChatGptAiUrlRules;

test("bare domains match the domain and its subdomains", () => {
  assert.equal(matchesRule("https://example.com/news", "example.com"), true);
  assert.equal(matchesRule("https://images.example.com/photo", "example.com"), true);
  assert.equal(matchesRule("https://notexample.com/", "example.com"), false);
});

test("scheme URL rules match their path and descendants", () => {
  assert.equal(matchesRule("https://example.com/news", "https://example.com/news"), true);
  assert.equal(matchesRule("https://example.com/news/ai", "https://example.com/news"), true);
  assert.equal(matchesRule("http://example.com/news", "https://example.com/news"), false);
  assert.equal(matchesRule("https://example.com/newspaper", "https://example.com/news"), false);
});

test("wildcards work in hosts and complete URL patterns", () => {
  assert.equal(matchesRule("https://cdn.example.com/a", "*.example.com"), true);
  assert.equal(matchesRule("https://example.com/a", "*.example.com"), true);
  assert.equal(matchesRule("https://news.example.jp/ai/item?id=4", "https://news.example.jp/ai/*"), true);
  assert.equal(matchesRule("https://news.example.jp/sports/item", "https://news.example.jp/ai/*"), false);
});

test("an empty allow list permits ordinary pages", () => {
  const result = evaluateUrlAccess("https://example.com/", {});
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "allow-list-empty");
});

test("a populated allow list permits only matching pages", () => {
  const allowed = evaluateUrlAccess("https://sub.example.com/article", {
    urlAllowList: "example.com"
  });
  const denied = evaluateUrlAccess("https://other.test/article", {
    urlAllowList: "example.com"
  });
  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "not-in-allow-list");
});

test("exclude rules take priority over allow rules", () => {
  const result = evaluateUrlAccess("https://private.example.com/account/1", {
    urlAllowList: "example.com",
    urlExcludeList: "private.example.com"
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "excluded");
  assert.equal(result.matchedRule, "private.example.com");
});

test("blank lines and comment lines are ignored", () => {
  assert.deepEqual(rulesFromText("\n# comment\n example.com \n\n"), ["example.com"]);
});
