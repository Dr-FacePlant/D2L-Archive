// The search pop-up: the dialog, and the list inside it.
(function initDashboardRenderPalette(global) {
  const dash = global.D2LDashboard ||= {};
  const { escapeHtml: e, icon, markMatch, plural, snippetHtml } = dash;

  const ICON_BY_TYPE = Object.freeze({
    assignmentBundle: "task", quizBundle: "quiz", discussionThread: "chat", courseToolItem: "work",
    announcement: "megaphone", gradeRecord: "grade", learningResource: "folder", calendarEvent: "calendar"
  });
  const ENTER = '<svg class="palette-enter" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3v5a1 1 0 0 1-1 1H3"/><path d="m5.5 6.5L3 9l2.5 2.5"/></svg>';
  const key = (label) => `<kbd>${e(label)}</kbd>`;

  // The dialog. The list is filled in by paletteList().
  function paletteShell() {
    return `<div class="palette-scrim" data-palette-close></div>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div class="palette-input-row">${icon("search", 18)}
          <input id="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Search your archive">
          ${key("esc")}
        </div>
        <div id="palette-list" class="palette-list" role="listbox" aria-label="Results"></div>
        <div class="palette-foot">${key("↑")}${key("↓")} move <span class="palette-dot">·</span> ${key("↵")} open <span class="palette-dot">·</span> ${key("esc")} close</div>
      </div>`;
  }

  function optionRow(number, active, { href, body, className = "" }) {
    return `<a class="palette-row ${className}" id="palette-opt-${number}" role="option" aria-selected="${active === number}" data-palette-index="${number}" href="${e(href)}">${body}${ENTER}</a>`;
  }

  function hitBody(row, query) {
    const snippet = row.snippet ? snippetHtml(row) : "";
    return `<span class="palette-ico">${icon(ICON_BY_TYPE[row.type] || "file", 16)}</span>
      <span class="palette-main"><span class="palette-title">${markMatch(row.title, query)}</span>${snippet}</span>
      ${row.tag ? `<span class="palette-tag">${e(row.tag)}</span>` : ""}${row.right ? `<span class="palette-right">${e(row.right)}</span>` : ""}`;
  }

  function note(text) {
    return `<div class="palette-note" role="presentation">${e(text)}</div>`;
  }

  // active is the highlighted option number (see paletteOptions), or -1.
  function paletteList(view, active) {
    const searching = Boolean(view.query);
    let number = 0;
    const groups = view.groups.map((group) => `<div class="palette-label" role="presentation">${e(group.name)}</div>${group.rows.map((row) => optionRow(number++, active, { href: row.route, body: hitBody(row, view.query) })).join("")}`).join("");
    const shown = view.groups.reduce((sum, group) => sum + group.rows.length, 0);
    const all = searching && view.total > shown
      ? optionRow(number++, active, { href: view.allRoute, className: "palette-all", body: `<span class="palette-main"><span class="palette-title">See all ${e(plural(view.total, "result"))}</span></span>` })
      : "";
    const empty = shown ? "" : note(searching ? (view.pending ? "Searching…" : `Nothing in your archive matches “${view.query}”.`) : "Nothing due soon. Type to search your archive.");
    return `${groups}${empty}${all}`;
  }

  Object.assign(dash, { paletteShell, paletteList });
})(globalThis);
