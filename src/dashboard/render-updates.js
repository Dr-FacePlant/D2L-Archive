// Updates inbox page.
(function initDashboardRenderUpdates(global) {
  const dash = global.D2LDashboard ||= {};
  const { emptyState, escapeHtml: e, icon, pressed, updateRow } = dash;
  // -------------------------------------------------------------- updates

  // Updates open on Unread and show 20 at a time; "Show 20 more" reveals the
  // next ones in place (app.js), so the page doesn't jump back to the top.
  const UPDATES_PAGE = 20;

  function updatesPage(rows, params = {}) {
    const tab = ["unread", "read", "all"].includes(params.tab) ? params.tab : "unread";
    const shown = rows.filter((row) => tab === "all" || (tab === "unread" ? row.unread : !row.unread));
    const unread = rows.filter((row) => row.unread).length;
    const tabHref = (key) => `#/updates?tab=${key}${params.course ? `&course=${e(params.course)}` : ""}`;
    const list = shown.map((row, i) => `${row.group !== shown[i - 1]?.group ? `<div class="section-label update-group"${i >= UPDATES_PAGE ? " hidden data-more" : ""}>${e(row.group)}</div>` : ""}${updateRow(row, true, i >= UPDATES_PAGE)}`).join("");
    const more = shown.length > UPDATES_PAGE ? `<button class="btn more-btn" type="button" data-action="show-more" data-step="${UPDATES_PAGE}">Show ${Math.min(UPDATES_PAGE, shown.length - UPDATES_PAGE)} more</button>` : "";
    const empty = tab === "unread"
      ? `<div class="empty"><b>You're all caught up.</b><a class="link-btn" href="${tabHref("read")}">See what you've read ${icon("arrowRight", 15)}</a></div>`
      : emptyState("", tab === "read" ? "Nothing marked read yet." : "No updates this term.");
    return `<div class="page" data-screen="updates">
      <div class="page-head">
        <div><h1>Updates</h1></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="seg" role="group" aria-label="Filter updates">
            <button type="button" data-action="nav" data-href="${tabHref("unread")}" aria-pressed="${tab === "unread"}">Unread (${unread})</button>
            <button type="button" data-action="nav" data-href="${tabHref("read")}" aria-pressed="${tab === "read"}">Read (${rows.length - unread})</button>
            <button type="button" data-action="nav" data-href="${tabHref("all")}" aria-pressed="${tab === "all"}">All (${rows.length})</button>
          </div>
          <button class="btn" type="button" data-action="mark-all-read">Mark all as read</button>
        </div>
      </div>
      <section class="card card-pad">${shown.length ? `${list}${more}` : empty}</section>
    </div>`;
  }


  Object.assign(dash, {
    updatesPage, UPDATES_PAGE
  });
})(globalThis);
