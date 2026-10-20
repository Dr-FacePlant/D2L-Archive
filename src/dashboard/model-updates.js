// Updates inbox rows and grouping.
(function initDashboardModelUpdates(global) {
  const dash = global.D2LDashboard ||= {};
  const { ago, fmtDateTime, fromEarlierTerm, routeFor, startOfDay, time } = dash;
  // --------------------------------------------------------------- updates

  const UPDATE_TEXT = Object.freeze({
    announcement: { label: "New announcement", icon: "megaphone" },
    grade: { label: "Grade posted", icon: "check" },
    dueDateChanged: { label: "Due date changed", icon: "calendar" },
    newItem: { label: "New since last sync", icon: "doc" }
  });

  function updateRows(index, readState = {}) {
    const seen = new Set();
    return (index.raw.updates || [])
      .filter((update) => index.visible.has(update.courseId) && !fromEarlierTerm(index, update.courseId, update.at))
      .filter((update) => {
        const key = `${update.kind}|${update.courseId}|${update.title}|${update.at}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((update) => {
        const entity = index.byId.get(update.entityId) || null;
        const course = index.courseById.get(update.courseId);
        const text = UPDATE_TEXT[update.kind] || { label: "Update", icon: "doc" };
        let sub = `${update.title} · ${course?.label || ""}`;
        if (update.kind === "grade" && update.detail) sub = `${update.title} · ${update.detail} · ${course?.label || ""}`;
        if (update.kind === "dueDateChanged") sub = `${update.title} · ${update.from ? fmtDateTime(update.from, index.now) : "no date"} → ${update.to ? fmtDateTime(update.to, index.now) : "no date"}`;
        if (update.kind === "newItem") sub = `${update.title} · ${course?.label || ""}`;
        return {
          id: update.updateId,
          courseId: update.courseId,
          kind: update.kind,
          label: text.label,
          icon: text.icon,
          title: update.title,
          sub,
          at: update.at,
          group: updateGroup(update.at, index.now),
          ago: ago(update.at, index.now),
          unread: !readState[update.updateId],
          route: routeFor(entity),
          entityId: update.entityId
        };
      })
      .sort((a, b) => time(b.at) - time(a.at));
  }

  // Time headings on the Updates page. Weeks start on Sunday, like D2L's calendar.
  function updateGroup(value, now) {
    const at = time(value);
    const today = startOfDay(now);
    if (at >= today.getTime()) return "Today";
    const week = new Date(today);
    week.setDate(week.getDate() - week.getDay());
    return at >= week.getTime() ? "This week" : "Earlier this term";
  }


  Object.assign(dash, {
    updateRows, updateGroup, UPDATE_TEXT
  });
})(globalThis);
