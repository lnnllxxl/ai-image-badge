const DEFAULTS = {
  enabled: true,
  urlAllowList: "",
  urlExcludeList: "",
  showLikely: true,
  showUndetermined: true,
  usePageHints: true,
  usePixelClassifier: true,
  localModel: "community",
  useGpuAcceleration: false,
  useFrequencyAnalysis: true,
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
const BUILTIN_LOCAL_MODELS = ["community", "distilled", "capcheck"];
const CUSTOM_LOCAL_MODELS = [
  { id: "community-forensics-custom", fallback: "Community Forensics Custom" },
  { id: "resnet18-custom", fallback: "ResNet-18 Custom" },
  { id: "chatgpt-custom", fallback: "旧カスタムモデル" }
];
const availableLocalModels = new Set(BUILTIN_LOCAL_MODELS);
const manifest = chrome.runtime.getManifest();
const appName = manifest.name.replace(/ 教育・管理者版$/, "");
document.querySelector("#app-name").textContent = appName;
document.querySelector("#app-version").textContent = `v${manifest.version}`;
document.title = `${appName} の設定 v${manifest.version}`;

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
  return {
    ...values,
    urlAllowList: normalizeRuleList(values.urlAllowList),
    urlExcludeList: normalizeRuleList(values.urlExcludeList),
    localModel,
    localLikelyThreshold: likely,
    localConfirmedThreshold: confirmed
  };
}

async function loadAvailableLocalModels() {
  try {
    const response = await fetch(chrome.runtime.getURL("model/config.json"));
    if (!response.ok) throw new Error("model registry unavailable");
    const registry = await response.json();
    for (const customModel of CUSTOM_LOCAL_MODELS) {
      const option = form.elements.localModel.querySelector(`option[value="${customModel.id}"]`);
      const custom = registry?.models?.[customModel.id];
      if (custom?.weights) {
        availableLocalModels.add(customModel.id);
        option.disabled = false;
        option.textContent = `${custom.label || customModel.fallback}（教育モデル）`;
      } else {
        availableLocalModels.delete(customModel.id);
        option.disabled = true;
        option.textContent = `${customModel.fallback}（学習モデル未導入）`;
      }
    }
  } catch {
    for (const customModel of CUSTOM_LOCAL_MODELS) {
      const option = form.elements.localModel.querySelector(`option[value="${customModel.id}"]`);
      availableLocalModels.delete(customModel.id);
      option.disabled = true;
      option.textContent = `${customModel.fallback}（学習モデル未導入）`;
    }
  }
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

function fill(values) {
  const normalized = normalizeSettings(values);
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const input = form.elements.namedItem(key);
    if (typeof fallback === "boolean") input.checked = Boolean(normalized[key]);
    else input.value = normalized[key];
  }
  syncThresholdLimits();
}

function read() {
  return normalizeSettings({
    enabled: form.elements.enabled.checked,
    urlAllowList: form.elements.urlAllowList.value,
    urlExcludeList: form.elements.urlExcludeList.value,
    showLikely: form.elements.showLikely.checked,
    showUndetermined: form.elements.showUndetermined.checked,
    usePageHints: form.elements.usePageHints.checked,
    usePixelClassifier: form.elements.usePixelClassifier.checked,
    localModel: form.elements.localModel.value,
    useGpuAcceleration: form.elements.useGpuAcceleration.checked,
    useFrequencyAnalysis: form.elements.useFrequencyAnalysis.checked,
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = read();
  await Promise.all([
    chrome.storage.sync.set(values),
    chrome.storage.local.set({ openAiApiKey: form.elements.openAiApiKey.value.trim() })
  ]);
  fill(values);
  void flashSaved("保存しました");
});

document.querySelector("#reset").addEventListener("click", async () => {
  await Promise.all([
    chrome.storage.sync.clear(),
    chrome.storage.local.remove("openAiApiKey")
  ]);
  fill(DEFAULTS);
  form.elements.openAiApiKey.value = "";
  void flashSaved("初期設定に戻しました");
});

document.querySelector("#toggle-key").addEventListener("click", (event) => {
  const input = form.elements.openAiApiKey;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "隠す" : "表示";
});

form.elements.localLikelyThreshold.addEventListener("input", syncThresholdLimits);

void Promise.all([
  loadAvailableLocalModels(),
  chrome.storage.sync.get(DEFAULTS),
  chrome.storage.local.get({ openAiApiKey: "" })
]).then(([_models, values, local]) => {
  fill(values);
  form.elements.openAiApiKey.value = local.openAiApiKey || "";
});
