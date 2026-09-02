const manifest = chrome.runtime.getManifest();
const appName = manifest.name.replace(/ 教育・管理者版$/, "");
document.querySelector("#app-name").textContent = appName;
document.querySelector("#app-version").textContent = `v${manifest.version}`;
document.title = `${appName} テストページ v${manifest.version}`;

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
        "操作テスト用の模擬OpenAI SynthID検出です。実際のOpenAI APIは呼び出していません。"
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
