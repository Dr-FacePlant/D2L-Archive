// Work items, statuses, due lines and work lists.
(function initDashboardModelWork(global) {
  const dash = global.D2LDashboard ||= {};
  const { D2L_ORIGIN, DAY_MS, KIND_LABELS, KIND_PLURALS, countdown, dateParts, dayKey, dueFull, dueLine, dueVerb, fmtDateTime, fmtNumber, fmtPoints, fmtShortDate, fmtTime, fromEarlierTerm, inferredDue, isLate, lessonDue, plural, relativeDay, routeFor, startOfDay, step, time, words } = dash;
  // ------------------------------------------------------------------ work

  const isGradedGrade = (grade) => Boolean(grade && grade.status === "graded");
  const gradeLabel = (grade) => isGradedGrade(grade) ? (fmtPoints(grade.grade?.pointsEarned, grade.grade?.pointsPossible) || grade.grade?.displayed || "") : "";
  // D2L shows "Due on …" only for a real due date; when the extractor fell back
  // to the close date (dueAtSource "apiEndDate") there is no due date.
  const realDue = (entity) => entity.dueAtSource === "apiEndDate" ? null : entity.dates?.dueAt || null;
  const status = (key, label, tone) => ({ key, label, tone });

  // How far your D2L posts go toward a discussion: a thread of your own and
  // enough replies in classmates' threads (1, unless a linked checklist task
  // asks for more). Archives organized before threads and replies were
  // counted apart count any post as both. D2L hides a topic's posts until it
  // opens, so only readable posts (or a grade) are known.
  function discussionProgress(index, entity) {
    const grade = entity.gradeEntityId ? index.byId.get(entity.gradeEntityId) : null;
    const graded = isGradedGrade(grade) || entity.grading?.pointsEarned != null;
    const posts = entity.posts || {};
    const posted = (posts.mine || 0) > 0;
    const counted = posts.mineThreads != null && posts.mineReplies != null;
    const needed = index.checklistLinks?.byDiscussion.get(entity.entityId)?.repliesNeeded || 1;
    const hasThread = counted ? posts.mineThreads > 0 : posted;
    const replies = counted ? posts.mineReplies : posted ? needed : 0;
    return { grade, graded, posted, hasThread, replies, needed, complete: hasThread && replies >= needed, known: graded || entity.access?.posts === "available" };
  }

  // What a partly done discussion still lacks: "thread", "reply", "3 replies",
  // "1 more reply".
  const missingStep = (hasThread, replies, needed, closed) => !hasThread ? "thread" : needed === 1 ? "reply"
    : replies && !closed ? plural(needed - replies, "more reply", "more replies") : plural(needed - replies, "reply", "replies");

  // A checklist task linked to a discussion is done when your D2L posts cover
  // its step (a thread, enough replies, or both) or the topic is graded.
  function linkedTask(index, link, topic) {
    const progress = discussionProgress(index, topic);
    const covered = link.role === "thread" ? progress.hasThread : link.role === "reply" ? progress.replies >= link.needed : progress.complete;
    return {
      discussionId: topic.entityId, title: topic.canonicalTitle, route: routeFor(topic), role: link.role, needed: link.needed,
      hasThread: progress.hasThread, replies: progress.replies, known: progress.known, done: progress.graded || covered
    };
  }

  // Statuses are states only, the same few words on every tool: Not open yet,
  // Open, Late, Submitted, Submitted late, Graded, Closed, Missed. Scores go in
  // the Score column and types in the Type column. Worked out only from
  // archived dates, submissions, attempts and grades.
  function assignmentItem(index, entity, base, now) {
    const opensAt = entity.dates?.availableFrom || null;
    const closesAt = entity.dates?.availableUntil || null;
    const stated = realDue(entity);
    const lesson = !stated && !closesAt ? lessonDue(index, entity, "assignment") : null;
    const grade = entity.gradeEntityId ? index.byId.get(entity.gradeEntityId) : null;
    const submitted = entity.submissionCount > 0 || entity.status === "submitted" || entity.status === "graded";
    const graded = Boolean(entity.score?.displayed) || isGradedGrade(grade);
    const guess = !stated && !lesson && !closesAt ? inferredDue(index, entity, "assignment") : null;
    const dueAt = stated || lesson?.at || guess?.at || null;
    const late = submitted && entity.dates?.submittedAt && dueAt && time(entity.dates.submittedAt) > time(dueAt);
    let st;
    if (graded) st = status("graded", "Graded", "good");
    else if (submitted) st = late ? status("late", "Submitted late", "warn") : status("submitted", "Submitted", "info");
    else if (opensAt && time(opensAt) > now) st = status("notOpen", "Not open yet", "neutral");
    else if (closesAt && time(closesAt) < now) st = status("closed", "Missed", "bad");
    else if (dueAt && !guess && time(dueAt) < now) st = status("pastDue", "Late", "warn");
    else st = status("open", "Open", "neutral");
    return {
      ...base, kind: "assignment", dueAt: dueAt || closesAt, hasDueDate: Boolean(stated || lesson), lesson: lesson?.lesson || "", opensAt, closesAt, status: st,
      inferred: guess, done: graded || submitted, actionable: !graded && !submitted && st.key !== "closed" && st.key !== "notOpen",
      score: graded ? (entity.score?.pointsEarned != null ? fmtPoints(entity.score.pointsEarned, entity.score.pointsPossible) : gradeLabel(grade) || entity.score?.displayed) : "",
      points: entity.pointsPossible != null ? plural(Number(fmtNumber(entity.pointsPossible)), "point") : "",
      d2lUrl: entity.urls?.d2l || ""
    };
  }

  function quizItem(index, entity, base, now) {
    const opensAt = entity.dates?.availableFrom || null;
    const closesAt = entity.dates?.availableUntil || null;
    const stated = realDue(entity);
    const lesson = !stated && !closesAt ? lessonDue(index, entity, "quiz") : null;
    const grade = entity.gradeEntityId ? index.byId.get(entity.gradeEntityId) : null;
    const graded = isGradedGrade(grade);
    const attempted = (entity.attempts?.completed || 0) > 0;
    const guess = !stated && !lesson && !closesAt ? inferredDue(index, entity, "quiz") : null;
    const dueAt = stated || lesson?.at || guess?.at || null;
    const countKnown = Boolean(entity.attempts?.source && entity.attempts.source !== "none");
    let st;
    if (graded) st = status("graded", "Graded", "good");
    else if (attempted) st = status("attempted", "Submitted", "info");
    else if (opensAt && time(opensAt) > now) st = status("notOpen", "Not open yet", "neutral");
    else if (closesAt && time(closesAt) < now) st = countKnown ? status("closed", "Missed", "bad") : status("closed", "Closed", "neutral");
    else st = status("open", "Open", "info");
    return {
      ...base, kind: "quiz", dueAt: dueAt || closesAt, hasDueDate: Boolean(stated || lesson), lesson: lesson?.lesson || "", opensAt, closesAt, status: st,
      inferred: guess, done: graded || attempted, actionable: !graded && !attempted && st.key !== "closed",
      score: graded ? gradeLabel(grade) : "", points: grade?.grade?.pointsPossible != null ? plural(Number(fmtNumber(grade.grade.pointsPossible)), "point") : "",
      d2lUrl: entity.urls?.d2l || ""
    };
  }

  function discussionItem(index, entity, base, now) {
    const opensAt = entity.dates?.availableFrom || null;
    const closesAt = entity.dates?.availableUntil || null;
    const lesson = !closesAt ? lessonDue(index, entity, "discussion") : null;
    const link = index.checklistLinks?.byDiscussion.get(entity.entityId) || null;
    const deadline = lesson || (!closesAt && link?.dueAt ? { at: link.dueAt, lesson: link.checklist } : null);
    const { grade, graded, posted, hasThread, replies, needed, complete } = discussionProgress(index, entity);
    const closed = Boolean(closesAt && time(closesAt) < now);
    const missing = missingStep(hasThread, replies, needed, closed);
    const guess = !deadline && !closesAt ? inferredDue(index, entity, "discussion") : null;
    let st;
    if (graded) st = status("graded", "Graded", "good");
    else if (complete) st = status("posted", "Submitted", "info");
    else if (posted && closed) st = status("partialClosed", `Closed · ${missing} missing`, "warn");
    else if (posted && deadline && time(deadline.at) < now) st = status("partialLate", `Late · ${missing} needed`, "warn");
    else if (posted) st = status("partial", hasThread ? `Posted · ${missing} needed` : "Replied · thread needed", "warn");
    else if (opensAt && time(opensAt) > now) st = status("notOpen", "Not open yet", "neutral");
    else if (closed) st = status("closed", "Closed", "neutral");
    else if (deadline && time(deadline.at) < now) st = status("pastDue", "Late", "warn");
    else st = status("open", "Open", "info");
    return {
      ...base, kind: "discussion", dueAt: deadline?.at || guess?.at || closesAt, hasDueDate: Boolean(deadline), lesson: deadline?.lesson || "", opensAt, closesAt, status: st,
      inferred: guess, repliesNeeded: needed, done: graded || complete,
      actionable: !graded && !complete && !["closed", "partialClosed", "notOpen"].includes(st.key),
      score: graded ? (gradeLabel(grade) || fmtPoints(entity.grading.pointsEarned, entity.grading.pointsPossible)) : "",
      points: entity.grading?.pointsPossible != null ? plural(Number(fmtNumber(entity.grading.pointsPossible)), "point") : "",
      d2lUrl: entity.urls?.d2l || ""
    };
  }

  function taskItem(index, entity, base, now) {
    const dueAt = entity.dates?.dueAt || null;
    const st = dueAt && time(dueAt) < now ? status("past", "Late", "warn") : status("open", "Open", "neutral");
    const link = index.checklistLinks?.byTask.get(entity.entityId) || null;
    const topic = link ? index.byId.get(link.discussionId) : null;
    return {
      ...base, title: entity.category ? `${entity.category} · ${entity.canonicalTitle}` : entity.canonicalTitle,
      kind: "task", dueAt, hasDueDate: Boolean(dueAt), opensAt: entity.dates?.availableFrom || null, closesAt: entity.dates?.availableUntil || null,
      linked: topic ? linkedTask(index, link, topic) : null,
      status: st, done: false, actionable: st.key === "open", score: "", points: "",
      description: entity.description || "",
      d2lUrl: entity.urls?.d2l || `${D2L_ORIGIN}/d2l/lms/checklist/checklists.d2l?ou=${entity.courseId}`
    };
  }

  function workItem(index, entity) {
    const now = index.now.getTime();
    const course = index.courseById.get(entity.courseId);
    const base = { id: entity.entityId, title: entity.canonicalTitle, courseId: entity.courseId, course, route: routeFor(entity), entity };
    if (entity.entityType === "assignmentBundle") return assignmentItem(index, entity, base, now);
    if (entity.entityType === "quizBundle") return quizItem(index, entity, base, now);
    if (entity.entityType === "discussionThread") return discussionItem(index, entity, base, now);
    if (entity.entityType === "courseToolItem" && entity.toolType === "checklistItem") return taskItem(index, entity, base, now);
    return null;
  }
  function allWork(index) {
    const items = [];
    for (const entity of index.entities) {
      if (!index.visible.has(entity.courseId)) continue;
      const item = workItem(index, entity);
      if (item && !fromEarlierTerm(index, item.courseId, item.dueAt)) items.push({ ...item, typeLabel: KIND_LABELS[item.kind] });
    }
    return items;
  }

  // Checklist completion is local dashboard state. It never represents a D2L
  // submission, but it does control which local work views still need attention.
  // A task linked to a discussion follows your D2L posts instead, so a tick
  // can't hide a missing reply. Until D2L shows the topic's posts, the tick counts.
  function withChecklistState(items, checklistDone = {}) {
    return items.map((item) => {
      if (item.kind !== "task") return item;
      const done = item.linked?.known ? item.linked.done : checklistDone[item.id] === true;
      return done ? { ...item, status: status("completed", "Submitted", "good"), done: true, actionable: false }
        : { ...item, done: false, actionable: item.status.key === "open" || item.status.key === "past" };
    });
  }

  // The student's own marks are local dashboard state too, and never change
  // D2L. Both leave Upcoming, Needs attention and What's Next. "done" also
  // files the work under Done; "skip" (and marks saved before there were
  // reasons, from "Not doing this one?") leaves it in the All tab only.
  // Either way the row keeps its real D2L status.
  function withHiddenState(items, hiddenWork = {}) {
    return items.map((item) => {
      const mark = hiddenWork[item.id];
      if (!mark) return item;
      return mark.reason === "done" ? { ...item, hidden: true, markedDone: true, done: true, actionable: false }
        : { ...item, hidden: true, skipped: true, actionable: false };
    });
  }

  // Open work with a deadline counts down in its date box ("in 2 days",
  // "late 2 days"). Done, missed or closed work, and work the student set
  // aside, keeps its date. A guessed date never counts down as late.
  function countdownFor(item, now) {
    if (!item.dueAt || item.done || item.hidden) return null;
    if (["closed", "partialClosed"].includes(item.status?.key) || item.status?.tone === "bad") return null;
    const left = countdown(item.dueAt, now);
    return left && !(item.inferred && left.late) ? left : null;
  }

  function byDue(a, b) {
    const left = time(a.dueAt), right = time(b.dueAt);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    if (Number.isFinite(left)) return -1;
    if (Number.isFinite(right)) return 1;
    return a.title.localeCompare(b.title);
  }
  // Graded work (everything but checklist tasks) comes before checklist tasks.
  const gradedFirst = (items) => [...items.filter((item) => item.kind !== "task"), ...items.filter((item) => item.kind === "task")];

  // A course's checklist tasks on one day become one row ("HIST 9002
  // checklist · 2 tasks") that opens that course's task list. A lone task keeps
  // its own row. Rows keep their order; a group sits where its first task was.
  // A group reads from all its tasks: Submitted only once every task is, Late
  // if any unticked task's date passed, otherwise Open.
  function groupTasks(items) {
    const groups = new Map();
    const rows = [];
    for (const item of items) {
      if (item.kind !== "task") { rows.push(item); continue; }
      const key = `${item.courseId}|${dayKey(item.dueAt) || "none"}`;
      if (!groups.has(key)) {
        groups.set(key, []);
        rows.push({ key, tasks: groups.get(key) });
      }
      groups.get(key).push(item);
    }
    return rows.map((row) => {
      if (!row.tasks) return row;
      if (row.tasks.length === 1) return row.tasks[0];
      const first = row.tasks[0];
      const left = row.tasks.filter((task) => !task.done);
      const lead = left.find((task) => task.status.key === "past") || left[0] || first;
      return {
        ...first, status: lead.status, done: !left.length, actionable: row.tasks.some((t) => t.actionable),
        id: `tasks:${row.key}`, title: `${first.course?.label || "Course"} checklist · ${row.tasks.length} tasks`,
        typeLabel: "Checklist tasks", route: `#/checklist/${encodeURIComponent(row.key)}`, tasks: row.tasks
      };
    });
  }

  // How many work items a list of rows stands for (a task group counts each task).
  const itemCount = (rows) => rows.reduce((sum, row) => sum + (row.tasks?.length || 1), 0);
  // Graded work first, then a course's checklist tasks one row per day.
  const nextRows = (items, limit) => groupTasks(gradedFirst(items)).slice(0, limit);

  // "Did I miss anything?": graded work (it has points) that isn't turned in and
  // is past due, or closes within 3 days. Checklist tasks never count, and
  // neither does work the student hid or a date the model only guessed.
  function needsAttention(item, now) {
    if (item.hidden || item.done || item.inferred || (!item.points && item.kind !== "task")) return false;
    const due = item.hasDueDate ? time(item.dueAt) : NaN;
    const closes = time(item.closesAt || item.dueAt);
    return (Number.isFinite(due) && due < now) || (Number.isFinite(closes) && closes < now + 3 * DAY_MS);
  }

  // Things the student can still act on: open, not done, due from now on, or
  // past due while D2L still accepts it.
  function upcomingWork(index, courseId = "", checklistDone = {}, hiddenWork = {}) {
    const now = index.now.getTime();
    return withHiddenState(withChecklistState(allWork(index), checklistDone), hiddenWork)
      .filter((item) => (!courseId || item.courseId === courseId) && !item.hidden && (item.actionable || item.status.key === "notOpen"))
      .filter((item) => {
        const due = time(item.dueAt);
        return (Number.isFinite(due) && due >= now) || (isLate(item) && item.kind !== "task");
      }).sort(byDue);
  }

  // Week headings for the work list. Weeks start on Sunday, like D2L's calendar.
  function weekGroup(value, now, tab) {
    const at = time(value);
    if (!Number.isFinite(at)) return "No due date";
    const thisWeek = startOfDay(now);
    thisWeek.setDate(thisWeek.getDate() - thisWeek.getDay());
    const shift = (days) => { const date = new Date(thisWeek); date.setDate(date.getDate() + days); return date.getTime(); };
    if (at < thisWeek.getTime()) return tab === "upcoming" ? "Past due" : at >= shift(-7) ? "Last week" : "Earlier";
    if (at < shift(7)) return "This week";
    if (at < shift(14)) return "Next week";
    return "Later";
  }

  // ------------------------------------------------------------ work lists

  function workListModel(index, params = {}, checklistDone = {}, hiddenWork = {}) {
    const tab = ["upcoming", "attention", "done", "all"].includes(params.tab) ? params.tab : "upcoming";
    const type = ["assignment", "quiz", "discussion", "task"].includes(params.type) ? params.type : "all";
    const courseId = index.courseById.has(params.course) ? params.course : "all";
    const now = index.now.getTime();
    const all = withHiddenState(withChecklistState(allWork(index), checklistDone), hiddenWork);
    const upcomingIds = new Set(upcomingWork(index, "", checklistDone, hiddenWork).map((item) => item.id));
    const inTabNamed = (name, item) => name === "all" || (name === "upcoming" ? upcomingIds.has(item.id) : name === "attention" ? needsAttention(item, now) : item.done);
    const inTab = (item) => inTabNamed(tab, item);
    const sorted = all
      .filter(inTab)
      .filter((item) => type === "all" || item.kind === type)
      .filter((item) => courseId === "all" || item.courseId === courseId)
      .sort(tab === "done" ? (a, b) => byDue(b, a) : byDue)
      .map((item) => ({ ...item, week: weekGroup(item.dueAt || item.opensAt, index.now, tab) }));
    // Weeks stay in date order; inside a week, graded work comes before
    // checklist tasks, which share one row per course per day.
    const weekRank = new Map();
    for (const item of sorted) if (!weekRank.has(item.week)) weekRank.set(item.week, item.week === "No due date" ? 1e9 : weekRank.size);
    sorted.sort((a, b) => weekRank.get(a.week) - weekRank.get(b.week) || (a.kind === "task") - (b.kind === "task"));
    const rows = (type === "task" ? sorted : groupTasks(sorted))
      .map((item) => ({ ...item, parts: dateParts(item.dueAt || item.opensAt), count: countdownFor(item, index.now), rel: item.dueAt ? relativeDay(item.dueAt, index.now) : "", dueLine: dueLine(item, index.now), due: dueFull(item, index.now) }));
    const count = (tabName) => all.filter((item) => inTabNamed(tabName, item))
      .filter((item) => type === "all" || item.kind === type)
      .filter((item) => courseId === "all" || item.courseId === courseId).length;
    const kinds = ["assignment", "quiz", "discussion", "task"].filter((kind) => all.some((item) => item.kind === kind));
    const counts = { upcoming: count("upcoming"), attention: count("attention"), done: count("done"), all: count("all") };
    const typeChips = [{ key: "all", label: "All types" }, ...kinds.map((k) => ({ key: k, label: KIND_PLURALS[k] }))];
    const courseChips = [{ key: "all", label: "All courses" }, ...index.courses.map((c) => ({ key: c.courseId, label: c.label }))];
    const emptyText = tab === "upcoming" ? "Nothing to do right now in these filters." : tab === "attention" ? "Nothing late, and nothing unsubmitted closes in the next 3 days." : tab === "done" ? "Nothing submitted or graded yet in these filters." : "No work in these filters.";
    return { tab, type, courseId, rows, counts, typeChips, courseChips, emptyText, now };
  }


  Object.assign(dash, {
    isGradedGrade, gradeLabel, realDue, status, discussionProgress, missingStep, linkedTask, workItem, allWork, withChecklistState, withHiddenState, countdownFor, byDue, gradedFirst, groupTasks, itemCount, nextRows, needsAttention, upcomingWork, weekGroup, workListModel
  });
})(globalThis);
