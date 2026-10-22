// Calendar events and the calendar screen.
(function initDashboardModelCalendar(global) {
  const dash = global.D2LDashboard ||= {};
  const { dayKey, fmtLongDate, fmtTime, monthLabel, routeFor, time, toDate } = dash;
  // -------------------------------------------------------------- calendar

  function calendarEvents(index) {
    return index.entities
      .filter((entity) => entity.entityType === "calendarEvent" && index.visible.has(entity.courseId))
      .map((entity) => {
        const course = index.courseById.get(entity.courseId);
        const at = entity.dates?.startAt || entity.dates?.dueAt || entity.dates?.endAt;
        const target = entity.targetEntityId ? index.byId.get(entity.targetEntityId) : null;
        return {
          id: entity.entityId,
          title: entity.eventLabel ? `${entity.canonicalTitle} - ${entity.eventLabel}` : entity.canonicalTitle,
          at,
          day: dayKey(at),
          time: fmtTime(at),
          course,
          // The item the event belongs to, or the event itself when that item
          // has no screen (a whole discussion forum).
          route: routeFor(target) || routeFor(entity),
          entity
        };
      })
      .filter((event) => event.day)
      .sort((a, b) => time(a.at) - time(b.at) || a.title.localeCompare(b.title));
  }

  // By default the calendar shows deadlines: due dates, quiz closings, and the
  // events D2L gives no label (discussions). D2L's "Available" markers and the
  // other "Availability Ends" markers come back with "Show opening dates".
  function isDeadline(index, event) {
    const label = event.entity.eventLabel || "";
    if (label === "Available") return false;
    if (label === "Availability Ends") return index.byId.get(event.entity.targetEntityId)?.entityType === "quizBundle";
    return true;
  }

  function calendarModel(index, params = {}) {
    const showAll = params.all === "1";
    const hidden = new Set(String(params.hide || "").split(",").filter((id) => index.courseById.has(id)));
    const events = calendarEvents(index).filter((event) => !hidden.has(event.course?.courseId) && (showAll || isDeadline(index, event)));
    const today = dayKey(index.now);
    const selected = /^\d{4}-\d{2}-\d{2}$/.test(params.day || "") ? params.day : today;
    const monthMatch = String(params.month || "").match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number(monthMatch[1]) : Number(selected.slice(0, 4));
    const month = monthMatch ? Number(monthMatch[2]) - 1 : Number(selected.slice(5, 7)) - 1;
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const byDay = new Map();
    for (const event of events) {
      if (!byDay.has(event.day)) byDay.set(event.day, []);
      byDay.get(event.day).push(event);
    }
    const cells = [];
    const weeks = Math.ceil((first.getDay() + new Date(year, month + 1, 0).getDate()) / 7);
    for (let i = 0; i < weeks * 7; i += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dayKey(date);
      const dayEvents = byDay.get(key) || [];
      cells.push({ key, day: date.getDate(), inMonth: date.getMonth() === month, today: key === today, selected: key === selected, events: dayEvents.slice(0, 3), more: Math.max(0, dayEvents.length - 3), total: dayEvents.length });
    }
    const pad = (n) => String(n).padStart(2, "0");
    const prev = new Date(year, month - 1, 1);
    const next = new Date(year, month + 1, 1);
    const selectedDate = toDate(`${selected}T12:00:00`);
    // Every link keeps the filters; `patch` changes one setting.
    const href = (patch) => {
      const values = { month: `${year}-${pad(month + 1)}`, day: selected, all: showAll ? "1" : "", hide: [...hidden].join(","), ...patch };
      const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value));
      return `#/calendar?${query}`;
    };
    const toggled = (courseId) => [...hidden].filter((id) => id !== courseId).concat(hidden.has(courseId) ? [] : [courseId]).join(",");
    return {
      monthLabel: monthLabel(year, month),
      month: `${year}-${pad(month + 1)}`,
      prevHref: href({ month: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}` }),
      nextHref: href({ month: `${next.getFullYear()}-${pad(next.getMonth() + 1)}` }),
      todayHref: href({ month: today.slice(0, 7), day: today }),
      showAll,
      allHref: href({ all: showAll ? "" : "1" }),
      today,
      cells,
      selected,
      selectedTitle: fmtLongDate(selectedDate, index.now),
      selectedEvents: byDay.get(selected) || [],
      total: events.length,
      courses: index.courses.map((course) => ({ ...course, on: !hidden.has(course.courseId), href: href({ hide: toggled(course.courseId) }) }))
    };
  }


  Object.assign(dash, {
    calendarEvents, isDeadline, calendarModel
  });
})(globalThis);
