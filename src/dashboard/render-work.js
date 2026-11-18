// Work list page.
(function initDashboardRenderWork(global) {
  const dash = global.D2LDashboard ||= {};
  const { dateBox, emptyState, escapeHtml: e, selectMenu, icon, pressed, statusMark } = dash;
  // ------------------------------------------------------------ work list

  function workToolbar(model, tabs, href) {
    const tabButtons = tabs.map(([key, label]) => `<button type="button" data-action="nav" data-href="${e(href({ tab: key }))}" aria-pressed="${model.tab === key}">${e(label)} (${model.counts[key]})</button>`).join("");
    const typeFilter = selectMenu("work-type-menu", "Type", model.type, model.typeChips.map((chip) => ({ ...chip, href: href({ type: chip.key }) })), "Filter by type");
    const courseFilter = selectMenu("work-course-menu", "Course", model.courseId, model.courseChips.map((chip) => ({ ...chip, href: href({ course: chip.key }) })), "Filter by course");
    return `<div class="toolbar work-filter-bar">
        <div class="seg" role="group" aria-label="Which work">${tabButtons}</div>
        <div class="work-secondary-filters">${typeFilter}${courseFilter}</div>
      </div>`;
  }

  function workRowHtml(row, i, rows, scores, aside) {
    const week = row.week !== rows[i - 1]?.week ? `<div class="week-row"><span>${e(row.week)}</span><small>(${rows.filter((other) => other.week === row.week).length})</small></div>` : "";
    const meta = e([row.typeLabel, row.course?.label, row.points].filter(Boolean).join("  ·  "));
    const scoreCol = scores ? `<span class="col-score">${e(row.score || "—")}</span>` : "";
    const asideText = aside(row) ? `<small>${e(aside(row))}</small>` : "";
    return `${week}<a class="table-row" href="${e(row.route)}" data-entity="${e(row.id)}">
      <span class="col-due">${dateBox(row.parts, row.count, row.inferred)}</span>
      <span class="col-item" style="flex:1 1 200px;min-width:0;display:flex;align-items:center;gap:14px">
        <span class="stripe" style="background:${e(row.course?.color || "var(--faint)")}"></span>
        <span style="min-width:0"><span class="title" style="display:block;font-size:14px;font-weight:500;color:var(--link);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(row.title)}</span><span class="due-line">${e(row.due)}</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${meta}</span></span>
      </span>
      ${scoreCol}
      <span class="col-status">${statusMark(row.status)}${asideText}</span>
      <span class="chev">${icon("chevronRight", 16)}</span>
    </a>`;
  }

  function workTable(model, scores, aside) {
    const head = `<div class="table-head"><span class="col-due">Due</span><span class="col-item" style="flex:1 1 200px;min-width:0">Item</span>${scores ? `<span class="col-score">Score</span>` : ""}<span class="col-status">Status</span><span style="width:16px"></span></div>`;
    const rows = model.rows.length
      ? model.rows.map((row, i) => workRowHtml(row, i, model.rows, scores, aside)).join("")
      : emptyState("", model.emptyText);
    return `<section class="card" style="overflow:hidden">${head}${rows}</section>`;
  }

  function workListPage(model) {
    const tabs = [["upcoming", "Upcoming"], ["attention", "Needs attention"], ["done", "Submitted & graded"], ["all", "All"]];
    const scores = model.tab === "done" || model.tab === "all";
    const aside = (row) => row.markedDone ? "Marked done by you" : row.skipped ? "Skipped by you" : row.count ? "" : row.rel;
    const href = (patch) => {
      const params = new URLSearchParams({ tab: model.tab, type: model.type, course: model.courseId, ...patch });
      return `#/work?${params.toString()}`;
    };
    return `<div class="page" data-screen="work">
      <div class="page-head"><div><h1>Assignments</h1></div></div>
      ${workToolbar(model, tabs, href)}
      ${workTable(model, scores, aside)}
    </div>`;
  }


  Object.assign(dash, {
    workListPage
  });
})(globalThis);
