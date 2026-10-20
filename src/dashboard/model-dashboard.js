// Dashboard overview: course cards, What's Next and sync state.
(function initDashboardModelDashboard(global) {
  const dash = global.D2LDashboard ||= {};
  const { DAY_MS, ago, allWork, byDue, countdownFor, dateParts, dueLine, fmtShortDate, fmtTime, gradedFirst, needsAttention, nextRows, startOfDay, time, toDate, upcomingWork, updateRows, withChecklistState, withHiddenState } = dash;
  // ------------------------------------------------------------- dashboard

  function syncModel(index, settings = {}, failedAt = "") {
    const sync = index.raw.sync || {};
    const latest = (sync.runs || [])[0] || null;
    const lastAt = latest?.completedAt || latest?.startedAt || null;
    const reminderHours = Number(settings.reminderHours ?? 24);
    const ageHours = lastAt ? (index.now - toDate(lastAt)) / 3600000 : Infinity;
    // A sync that didn't finish after the last good one, or a run D2L marked failed.
    const failed = (failedAt && (!lastAt || time(failedAt) > time(lastAt))) || /fail|error/i.test(latest?.status || "");
    const freshness = latest?.categoryFreshness || {};
    const partialCategories = Object.entries(freshness).filter(([, value]) => value?.status === "partial").map(([key]) => key);
    return {
      lastAt,
      label: lastAt ? `Synced from D2L ${ago(lastAt, index.now)}` : "Not synced from D2L yet",
      hint: failed ? `Last sync didn't finish${lastAt ? ` · last good sync ${syncDay(lastAt, index.now)}` : ""}`
        : lastAt ? `Last synced ${syncDay(lastAt, index.now)}${partialCategories.length ? ` · ${partialCategories.length} area${partialCategories.length === 1 ? "" : "s"} partial` : ""}` : "Not synced from D2L yet",
      state: failed ? "failed" : !lastAt ? "never" : reminderHours > 0 && ageHours > reminderHours ? "stale" : "fresh",
      runs: sync.runs || [],
      freshness,
      partialCategories,
      revision: sync.status?.databaseRevision ?? 0
    };
  }

  // "today at 9:14 AM", "yesterday at 6:02 PM", "Sep 21 at 8:40 AM".
  function syncDay(value, now) {
    const day = startOfDay(value).getTime();
    const today = startOfDay(now).getTime();
    const word = day === today ? "today" : day === today - DAY_MS ? "yesterday" : fmtShortDate(value, now);
    return `${word} at ${fmtTime(value)}`;
  }

  function courseCard(index, course, upcoming) {
    const next = gradedFirst(upcoming.filter((item) => item.courseId === course.courseId))[0] || null;
    return {
      ...course,
      route: `#/course/${encodeURIComponent(course.courseId)}`,
      progressLabel: course.completion ? `${course.completion.completed} of ${course.completion.required} content items done` : "",
      grade: dash.finalGradeLabel(course),
      next: next ? { title: next.title, route: next.route, due: next.dueAt ? `${fmtShortDate(next.dueAt, index.now)} · ${fmtTime(next.dueAt)}` : dueLine(next, index.now), kind: next.kind } : null
    };
  }

  function dashboardModel(index, readState = {}, checklistDone = {}, hiddenWork = {}) {
    const upcoming = upcomingWork(index, "", checklistDone, hiddenWork);
    const all = withHiddenState(withChecklistState(allWork(index), checklistDone), hiddenWork);
    // TEMP STUDY BANNER: the next 4 still-open quizzes with a due date inside
    // the next 20 days. Quizzes already past due but still open come first.
    const horizon = index.now.getTime() + 20 * DAY_MS;
    const soonQuizzes = upcoming
      .filter((item) => item.kind === "quiz" && Number.isFinite(time(item.dueAt)) && time(item.dueAt) < horizon)
      .sort(byDue).slice(0, 4)
      .map((item) => ({ ...item, parts: dateParts(item.dueAt), count: countdownFor(item, index.now) }));
    return {
      soonQuizzes,
      next: nextRows(upcoming, 5).map((item) => ({ ...item, parts: dateParts(item.dueAt || item.opensAt), count: countdownFor(item, index.now), dueLine: dueLine(item, index.now) })),
      nextTotal: upcoming.length,
      attention: all.filter((item) => needsAttention(item, index.now.getTime())).length,
      updates: updateRows(index, readState).slice(0, 5),
      courses: index.courses.map((course) => courseCard(index, course, upcoming)),
      grades: index.courses.map((course) => dash.dashboardGradeSnapshot(index, course, upcoming)),
      hasArchive: index.allCourses.length > 0
    };
  }


  Object.assign(dash, {
    syncModel, syncDay, courseCard, dashboardModel
  });
})(globalThis);
