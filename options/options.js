const t = (key, fallback, substitutions) => globalThis.AiImageBadgeI18n?.t(key, fallback, substitutions) || fallback;
globalThis.AiImageBadgeI18n?.localizeDocument();
const DEFAULTS = {
  enabled: true,
  urlAllowList: "",
  urlExcludeList: "",
  showLikely: true,
  showUndetermined: true,
  usePixelClassifier: true,
  localModel: "community",
  useGpuAcceleration: false,
  useFrequencyAnalysis: true,
  frequencyAnalysisMode: "fast",
  localLikelyThreshold: 50,
  localConfirmedThreshold: 90,
  useOpenAiProvenance: false,
  openAiMaxChecksPerPage: 20,
  scanCssBackgrounds: false,
  minWidth: 400,
  minHeight: 304
};

const form = document.querySelector("#settings");
const saved = document.querySelector("#saved");
const openAiConsentDialog = document.querySelector("#openai-consent-dialog");
const openAiConsentCheckbox = document.querySelector("#openai-consent-checkbox");
const openAiConsentAccept = document.querySelector("#openai-consent-accept");
const openAiConsentError = document.querySelector("#openai-consent-error");
let openAiConsentAccepted = false;
const BUILTIN_LOCAL_MODELS = ["community", "distilled", "capcheck"];
const availableLocalModels = new Set(BUILTIN_LOCAL_MODELS);
const FREQUENCY_ANALYSIS_MODES = new Set(["fast", "standard", "detailed"]);
const manifest = chrome.runtime.getManifest();
const appName = t("extensionName", "AI IMAGE BADGE");
document.querySelector("#app-name").textContent = appName;
document.querySelector("#app-version").textContent = `v${manifest.version}`;
document.title = t("optionsTitle", `${appName} の設定 v${manifest.version}`, [appName, manifest.version]);

function clampThreshold(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(99, Math.max(1, Math.round(number))) : fallback;
}

function normalizeRuleList(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200)
    .join("\n")
    .slice(0, 5000);
}

function normalizeSettings(values) {
  const likely = clampThreshold(values.localLikelyThreshold, DEFAULTS.localLikelyThreshold);
  const confirmed = Math.max(
    likely,
    clampThreshold(values.localConfirmedThreshold, DEFAULTS.localConfirmedThreshold)
  );
  const localModel = availableLocalModels.has(values.localModel)
    ? values.localModel
    : DEFAULTS.localModel;
  const frequencyAnalysisMode = FREQUENCY_ANALYSIS_MODES.has(values.frequencyAnalysisMode)
    ? values.frequencyAnalysisMode
    : DEFAULTS.frequencyAnalysisMode;
  return {
    ...values,
    urlAllowList: normalizeRuleList(values.urlAllowList),
    urlExcludeList: normalizeRuleList(values.urlExcludeList),
    localModel,
    frequencyAnalysisMode,
    localLikelyThreshold: likely,
    localConfirmedThreshold: confirmed
  };
}

function syncThresholdLimits() {
  const likely = clampThreshold(
    form.elements.localLikelyThreshold.value,
    DEFAULTS.localLikelyThreshold
  );
  const confirmed = form.elements.localConfirmedThreshold;
  confirmed.min = String(likely);
  if (Number(confirmed.value) < likely) confirmed.value = String(likely);
}

function syncFrequencyControls() {
  form.elements.frequencyAnalysisMode.disabled = !form.elements.useFrequencyAnalysis.checked;
}

function fill(values) {
  const normalized = normalizeSettings(values);
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const input = form.elements.namedItem(key);
    if (typeof fallback === "boolean") input.checked = Boolean(normalized[key]);
    else input.value = normalized[key];
  }
  syncThresholdLimits();
  syncFrequencyControls();
}

