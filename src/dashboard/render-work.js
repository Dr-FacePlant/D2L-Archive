// Work list page.
(function initDashboardRenderWork(global) {
  const dash = global.D2LDashboard ||= {};
  const { dateBox, emptyState, escapeHtml: e, selectMenu, icon, pressed, statusMark } = dash;
  // ------------------------------------------------------------ work list

  function workListPage(model) {
    const tabs = [["upcoming", "Upcoming"], ["attention", "Needs attention"], ["done", "Submitted & graded"], ["all", "All"]];
    // Only finished work has scores, so only Submitted & graded and All show
    // a Score column. The type sits in the gray line under the title
    // ("Quiz · CRJU 9004 · 10 points"); the Type filter still works.
    const scores = model.tab === "done" || model.tab === "all";
    const aside = (row) => row.markedDone ? "Marked done by you" : row.skipped ? "Skipped by you" : row.count ? "" : row.rel;
    const href = (patch) => {
      const params = new URLSearchParams({ tab: model.tab, type: model.type, course: model.courseId, ...patch });
      return `#/work?${params.toString()}`;
    };
    return `<div class="page" data-screen="work">
      <div class="page-head"><div><h1>Assignments</h1></div></div>
      <div class="toolbar work-filter-bar">
        <div class="seg" role="group" aria-label="Which work">${tabs.map(([key, label]) => `<button type="button" data-action="nav" data-href="${e(href({ tab: key }))}" aria-pressed="${model.tab === key}">${e(label)} (${model.counts[key]})</button>`).join("")}</div>
        <div class="work-secondary-filters">
          ${selectMenu("work-type-menu", "Type", model.type, model.typeChips.map((chip) => ({ ...chip, href: href({ type: chip.key }) })), "Filter by type")}
          ${selectMenu("work-course-menu", "Course", model.courseId, model.courseChips.map((chip) => ({ ...chip, href: href({ course: chip.key }) })), "Filter by course")}
        </div>
      </div>
      <section class="card" style="overflow:hidden">
        <div class="table-head"><span class="col-due">Due</span><span class="col-item" style="flex:1 1 200px;min-width:0">Item</span>${scores ? `<span class="col-score">Score</span>` : ""}<span class="col-status">Status</span><span style="width:16px"></span></div>
        ${model.rows.length ? model.rows.map((row, i) => `${row.week !== model.rows[i - 1]?.week ? `<div class="week-row"><span>${e(row.week)}</span><small>(${model.rows.filter((other) => other.week === row.week).length})</small></div>` : ""}<a class="table-row" href="${e(row.route)}" data-entity="${e(row.id)}">
            <span class="col-due">${dateBox(row.parts, row.count)}</span>
            <span class="col-item" style="flex:1 1 200px;min-width:0;display:flex;align-items:center;gap:14px">
              <span class="stripe" style="background:${e(row.course?.color || "var(--faint)")}"></span>
              <span style="min-width:0"><span class="title" style="display:block;font-size:14px;font-weight:500;color:var(--link);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(row.title)}</span><span class="due-line">${e(row.due)}</span><span style="display:block;font-size:12px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e([row.typeLabel, row.course?.label, row.points].filter(Boolean).join("  ·  "))}</span></span>
            </span>
            ${scores ? `<span class="col-score">${e(row.score || "—")}</span>` : ""}
            <span class="col-status">${statusMark(row.status)}${aside(row) ? `<small>${e(aside(row))}</small>` : ""}</span>
            <span class="chev">${icon("chevronRight", 16)}</span>
          </a>`).join("") : emptyState("", model.emptyText)}
      </section>
    </div>`;
  }


  Object.assign(dash, {
    workListPage
  });
})(globalThis);
