// Search page and panel.
(function initDashboardRenderSearch(global) {
  const dash = global.D2LDashboard ||= {};
  const { emptyState, escapeHtml: e, icon, plural } = dash;
  // --------------------------------------------------------------- search

  function snippetHtml(item) {
    return item.snippet ? `<span class="snippet">${e(item.snippet.before)}<mark>${e(item.snippet.match)}</mark>${e(item.snippet.after)}</span>` : "";
  }

  // Escapes text and marks the first place the query appears in it.
  function markMatch(text, query) {
    const value = String(text ?? "");
    const at = query ? value.toLowerCase().indexOf(String(query).toLowerCase()) : -1;
    if (at < 0) return e(value);
    return `${e(value.slice(0, at))}<mark>${e(value.slice(at, at + query.length))}</mark>${e(value.slice(at + query.length))}`;
  }

  // The query lives in the top-bar box; this page lists every result for it.
  function searchPage(model, query, pending) {
    return `<div class="page slim" data-screen="search">
      <div class="page-head"><div><h1>Search</h1></div></div>
      ${pending ? emptyState("", "Searching…") : query ? (model.total ? `<div class="search-count">${e(plural(model.total, "result"))} for “${e(query)}”</div>${model.groups.map((group) => `<section class="card card-pad"><div class="section-label">${e(group.name)}</div>${group.items.map((item) => `<a class="row compact search-hit" href="${e(item.route)}"><span class="grow"><span class="title">${e(item.title)}</span><span class="meta">${e([item.sub, item.date].filter(Boolean).join(" · "))}</span>${snippetHtml(item)}</span><span class="chev">${icon("chevronRight", 16)}</span></a>`).join("")}</section>`).join("")}` : emptyState("", `No results for “${query}”.`)) : emptyState("", "Type in the search box at the top to search your archive.")}
    </div>`;
  }

  // Live results under the top-bar box: the first few hits, then a link to the
  // Search page. Empty query = no panel.
  function searchPanel(panel, pending) {
    if (!panel.query) return "";
    if (!panel.total) return `<div class="search-panel-note">${pending ? "Searching…" : `No results for “${e(panel.query)}”.`}</div>`;
    let n = 0;
    const option = (href, body, className) => `<a class="${className}" id="search-opt-${n++}" role="option" aria-selected="false" href="${e(href)}">${body}</a>`;
    return panel.groups.map((group) => `<div class="section-label" role="presentation">${e(group.name)}</div>${group.items.map((item) => option(item.route,
      `<span class="title">${markMatch(item.title, panel.query)}</span><span class="meta">${e([item.sub, item.date].filter(Boolean).join(" · "))}</span>${snippetHtml(item)}`, "search-option")).join("")}`).join("")
      + option(panel.allRoute, `See all ${e(plural(panel.total, "result"))}`, "search-option search-all");
  }


  Object.assign(dash, {
    snippetHtml, markMatch, searchPage, searchPanel
  });
})(globalThis);
