// Grades page, grade cards and score chart.
(function initDashboardRenderGrades(global) {
  const dash = global.D2LDashboard ||= {};
  const { emptyState, escapeHtml: e, selectMenu, icon } = dash;
  // --------------------------------------------------------------- grades

  function gradeRowHtml(row, weighted, showGrade = true) {
    const marks = [!showGrade && !row.graded ? `<span class="mark">Not graded yet</span>` : "", row.dropped ? `<span class="mark">Dropped</span>` : "", row.bonus ? `<span class="mark">Bonus</span>` : "", row.excluded ? `<span class="mark">Not counted</span>` : ""].join("");
    return `<a class="table-row" href="${e(row.route)}" data-entity="${e(row.id)}" style="min-height:52px">
      <span style="flex:1;min-width:0;font-size:14px;font-weight:500;color:var(--ink-2)">${e(row.title)}${marks}</span>
      <span class="col-score">${e(row.points)}</span>
      ${weighted ? `<span class="col-weight">${e(row.weight || "- / -")}</span>` : ""}
      ${showGrade ? `<span class="col-pct${row.graded ? "" : " ungraded"}">${e(row.grade)}</span>` : ""}
      <span class="col-fb">${row.hasFeedback ? `<span class="fb-dot" title="Has feedback"></span>` : ""}</span>
    </a>`;
  }

  // Scores over time: dots are HTML so they stay round at any width; the line
  // is an SVG stretched to the plot with a stroke that doesn't stretch.
  // A link when there is somewhere to go, a disabled button when there isn't.
  function iconLink(href, iconName, label) {
    return href
      ? `<a class="icon-btn" href="${e(href)}" aria-label="${e(label)}" title="${e(label)}">${icon(iconName, 18)}</a>`
      : `<button class="icon-btn" type="button" disabled aria-label="${e(label)}" title="${e(label)}">${icon(iconName, 18)}</button>`;
  }

  function chartControls(chart) {
    // The same custom menus as Assignments, Content and the Grades course picker.
    const menu = (id, label, ariaLabel, options) => selectMenu(id, label, options.find((option) => option.selected)?.label, options.map((option) => ({ key: option.label, label: option.label, href: option.href })), ariaLabel);
    return `<div class="chart-controls">
        ${menu("grades-view-menu", "Show", "What the chart shows", chart.viewOptions)}
        <div class="chart-range">
          ${menu("grades-range-menu", "Time range", "Time range", chart.rangeOptions)}
          ${iconLink(chart.zoomIn, "zoomIn", "Zoom in")}${iconLink(chart.zoomOut, "zoomOut", "Zoom out")}
          ${iconLink(chart.back, "chevronLeft", "Earlier")}${iconLink(chart.forward, "chevronRight", "Later")}
          ${chart.rangeText ? `<span class="chart-range-text">${e(chart.rangeText)}</span>` : ""}
        </div>
      </div>`;
  }

  function scoreChart(chart, course, options = {}) {
    if (!chart) return "";
    // Same look as the dashboard's grade cards: green line, soft fill, dashed grid.
    const color = "var(--spark)";
    const edge = (x) => x < 18 ? "left" : x > 82 ? "right" : "";
    const coords = chart.points.map((p) => `${p.x},${100 - p.y}`).join(" ");
    const line = chart.points.length > 1
      ? `<svg class="chart-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="score-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:${color}" stop-opacity=".24"/><stop offset="100%" style="stop-color:${color}" stop-opacity="0"/></linearGradient></defs>
          <polygon class="chart-area" points="${chart.points[0].x},100 ${coords} ${chart.points.at(-1).x},100" fill="url(#score-fill)"/>
          <polyline points="${coords}" style="stroke:${color}" vector-effect="non-scaling-stroke"/></svg>`
      : "";
    const tag = options.inCard ? "div" : "section";
    return `<${tag} class="${options.inCard ? "grade-chart-pane" : "card card-pad"} chart-card${options.compact ? " compact" : ""}" aria-labelledby="h-chart">
      <div class="card-head"><div><h2 id="h-chart">Scores over time</h2><div class="sub">Each dot is one graded item on the day D2L graded it. Tap or point at a dot for its score.</div></div></div>
      ${chartControls(chart)}
      ${chart.note ? `<p class="chart-note">${e(chart.note)}</p>` : ""}
      <div class="chart">
        <div class="chart-plot">
          ${chart.yTicks.map((tick) => `<div class="chart-grid" style="bottom:${tick.y}%"><span>${e(tick.label)}</span></div>`).join("")}
          ${chart.final ? `<div class="chart-ref" style="bottom:${chart.final.y}%"><span>${e(chart.final.label)}</span></div>` : ""}
          ${line}
          ${chart.empty ? `<div class="chart-empty">${e(chart.empty)}</div>` : ""}
          ${chart.points.map((p, i) => `<a class="chart-dot ${edge(p.x)}${i === chart.points.length - 1 ? " latest" : ""}" href="${e(p.route)}" style="left:${p.x}%;bottom:${p.y}%;--dot:${e(color)}" aria-label="${e(`${p.title}: ${p.shown || p.score}, ${p.when}`)}">${i === chart.points.length - 1 ? `<span class="dot-label" aria-hidden="true">${e(chart.view === "pct" ? p.shown || p.score : p.score)}</span>` : ""}<span class="tip"><b>${e(p.title)}</b>${e([p.score, p.shown].filter(Boolean).join(" · "))}<br>${e(p.when)}</span></a>`).join("")}
        </div>
        <div class="chart-x">${chart.xTicks.map((tick) => `<span style="left:${tick.x}%">${e(tick.label)}</span>`).join("")}</div>
      </div>
    </${tag}>`;
  }

  function gradeSummary(model) {
    const card = model.cards.find((entry) => entry.courseId === model.courseId);
    if (!card || !model.course) return "";
    const summary = model.summary;
    const source = model.final ? "Published by D2L" : summary ? "Estimate from graded work" : "No grade available yet";
    const detail = model.final
      ? [summary?.detail, `${card.graded} of ${card.total} items graded`].filter(Boolean).join(" · ")
      : summary ? [`D2L has not released a final grade`, `${card.graded} of ${card.total} items graded`].join(" · ") : `${card.graded} of ${card.total} items graded`;
    return `<section class="card grade-overview" aria-label="${e(`${model.course.code || "Course"} grade`)}">
      <div class="grade-summary">
      <div class="grade-summary-main">
        <div class="grade-summary-course">${e([model.course.code, model.course.name].filter(Boolean).join(" · "))}</div>
        <div class="grade-summary-value">${e(summary?.value || "—")}</div>
        <div class="grade-summary-source">${e(source)}</div>
        <div class="grade-summary-detail">${e(detail)}</div>
      </div>
      ${summary?.explanation ? `<details class="grade-method"><summary>How this is calculated</summary><p>${e(summary.explanation)}</p></details>` : ""}
      <a class="link-btn grade-summary-d2l" href="${e(model.d2lUrl)}" rel="noopener noreferrer" data-d2l-link>Open grades in D2L ${icon("external", 14)}</a>
      </div>
      ${scoreChart(model.chart, model.course, { compact: true, inCard: true })}
    </section>`;
  }

  function gradesPage(model) {
    const course = model.course;
    return `<div class="page" data-screen="grades">
      <div class="page-head"><div><h1>Grades</h1></div>
      ${model.cards.length ? selectMenu("grades-course-menu", "Course", model.courseId, model.cards.map((card) => ({ key: card.courseId, label: card.code || card.label || card.courseId, href: `#/grades?course=${encodeURIComponent(card.courseId)}` })), "Choose a course") : ""}</div>
      ${gradeSummary(model)}
      ${course ? `<section class="card" style="overflow:hidden">
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:16px 22px;border-bottom:1px solid var(--line-2)">
          <div><h2 style="font-size:17px;font-weight:600">${e([course.code, course.name].filter(Boolean).join("  ·  "))}</h2>
          <div style="font-size:13px;color:var(--muted);margin-top:3px">${e(`${model.sections.reduce((sum, section) => sum + section.rows.length, 0)} grade items`)}${model.ungradedCountsAsZero ? " · ungraded items count as 0 in this course" : ""}</div></div>
        </div>
        <div class="table-head"><span style="flex:1">Grade item</span><span class="col-score">Points</span>${model.weighted ? `<span class="col-weight">Weight achieved</span>` : ""}${model.showGrade ? `<span class="col-pct">Grade</span>` : ""}<span class="col-fb"></span></div>
        ${model.sections.length ? model.sections.map((section) => `${section.categoryId ? `<div class="group-row"><span style="flex:1">${e(section.name || "Category")}${section.weight != null && model.weighted ? ` <span style="font-weight:500;color:var(--muted)">· weight ${e(section.weight)}%</span>` : ""}${section.dropRule ? ` <span style="font-weight:500;color:var(--muted)">· ${e(section.dropRule)}</span>` : ""}</span>${section.subtotal ? `<span class="col-score">${e(section.subtotal.points)}</span>${model.weighted ? `<span class="col-weight">${e(section.subtotal.weight)}</span>` : ""}${model.showGrade ? `<span class="col-pct">${e(section.subtotal.grade)}</span>` : ""}<span class="col-fb"></span>` : ""}</div>` : ""}${section.rows.map((row) => gradeRowHtml(row, model.weighted, model.showGrade)).join("")}`).join("") : emptyState("", "No grade items in the archive for this course.")}
      </section>` : emptyState("No courses", "Sync to see grades.")}
    </div>`;
  }


  Object.assign(dash, {
    gradeRowHtml, iconLink, chartControls, scoreChart, gradeSummary, gradesPage
  });
})(globalThis);
