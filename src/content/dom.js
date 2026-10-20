(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;

  function allRoots(root = document) {
    const roots = [];
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      roots.push(current);
      const walker = document.createTreeWalker(current, NodeFilter.SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        if (node.shadowRoot) stack.push(node.shadowRoot);
        node = walker.nextNode();
      }
    }
    return roots;
  }

  function queryAll(selector) {
    return allRoots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  }

  function queryOne(selector) {
    for (const root of allRoots()) {
      const match = root.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  function absoluteUrl(value) {
    if (!value) return null;
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return value;
    }
  }

  function isExternalResourceUrl(href) {
    if (!href) return false;
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch {
      return false;
    }
    if (!/^https?:$/i.test(url.protocol)) return false;
    if (url.origin !== window.location.origin) return true;
    return /\/common\/dialogs\/quickLink\/quickLink\.d2l/i.test(url.pathname);
  }

  function linkRecord(link) {
    return {
      title: normalizeText(link.getAttribute("aria-label") || link.textContent || link.title),
      text: normalizeText(link.textContent),
      href: absoluteUrl(link.getAttribute("href"))
    };
  }

  function headingText(level) {
    const selector = level ? `h${level}, [role="heading"][aria-level="${level}"]` : "h1, h2, h3, [role='heading']";
    const node = queryOne(selector);
    return normalizeText(node?.textContent);
  }

  function pageText() {
    return normalizeText(document.body?.innerText || document.body?.textContent || "");
  }

  Object.assign(content, { allRoots, queryAll, queryOne, absoluteUrl, isExternalResourceUrl, linkRecord, headingText, pageText });
})();
