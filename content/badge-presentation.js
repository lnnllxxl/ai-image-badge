(() => {
  function localModelName(result) {
    return result?.analysis?.localModelLabel || "ローカル画像モデル";
  }

  function modelMethod(result) {
    switch (result.basis) {
      case "multiple-signals":
        return `${localModelName(result)}＋補助解析`;
      case "explicit-metadata":
        return "生成AIメタデータ";
      case "openai-provenance":
        return "OpenAI公式Content Provenance API";
      default:
        return localModelName(result);
    }
  }

  function difficultMethod(result) {
    if (result.unavailable) return "画像取得不能（判定未完了）";
    if (result.c2paDetected) return "C2PA（生成AI由来の記録を未確認）";
    switch (result.basis) {
      case "pixel-plus-frequency":
        return `${localModelName(result)}＋周波数・ノイズ解析`;
      case "pixel-model":
        return localModelName(result);
      case "page-context":
        return "ページ説明";
      case "conflicting-signals":
        return "複数の根拠が不一致";
      default:
        return "総合判定";
    }
  }

  function localModelScore(result) {
    const probability = result?.analysis?.pixelProbability;
    if (!Number.isFinite(probability)) {
      return "未取得（ローカルモデル未実行または解析不能）";
    }
    return `${localModelName(result)}／生成AIらしさ ${Math.round(probability * 100)}%`;
  }

  function getBadgePresentation(result = {}) {
    const status = result.status === "confirmed"
      ? "confirmed"
      : result.status === "likely"
        ? "likely"
        : "undetermined";
    const c2paDetected = Boolean(result.c2paDetected);
    const synthIdDetected = Boolean(result.synthIdDetected);
    const openAiProvenance = result.basis === "openai-provenance";
    const c2paConfirmsAi = c2paDetected && status === "confirmed" && (
      openAiProvenance || result.basis === "explicit-metadata"
    );

    if (synthIdDetected) {
      return {
        kind: "confirmed",
        text: "AI【SynthID】",
        method: "OpenAI SynthID（OpenAI公式Content Provenance API）",
        heading: c2paDetected
          ? "AI画像と判定しました（SynthIDと信頼済みC2PAを検出）"
          : "AI画像と判定しました（SynthIDを検出）"
      };
    }

    if (c2paConfirmsAi) {
      return {
        kind: "confirmed",
        text: "AI【C2PA】",
        method: openAiProvenance
          ? "信頼済みC2PA（OpenAI公式Content Provenance API）"
          : "C2PA / Content Credentials",
        heading: "AI画像と判定しました（C2PAに生成AI由来の記録を検出）"
      };
    }

    if (status === "confirmed") {
      return {
        kind: status,
        text: "AI【モデル判定】",
        method: modelMethod(result),
        heading: "AI画像と判定しました"
      };
    }

    if (status === "likely" || result.unavailable || c2paDetected || result.basis === "conflicting-signals") {
      return {
        kind: "likely",
        text: c2paDetected ? "AIかも【C2PA】" : "AIかも",
        method: difficultMethod(result),
        heading: "AIかどうかの判定が難しい画像です"
      };
    }

    return {
      kind: status,
      text: "非生成かも",
      method: "総合判定（生成AIの根拠なし）",
      heading: "非生成の可能性が高い画像です",
      localScore: localModelScore(result)
    };
  }

  globalThis.ChatGptAiBadgePresentation = Object.freeze({ getBadgePresentation });
})();
