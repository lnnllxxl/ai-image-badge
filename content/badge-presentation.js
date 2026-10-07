(() => {
  const t = (key, fallback, substitutions) => globalThis.AiImageBadgeI18n?.t(key, fallback, substitutions) || fallback;
  function localModelName(result) {
    return result?.analysis?.localModelLabel || t("localModel", "ローカル画像モデル");
  }

  function modelMethod(result) {
    switch (result.basis) {
      case "multiple-signals":
        return t("methodAux", `${localModelName(result)}＋補助解析`, [localModelName(result)]);
      case "explicit-metadata":
        return t("generatedMetadata", "生成AIメタデータ");
      case "openai-provenance":
        return t("officialApi", "OpenAI公式Content Provenance API");
      default:
        return localModelName(result);
    }
  }

  function difficultMethod(result) {
    if (result.unavailable) return t("imageUnavailable", "画像取得不能（判定未完了）");
    if (result.c2paDetected) return t("c2paUnconfirmed", "C2PA（生成AI由来の記録を未確認）");
    switch (result.basis) {
      case "pixel-plus-frequency":
        return t("methodFrequency", `${localModelName(result)}＋周波数・ノイズ解析`, [localModelName(result)]);
      case "pixel-model":
        return localModelName(result);
      default:
        return t("combinedAssessment", "総合判定");
    }
  }

  function localModelScore(result) {
    const probability = result?.analysis?.pixelProbability;
    if (!Number.isFinite(probability)) {
      return t("scoreUnavailable", "未取得（ローカルモデル未実行または解析不能）");
    }
    return t("modelScore", `${localModelName(result)}／生成AIらしさ ${Math.round(probability * 100)}%`, [localModelName(result), Math.round(probability * 100)]);
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
        text: t("badgeSynthId", "AI【SynthID】"),
        method: t("synthIdMethod", "OpenAI SynthID（OpenAI公式Content Provenance API）"),
        heading: c2paDetected
          ? t("synthIdC2paHeading", "AI画像と判定しました（SynthIDと信頼済みC2PAを検出）")
          : t("synthIdHeading", "AI画像と判定しました（SynthIDを検出）")
      };
    }

    if (c2paConfirmsAi) {
      return {
        kind: "confirmed",
        text: t("badgeC2pa", "AI【C2PA】"),
        method: openAiProvenance
          ? t("trustedC2paMethod", "信頼済みC2PA（OpenAI公式Content Provenance API）")
          : "C2PA / Content Credentials",
        heading: t("c2paHeading", "AI画像と判定しました（C2PAに生成AI由来の記録を検出）")
      };
    }

    if (status === "confirmed") {
      return {
        kind: status,
        text: t("badgeModel", "AI【モデル判定】"),
        method: modelMethod(result),
        heading: t("aiHeading", "AI画像と判定しました")
      };
    }

    if (status === "likely" || result.unavailable || c2paDetected) {
      return {
        kind: "likely",
        text: c2paDetected ? t("badgeMaybeC2pa", "AIかも【C2PA】") : t("badgeMaybe", "AIかも"),
        method: difficultMethod(result),
        heading: t("maybeHeading", "AIかどうかの判定が難しい画像です")
      };
    }

    return {
      kind: status,
      text: t("badgeNonAi", "非生成かも"),
      method: t("noAiMethod", "総合判定（生成AIの根拠なし）"),
      heading: t("nonAiHeading", "非生成の可能性が高い画像です"),
      localScore: localModelScore(result)
    };
  }

  globalThis.ChatGptAiBadgePresentation = Object.freeze({ getBadgePresentation });
})();
