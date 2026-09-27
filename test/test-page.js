const t = (key, fallback, substitutions) => globalThis.AiImageBadgeI18n?.t(key, fallback, substitutions) || fallback;
globalThis.AiImageBadgeI18n?.localizeDocument();
const manifest = chrome.runtime.getManifest();
const appName = t("extensionName", "AI IMAGE BADGE");
document.querySelector("#app-name").textContent = appName;
document.querySelector("#app-version").textContent = `v${manifest.version}`;
document.title = t("testTitle", `${appName} テストページ v${manifest.version}`, [appName, manifest.version]);

const testPageUrl = chrome.runtime.getURL("test/test.html");

globalThis.ChatGptAiBadgeTestFixtures = Object.freeze({
  resultFor({ element, pageUrl }) {
    const currentPage = String(pageUrl || "").split(/[?#]/, 1)[0];
    if (currentPage !== testPageUrl || element?.dataset?.aiImageBadgeDemo !== "openai-synthid") {
      return null;
    }
    return {
      status: "confirmed",
      confidence: 1,
      reasons: [
        t("demoReason", "操作テスト用の模擬OpenAI SynthID検出です。実際のOpenAI APIは呼び出していません。")
      ],
      evidence: ["test-fixture:openai-synthid"],
      basis: "openai-provenance",
      synthIdDetected: true,
      c2paDetected: false,
      unavailable: false,
      analysis: {
        openAiChecked: true,
        openAiDetected: true,
        openAiSynthIdDetected: true
      },
      diagnostic: {
        fetched: true,
        testFixture: true
      }
    };
  }
});
