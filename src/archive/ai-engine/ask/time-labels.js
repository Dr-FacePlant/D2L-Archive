// How Ask writes times for the model: one style everywhere, with the year, the
// time of day and how far off it is, worked out when a tool runs. Every time says
// what it is (due, opens, at); a close-only date counts as due, as the student reads it.
(function initDashboardAskTimeLabels(global) {
  const dash = global.D2LDashboard ||= {};
  const { fmtTime, relativeDay, toDate } = dash;

  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  // "Fri, Nov 13, 2026, 11:59 PM (in 8 days)". A date with no time of day has none.
  function askTime(value, now) {
    const dateOnly = DATE_ONLY.test(String(value || ""));
    const at = toDate(dateOnly ? new Date(`${value}T12:00`) : value);
    if (!at) return "";
    const day = at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    return `${day}${dateOnly ? "" : `, ${fmtTime(at)}`} (${relativeDay(at, now).toLowerCase()})`;
  }

  // The zone's everyday name ("Eastern Time"), or nothing where the browser has none.
  function zoneName(now) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZoneName: "longGeneric" }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value || "";
    } catch {
      return "";
    }
  }

  // "Thursday, November 5, 2026, 9:14 AM Eastern Time".
  function askNow(now) {
    const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const zone = zoneName(now);
    return `${day}, ${fmtTime(now)}${zone ? ` ${zone}` : ""}`;
  }

  // An item's times for the model as one line, each with its meaning, so it never has to choose:
  // { when: "due Fri, Nov 6, 2026, 11:59 PM (tomorrow) · opens Thu, Nov 5, 2026, 4:30 PM (today)" }.
  // An opening already past is left out when there is a due time. A time that is no deadline says "at".
  function askTimes({ dueAt, opensAt, at, endsAt }, now) {
    const opens = toDate(opensAt);
    const parts = [
      dueAt && `due ${askTime(dueAt, now)}`,
      opens && (opens > now || !dueAt) && `${opens > now ? "opens" : "opened"} ${askTime(opensAt, now)}`,
      at && `at ${askTime(at, now)}`,
      endsAt && `ends ${askTime(endsAt, now)}`
    ].filter(Boolean);
    return parts.length ? { when: parts.join(" · ") } : {};
  }

  // What a calendar entry's time means, by D2L's label. A quiz's "Availability Ends" is its
  // deadline, as the calendar shows it; an entry with no label is when something happens.
  function askEventTimes(entity, targetType = "") {
    const { startAt, endAt, dueAt } = entity.dates || {};
    const start = startAt || dueAt || "";
    const label = entity.eventLabel || "";
    if (label === "Due" || (label === "Availability Ends" && targetType === "quizBundle")) return { dueAt: dueAt || start };
    if (label === "Available") return { opensAt: start };
    if (label === "Availability Ends") return { endsAt: start };
    return { at: start, endsAt: endAt && endAt !== start ? endAt : "" };
  }

  Object.assign(dash, { askTime, askNow, askTimes, askEventTimes });
})(globalThis);
