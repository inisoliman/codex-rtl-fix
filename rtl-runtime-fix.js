/* codex-rtl-runtime-fix v2 */
(() => {
  const MARK = "data-codex-rtl-fixed";
  const STYLE_ID = "codex-rtl-runtime-fix-style";
  const STYLE_VERSION = "2";
  const OBSERVER_KEY = "__codexRtlRuntimeFixObserver";
  const ARABIC_RE = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
  const STRONG_TEXT_RE = /[\p{Script=Arabic}\p{Script=Hebrew}A-Za-z]/u;

  const EXCLUDED_SELECTOR = [
    "pre",
    "code",
    "kbd",
    "samp",
    "svg",
    "canvas",
    "button",
    "[role='button']",
    "[aria-hidden='true']",
    ".cm-editor",
    ".monaco-editor",
    ".xterm",
    "[class*='terminal' i] pre",
    "[class~='code']",
    "[class*='code-block' i]",
    "[class*='inline-code' i]",
    "[data-language]",
  ].join(",");

  const TEXT_HOST_SELECTOR = [
    "textarea",
    "input:not([type='button']):not([type='submit']):not([type='checkbox']):not([type='radio'])",
    "[contenteditable='true']",
    "[role='textbox']",
  ].join(",");

  const BLOCK_HOST_SELECTOR = [
    "[data-message-author-role]",
    "[data-testid*='message' i]",
    "[class*='message' i]",
    "[class*='markdown' i]",
    "[class*='composer' i]",
    "article",
    "p",
    "li",
    "blockquote",
    "td",
    "th",
  ].join(",");

  const SCAN_ROOT_SELECTOR = [
    "main",
    "#root",
    "[class*='thread' i]",
    "[class*='conversation' i]",
    "[class*='message' i]",
    "[class*='composer' i]",
    "[class*='terminal' i]",
  ].join(",");

  function installStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (existing?.dataset.codexRtlVersion === STYLE_VERSION) return;
    existing?.remove();

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.dataset.codexRtlVersion = STYLE_VERSION;
    style.textContent = `
      [${MARK}],
      ${TEXT_HOST_SELECTOR} {
        unicode-bidi: plaintext;
        text-align: start;
      }

      ${TEXT_HOST_SELECTOR} {
        direction: auto;
      }

      [${MARK}] p,
      [${MARK}] li,
      [${MARK}] blockquote,
      [${MARK}] td,
      [${MARK}] th {
        unicode-bidi: plaintext;
        text-align: start;
      }

      pre,
      code,
      kbd,
      samp,
      .cm-editor,
      .monaco-editor,
      .xterm,
      [data-language] {
        direction: ltr !important;
        unicode-bidi: normal !important;
        text-align: left !important;
      }
    `;
    document.head.appendChild(style);
  }

  function hasUsefulText(text) {
    if (!text || text.length < 2) return false;
    if (!ARABIC_RE.test(text)) return false;
    return STRONG_TEXT_RE.test(text);
  }

  function isExcluded(el) {
    return !el || el.nodeType !== Node.ELEMENT_NODE || Boolean(el.closest(EXCLUDED_SELECTOR));
  }

  function markTextHost(el) {
    if (!el || isExcluded(el)) return;
    el.setAttribute("dir", "auto");
    el.setAttribute(MARK, "true");
    el.style.unicodeBidi = "plaintext";
    el.style.textAlign = "start";
  }

  function nearestTextContainer(el) {
    if (!el || isExcluded(el)) return null;
    return el.closest(BLOCK_HOST_SELECTOR) || el;
  }

  function fixTextNode(node) {
    if (!hasUsefulText(node.nodeValue)) return;
    const parent = node.parentElement;
    const host = nearestTextContainer(parent);
    if (!host || isExcluded(host)) return;
    markTextHost(host);
  }

  function fixInputs(root) {
    const hosts = root.matches?.(TEXT_HOST_SELECTOR)
      ? [root]
      : Array.from(root.querySelectorAll?.(TEXT_HOST_SELECTOR) || []);

    for (const host of hosts) {
      if (isExcluded(host)) continue;
      host.setAttribute("dir", "auto");
      host.setAttribute(MARK, "true");
    }
  }

  function fixTextContent(root) {
    const walkerRoot = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (!walkerRoot || isExcluded(walkerRoot)) return;

    const walker = document.createTreeWalker(
      walkerRoot,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!hasUsefulText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          if (isExcluded(node.parentElement)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    const nodes = [];
    while (nodes.length < 1000) {
      const next = walker.nextNode();
      if (!next) break;
      nodes.push(next);
    }

    for (const node of nodes) fixTextNode(node);
  }

  function fixTerminalLike(root) {
    const terminals = root.matches?.("[class*='terminal' i], .xterm")
      ? [root]
      : Array.from(root.querySelectorAll?.("[class*='terminal' i], .xterm") || []);

    for (const terminal of terminals) {
      terminal.style.unicodeBidi = "plaintext";
      terminal.style.textAlign = "start";
    }
  }

  function scan(root = document.body) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    installStyle();
    fixInputs(root);
    fixTextContent(root);
    fixTerminalLike(root);
  }

  function scanLikelyRoots() {
    installStyle();
    fixInputs(document);

    const roots = Array.from(document.querySelectorAll(SCAN_ROOT_SELECTOR));
    if (roots.length === 0 && document.body) roots.push(document.body);

    for (const root of roots.slice(0, 80)) scan(root);
  }

  function scheduleScan(root) {
    if (scheduleScan.timer) return;
    scheduleScan.root = root || document.body;
    scheduleScan.timer = window.setTimeout(() => {
      const target = scheduleScan.root || document.body;
      scheduleScan.timer = 0;
      scheduleScan.root = null;
      scan(target);
    }, 80);
  }

  function startObserver() {
    if (window[OBSERVER_KEY]) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          scheduleScan(mutation.target.parentElement);
          return;
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scheduleScan(node);
            return;
          }

          if (node.nodeType === Node.TEXT_NODE && hasUsefulText(node.nodeValue)) {
            scheduleScan(node.parentElement);
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window[OBSERVER_KEY] = observer;
  }

  function boot() {
    scanLikelyRoots();
    startObserver();
    window.__codexRtlRuntimeFix = {
      version: 1,
      scan: scanLikelyRoots,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