function read() {
  return normalizeSettings({
    enabled: form.elements.enabled.checked,
    urlAllowList: form.elements.urlAllowList.value,
    urlExcludeList: form.elements.urlExcludeList.value,
    showLikely: form.elements.showLikely.checked,
    showUndetermined: form.elements.showUndetermined.checked,
    usePixelClassifier: form.elements.usePixelClassifier.checked,
    localModel: form.elements.localModel.value,
    useGpuAcceleration: form.elements.useGpuAcceleration.checked,
    useFrequencyAnalysis: form.elements.useFrequencyAnalysis.checked,
    frequencyAnalysisMode: form.elements.frequencyAnalysisMode.value,
    localLikelyThreshold: form.elements.localLikelyThreshold.value,
    localConfirmedThreshold: form.elements.localConfirmedThreshold.value,
    useOpenAiProvenance: form.elements.useOpenAiProvenance.checked,
    openAiMaxChecksPerPage: Math.min(100, Math.max(1,
      Number(form.elements.openAiMaxChecksPerPage.value) || DEFAULTS.openAiMaxChecksPerPage)),
    scanCssBackgrounds: form.elements.scanCssBackgrounds.checked,
    minWidth: Math.min(1000, Math.max(24, Number(form.elements.minWidth.value) || DEFAULTS.minWidth)),
    minHeight: Math.min(1000, Math.max(24, Number(form.elements.minHeight.value) || DEFAULTS.minHeight))
  });
}

async function flashSaved(message) {
  saved.textContent = message;
  setTimeout(() => { saved.textContent = ""; }, 1800);
}

function openOpenAiConsentDialog() {
  openAiConsentCheckbox.checked = false;
  openAiConsentAccept.disabled = true;
  openAiConsentError.hidden = true;
  if (!openAiConsentDialog.open) openAiConsentDialog.showModal();
  openAiConsentCheckbox.focus();
}

function cancelOpenAiConsent() {
  form.elements.useOpenAiProvenance.checked = false;
  openAiConsentAccepted = false;
  if (openAiConsentDialog.open) openAiConsentDialog.close();
}

form.elements.useOpenAiProvenance.addEventListener("change", () => {
  if (!form.elements.useOpenAiProvenance.checked) {
    openAiConsentAccepted = false;
    return;
  }
  form.elements.useOpenAiProvenance.checked = false;
  openOpenAiConsentDialog();
});

openAiConsentCheckbox.addEventListener("change", () => {
  openAiConsentAccept.disabled = !openAiConsentCheckbox.checked;
  openAiConsentError.hidden = openAiConsentCheckbox.checked;
});

openAiConsentAccept.addEventListener("click", () => {
  if (!openAiConsentCheckbox.checked) {
    openAiConsentError.hidden = false;
    return;
  }
  openAiConsentAccepted = true;
  form.elements.useOpenAiProvenance.checked = true;
  openAiConsentDialog.close();
});

document.querySelector("#openai-consent-cancel").addEventListener("click", cancelOpenAiConsent);
openAiConsentDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelOpenAiConsent();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = read();
  if (values.useOpenAiProvenance && !openAiConsentAccepted) {
    form.elements.useOpenAiProvenance.checked = false;
    openOpenAiConsentDialog();
    return;
  }
  await chrome.storage.local.set({
    openAiApiKey: form.elements.openAiApiKey.value.trim(),
    openAiConsentAccepted: values.useOpenAiProvenance && openAiConsentAccepted
  });
  await chrome.storage.sync.set(values);
  fill(values);
  void flashSaved(t("saved", "保存しました"));
});

document.querySelector("#reset").addEventListener("click", async () => {
  await Promise.all([
    chrome.storage.sync.clear(),
    chrome.storage.local.remove(["openAiApiKey", "openAiConsentAccepted"])
  ]);
  openAiConsentAccepted = false;
  fill(DEFAULTS);
  form.elements.openAiApiKey.value = "";
  void flashSaved(t("resetSaved", "初期設定に戻しました"));
});

document.querySelector("#toggle-key").addEventListener("click", (event) => {
  const input = form.elements.openAiApiKey;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? t("hide", "隠す") : t("show", "表示");
});

form.elements.localLikelyThreshold.addEventListener("input", syncThresholdLimits);
form.elements.useFrequencyAnalysis.addEventListener("change", syncFrequencyControls);

void Promise.all([
  chrome.storage.sync.get(DEFAULTS),
  chrome.storage.local.get({ openAiApiKey: "", openAiConsentAccepted: false })
]).then(([values, local]) => {
  openAiConsentAccepted = values.useOpenAiProvenance && local.openAiConsentAccepted === true;
  const safeValues = openAiConsentAccepted
    ? values
    : { ...values, useOpenAiProvenance: false };
  fill(safeValues);
  form.elements.openAiApiKey.value = local.openAiApiKey || "";
  if (values.useOpenAiProvenance && !openAiConsentAccepted) {
    void chrome.storage.sync.set({ useOpenAiProvenance: false });
  }
});
