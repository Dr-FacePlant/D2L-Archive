// Ask's answers as Markdown, the way chat apps show them: tables, headings, lists,
// bold, code and links. markdown-it (src/vendor/markdown-it) reads the text. The
// model's words are never trusted as HTML: raw HTML shows as text, pictures are off
// (one from the web would be a request leaving this computer), and only web and mail
// addresses become links. While an answer is still coming, remend closes marks that
// are only half written, so no stray ** shows. Both load the first time Ask opens.
(function initAskAnswerMarkdown(global) {
  const dash = global.D2LDashboard ||= {};
  const SAFE_LINK = /^(https?:\/\/|mailto:)/i;
  // Half-written links show as their words; $ is money here, not math.
  const CLOSE_OPTIONS = { linkMode: "text-only", katex: false, inlineKatex: false };
  // Loaded as modules from inside the extension; markdown-it's file sets globalThis.markdownit.
  const LIBRARIES = { markdownIt: "src/vendor/markdown-it/markdown-it.umd.min.js", remend: "src/vendor/remend/index.js" };
  let reader = null;
  let loading = null;

  // Until this is done (a moment, the first time Ask opens) answers show as plain text.
  function loadAnswerMarkdown() {
    const url = (file) => global.chrome.runtime.getURL(file);
    loading ||= Promise.all([
      typeof global.markdownit === "function" || import(url(LIBRARIES.markdownIt)),
      typeof dash.askCloseMarks === "function" || import(url(LIBRARIES.remend)).then((module) => { dash.askCloseMarks = module.default; })
    ]).catch((error) => { loading = null; throw error; });
    return loading;
  }

  function markdown() {
    if (reader || typeof global.markdownit !== "function") return reader;
    // breaks: a single new line stays a new line, as the model writes its lists of dates.
    const md = global.markdownit({ html: false, linkify: false, breaks: true, typographer: false }).disable("image");
    md.validateLink = (url) => SAFE_LINK.test(String(url).trim());
    // Links open in a new tab, after the dashboard's usual "leaving the archive" check.
    md.renderer.rules.link_open = (tokens, i, options, env, self) => {
      tokens[i].attrSet("target", "_blank");
      tokens[i].attrSet("rel", "noopener noreferrer");
      return self.renderToken(tokens, i, options);
    };
    // A wide table scrolls sideways in its own box instead of stretching the chat.
    md.renderer.rules.table_open = () => `<div class="ask-table"><table>\n`;
    md.renderer.rules.table_close = () => `</table></div>\n`;
    reader = md;
    return reader;
  }

  // The same text as before Markdown (escaped, with new lines kept), if the library is missing.
  function plain(text) {
    return `<p>${dash.escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  }

  // live: the answer is still being written.
  function answerMarkdownHtml(text, { live = false } = {}) {
    const source = String(text || "");
    const md = markdown();
    if (!md) return plain(source);
    const close = live && typeof dash.askCloseMarks === "function" ? dash.askCloseMarks : null;
    return md.render(close ? close(source, CLOSE_OPTIONS) : source);
  }

  Object.assign(dash, { askAnswerMarkdownHtml: answerMarkdownHtml, askLoadAnswerMarkdown: loadAnswerMarkdown, ASK_MARKDOWN_LIBRARIES: LIBRARIES });
})(globalThis);
