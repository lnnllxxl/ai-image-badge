(() => {
  // Shared by extension pages, isolated content scripts, and module workers.
  // Native chrome.i18n selects the Chrome UI locale; no page-language sniffing.
  const t = (key, fallback = key, substitutions = []) => {
    try {
      return globalThis.chrome?.i18n?.getMessage(key, substitutions.map(String)) || fallback;
    } catch {
      // Old content scripts may remain after an extension reload.
      return fallback;
    }
  };

  function uiLocale() {
    try {
      return /^ja(?:[-_]|$)/i.test(globalThis.chrome?.i18n?.getUILanguage() || "") ? "ja" : "en";
    } catch {
      return "en";
    }
  }

  function localizeDocument(root = document) {
    if (root.documentElement) root.documentElement.lang = uiLocale();
    for (const element of root.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n, element.textContent);
    }
    for (const attribute of ["alt", "aria-label", "title", "placeholder"]) {
      for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
        element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`), element.getAttribute(attribute)));
      }
    }
  }

  globalThis.AiImageBadgeI18n = Object.freeze({ t, uiLocale, localizeDocument });
})();
