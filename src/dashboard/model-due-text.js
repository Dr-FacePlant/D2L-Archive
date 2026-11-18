// How a deadline reads in a row: the short due line, the full one, and the
// words that mark late work. A guessed date is always labelled as a guess.
(function initDashboardModelDueText(global) {
  const dash = global.D2LDashboard ||= {};
  const { fmtDateTime, fmtShortDate, fmtTime, time } = dash;

  // Past the deadline but D2L still takes it: never posted, or only partly.
  // A guess is never late; the model leaves those rows open.
  const isLate = (item) => !item.inferred && (item.status.key === "pastDue" || item.status.key === "partialLate");

  // Work whose deadline comes from its lesson says so: "Due with Lesson 6 · 11:59 PM".
  const dueVerb = (item) => item.lesson ? `Due with ${item.lesson} ·` : item.kind === "discussion" ? "Closes" : "Due";

  // A guessed date names where it came from, so it never reads as D2L's own.
  function inferredLine(item, now) {
    const guess = item.inferred;
    const at = fmtDateTime(guess.at, now);
    return guess.rule === "nextModuleOpen"
      ? `Estimated · next module opens ${at}`
      : `Estimated · ${guess.module || "Module"} closes ${at}`;
  }

  function dueLine(item, now) {
    if (item.inferred) return inferredLine(item, now);
    if (isLate(item) && item.closesAt) return `Past due · closes ${fmtDateTime(item.closesAt, now)}`;
    if (isLate(item) && item.kind !== "task") return `Was due${item.lesson ? ` with ${item.lesson} ·` : ""} ${fmtDateTime(item.dueAt, now)} · still open`;
    if (item.status.key === "notOpen" && item.opensAt) return `Opens ${fmtDateTime(item.opensAt, now)}`;
    if (!item.dueAt) return "No due date";
    if (!item.hasDueDate) return `Closes ${fmtShortDate(item.closesAt, now)} · ${fmtTime(item.closesAt)}`;
    const late = item.closesAt && item.dueAt && time(item.closesAt) > time(item.dueAt) + 60000 ? ` · accepted until ${fmtDateTime(item.closesAt, now)}` : "";
    return `${dueVerb(item)} ${fmtTime(item.dueAt)}${late}`;
  }

  // The due line with its date, for lists where no date box sits beside it.
  // The due date always comes first, so it's the thing you see.
  function dueFull(item, now) {
    if (!item.dueAt || !item.hasDueDate) return dueLine(item, now);
    const verb = dueVerb(item);
    const lateUntil = item.closesAt && time(item.closesAt) > time(item.dueAt) + 60000 ? fmtDateTime(item.closesAt, now) : "";
    if (isLate(item)) return `Was due${item.lesson ? ` with ${item.lesson} ·` : ""} ${fmtDateTime(item.dueAt, now)} · ${lateUntil ? `closes ${lateUntil}` : "still open"}`;
    if (item.status.key === "notOpen" && item.opensAt) return `${verb} ${fmtDateTime(item.dueAt, now)} · opens ${fmtDateTime(item.opensAt, now)}`;
    return `${verb} ${fmtDateTime(item.dueAt, now)}${lateUntil ? ` · accepted until ${lateUntil}` : ""}`;
  }

  Object.assign(dash, { isLate, dueVerb, dueLine, dueFull, inferredLine });
})(globalThis);
