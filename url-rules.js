(() => {
  const MAX_RULES = 200;

  function rulesFromText(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .slice(0, MAX_RULES);
  }

  function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  function wildcardMatch(pattern, value) {
    const source = escapeRegExp(pattern).replace(/\*/g, ".*");
    return new RegExp(`^${source}$`, "i").test(value);
  }

  function hostMatches(pattern, url) {
    const normalized = pattern.toLowerCase().replace(/^\*\./, "");
    if (!normalized) return false;
    if (pattern.includes("*")) {
      return wildcardMatch(pattern.toLowerCase(), url.host.toLowerCase()) ||
        (pattern.startsWith("*.") && url.hostname.toLowerCase() === normalized);
    }
    if (normalized.includes(":")) return url.host.toLowerCase() === normalized;
    const hostname = url.hostname.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  }

  function matchesRule(rawUrl, rawRule) {
    let url;
    try {
      url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(url.protocol)) return false;

    const rule = String(rawRule || "").trim();
    if (!rule || rule.startsWith("#")) return false;

    if (/^https?:\/\//i.test(rule)) {
      if (rule.includes("*")) return wildcardMatch(rule, url.href);
      try {
        const parsedRule = new URL(rule);
        const rulePath = parsedRule.pathname === "/" ? "/" : parsedRule.pathname.replace(/\/$/, "");
        return url.protocol === parsedRule.protocol &&
          url.host.toLowerCase() === parsedRule.host.toLowerCase() &&
          (rulePath === "/" || url.pathname === rulePath || url.pathname.startsWith(`${rulePath}/`)) &&
          (!parsedRule.search || url.search === parsedRule.search) &&
          (!parsedRule.hash || url.hash === parsedRule.hash);
      } catch {
        return false;
      }
    }

    const slash = rule.indexOf("/");
    const hostRule = slash >= 0 ? rule.slice(0, slash) : rule;
    if (!hostMatches(hostRule, url)) return false;
    if (slash < 0) return true;

    const pathRule = rule.slice(slash) || "/";
    const target = `${url.pathname}${url.search}${url.hash}`;
    if (pathRule.includes("*")) return wildcardMatch(pathRule, target);
    const normalizedPath = pathRule === "/" ? "/" : pathRule.replace(/\/$/, "");
    return normalizedPath === "/" || url.pathname === normalizedPath ||
      url.pathname.startsWith(`${normalizedPath}/`);
  }

  function firstMatch(url, rules) {
    for (const rule of rules) {
      if (matchesRule(url, rule)) return rule;
    }
    return "";
  }

  function evaluateUrlAccess(url, { urlAllowList = "", urlExcludeList = "" } = {}) {
    const excludeRules = rulesFromText(urlExcludeList);
    const excludedBy = firstMatch(url, excludeRules);
    if (excludedBy) return { allowed: false, reason: "excluded", matchedRule: excludedBy };

    const allowRules = rulesFromText(urlAllowList);
    if (allowRules.length === 0) return { allowed: true, reason: "allow-list-empty", matchedRule: "" };
    const allowedBy = firstMatch(url, allowRules);
    return allowedBy
      ? { allowed: true, reason: "allowed", matchedRule: allowedBy }
      : { allowed: false, reason: "not-in-allow-list", matchedRule: "" };
  }

  globalThis.ChatGptAiUrlRules = Object.freeze({
    evaluateUrlAccess,
    matchesRule,
    rulesFromText
  });
})();
