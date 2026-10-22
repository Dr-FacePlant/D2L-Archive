// Calendar page.
(function initDashboardRenderCalendar(global) {
  const dash = global.D2LDashboard ||= {};
  const { MON, emptyState, escapeHtml: e, icon, plural } = dash;
  // ------------------------------------------------------------- calendar

  function calendarPage(model) {
    const eventChip = (event) => `<a class="cal-ev" href="${e(event.route)}" style="background:${e(event.course?.tint || "var(--line-2)")};color:${e(event.course?.ink || "var(--ink-3)")}" title="${e(`${event.title} · ${event.time}`)}">${e(event.title)}</a>`;
    return `<div class="page" data-screen="calendar">
      <div class="page-head">
        <div><h1>Calendar</h1></div>
      </div>
      <div class="cols top">
        <section class="card cal">
          <div class="cal-bar">
            <a class="icon-btn" href="${e(model.prevHref)}" aria-label="Previous month">${icon("chevronLeft", 18)}</a>
            <span class="cal-month">${e(model.monthLabel)}</span>
            <a class="icon-btn" href="${e(model.nextHref)}" aria-label="Next month">${icon("chevronRight", 18)}</a>
          </div>
          <div class="cal-head">${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => `<div>${d}</div>`).join("")}</div>
          <div class="cal-grid">${model.cells.map((cell) => `<div class="cal-cell ${cell.inMonth ? "" : "out"} ${cell.today ? "today" : ""} ${cell.selected ? "sel" : ""}" data-action="select-day" data-day="${e(cell.key)}" data-month="${e(model.month)}" role="button" tabindex="0" aria-label="${e(`${cell.key}, ${plural(cell.total, "event")}`)}">
              <span class="cal-num">${cell.day}</span>
              ${cell.events.map(eventChip).join("")}
              ${cell.more ? `<span class="cal-more">+${cell.more} more</span>` : ""}
            </div>`).join("")}</div>
        </section>
        <div class="side stack" style="flex:1 1 280px">
          <section class="card card-pad">
            <div class="card-head"><h2>${e(model.selectedTitle)}</h2><a class="today-jump" href="${e(model.todayHref)}" aria-label="Go to today" title="Today">${icon("calendar", 18)}</a></div>
            ${model.selectedEvents.length ? model.selectedEvents.map((event) => `<a class="row compact" href="${e(event.route)}"><span class="stripe" style="background:${e(event.course?.color || "var(--faint)")}"></span><span class="grow"><span class="title plain">${e(event.title)}</span><span class="meta">${e(event.course?.label || "")}</span></span><span class="aside">${e(event.time)}</span></a>`).join("") : emptyState("", "Nothing scheduled in D2L.")}
          </section>
          <section class="card card-body">
            <h2 style="font-size:14px;font-weight:600;margin-bottom:4px">Show</h2>
            <div class="setting cal-setting"><div class="l"><b>Opening dates</b><span>When D2L makes items available</span></div><button class="switch" type="button" role="switch" data-action="nav" data-href="${e(model.allHref)}" aria-checked="${model.showAll}" aria-label="Show opening dates"></button></div>
            ${model.courses.map((course) => `<div class="setting cal-setting"><div class="l"><b><i class="cal-dot" style="background:${e(course.color)}"></i>${e(course.label)}</b></div><button class="switch" type="button" role="switch" data-action="nav" data-href="${e(course.href)}" aria-checked="${course.on}" aria-label="${e(`Show ${course.label}`)}"></button></div>`).join("")}
          </section>
        </div>
      </div>
    </div>`;
  }


  Object.assign(dash, {
    calendarPage
  });
})(globalThis);
