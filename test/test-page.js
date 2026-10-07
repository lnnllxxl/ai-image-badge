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
    if (currentPage !== testPageUrl) return null;
    const demo = element?.dataset?.aiImageBadgeDemo;
    if (demo === "openai-synthid") {
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
    if (demo === "local-model-likely") {
      return {
        status: "likely",
        confidence: 0.7,
        reasons: [
          t("localModelReason", "ローカル画像モデル（操作テスト）: 生成AIらしさ 70%", [" (操作テスト)", 70])
        ],
        evidence: [t("localModel", "ローカル画像モデル")],
        basis: "pixel-model",
        c2paDetected: false,
        unavailable: false,
        analysis: {
          pixelProbability: 0.7,
          localModel: "test-fixture",
          localModelLabel: t("operationDemo", "操作テスト")
        },
        diagnostic: {
          fetched: true,
          testFixture: true
        }
      };
    }
    return null;
  }
});
