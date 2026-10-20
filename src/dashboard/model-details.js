// Detail records and to-do steps for assignments, quizzes, discussions and tasks.
(function initDashboardModelDetails(global) {
  const dash = global.D2LDashboard ||= {};
  const { D2L_ORIGIN, allWork, byDue, dayKey, discussionProgress, fmtBytes, fmtDate, fmtDateTime, fmtPoints, gradeLabel, isGradedGrade, plainText, plural, realDue, relativeDay, routeFor, status, time, workItem } = dash;
  // ------------------------------------------------------------ detail pages

  function evidenceOf(bundle, source) {
    return (bundle?.evidence || []).filter((record) => record.source === source);
  }

  // Page-probe rows keep the whole page (menus included) as evidence; screens
  // show the API's own record when there is one.
  function fromApi(record) {
    return record?.provenance?.pageType === "valenceApi";
  }

  function fileFrom(record) {
    return {
      name: record.title || record.fields?.suggestedFileName || "File",
      size: fmtBytes(record.fields?.columns?.size),
      localPath: record.local?.filePath || "",
      downloadUrl: record.urls?.download || "",
      url: record.urls?.download || record.urls?.item || ""
    };
  }

  function quizRequiresLockdown(...values) {
    const sentences = values.filter(Boolean).join(". ").split(/(?<=[.!?])\s+/);
    return sentences.some((sentence) => {
      if (!/(?:respondus\s+)?lock[- ]?down\s+browser/i.test(sentence)) return false;
      if (/\b(?:not|isn't|is not|will not|won't)\s+(?:be\s+)?required\b/i.test(sentence)) return false;
      return /\b(?:requires?|required|must|needs?)\b/i.test(sentence);
    });
  }

  // A quiz description that only repeats D2L's own time limit and attempts
  // ("Once you begin you will have 15 minutes and 1 attempt.") says nothing
  // the to-do step doesn't. One with a different number, or anything else,
  // is kept.
  const QUIZ_SETTINGS_SENTENCE = /^(?:once you (?:start|begin),?\s+)?you(?:'ll| will)? have (\d+) minutes?(?: to complete the (?:quiz|test|exam))?(?:,? and (?:only )?(\d+) attempts?)?(?: once you (?:start|begin))?[.!]?$/i;
  const QUIZ_FILLER = /^(?:good luck|time yourself accordingly)[.!]*$/i;
  function onlyRepeatsSettings(text, minutes, allowed) {
    const sentences = String(text || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    let repeats = false;
    for (const sentence of sentences) {
      if (QUIZ_FILLER.test(sentence)) continue;
      const match = sentence.match(QUIZ_SETTINGS_SENTENCE);
      if (!match || Number(match[1]) !== minutes || (match[2] && Number(match[2]) !== allowed)) return false;
      repeats = true;
    }
    return repeats;
  }

  // ------------------------------------------------------------ to-do steps

  // A work screen's to-do card lists what the work takes, one step per row.
  // A step is done, todo, late, missed, closed (it closed and D2L doesn't
  // show whether you did it) or tick (a checklist box you tick yourself).
  // Steps follow the same status the lists use, so a screen and its row agree.
  function step(state, what, when = "", extra = {}) {
    return { state, what, when, note: "", ...extra };
  }

  const lowerFirst = (text) => text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : "";

  // "Due Sun, Oct 25 · 11:00 AM · in 15 days", "Was due … · closes …", "No due date".
  function dueWhen(item, now) {
    const at = (value) => fmtDateTime(value, now);
    if (!item.dueAt) return "No due date";
    if (!item.hasDueDate) return `Closes ${at(item.closesAt)} · ${lowerFirst(relativeDay(item.closesAt, now))}`;
    if (time(item.dueAt) < now.getTime()) return `Was due${item.lesson ? ` with ${item.lesson} ·` : ""} ${at(item.dueAt)}${item.closesAt && time(item.closesAt) > now.getTime() ? ` · closes ${at(item.closesAt)}` : ""}`;
    return `Due${item.lesson ? ` with ${item.lesson} ·` : ""} ${at(item.dueAt)} · ${lowerFirst(relativeDay(item.dueAt, now))}`;
  }

  // A step that isn't done: when it opens, when it's due, how late it is, or
  // that it closed. A closed step is missed only when D2L shows you didn't
  // do it (`known`). Quizzes are never late: D2L takes them until they close.
  function pendingStep(what, item, now, { known = true, takes = "it", missedText = "" } = {}) {
    const at = (value) => fmtDateTime(value, now);
    const t = now.getTime();
    if (item.status.key === "notOpen" && item.opensAt) return step("todo", what, `Opens ${at(item.opensAt)}`);
    if (item.closesAt && time(item.closesAt) < t) return known ? step("missed", what, `Missed: it closed ${at(item.closesAt)}${missedText}.`) : step("closed", what, `Closed ${at(item.closesAt)}`);
    if (item.kind !== "quiz" && item.hasDueDate && time(item.dueAt) < t) return step("late", what, `Late: was due ${at(item.dueAt)}. ${item.closesAt ? `D2L takes ${takes} until ${at(item.closesAt)}.` : `D2L still takes ${takes}.`}`);
    return step("todo", what, dueWhen(item, now));
  }

  // The work's deadline as a fact: Due or Was due, else Closes or Closed
  // when D2L only has a close date.
  function deadlineFact(item, now) {
    const past = (value) => time(value) < now.getTime();
    if (item.hasDueDate) return { k: past(item.dueAt) ? "Was due" : "Due", v: `${fmtDateTime(item.dueAt, now)}${item.lesson ? ` · with ${item.lesson}` : ""}` };
    if (item.closesAt) return { k: past(item.closesAt) ? "Closed" : "Closes", v: fmtDateTime(item.closesAt, now) };
    return { k: "Due", v: "No due date" };
  }

  // A date fact that changes tense once it passes: Opens or Opened.
  function datedFact(label, pastLabel, value, now) {
    return value ? { k: time(value) < now.getTime() ? pastLabel : label, v: fmtDateTime(value, now) } : null;
  }

  // A close date that isn't the due date, for work that takes late turn-ins.
  function closesFact(item, now) {
    return item.hasDueDate && item.closesAt && time(item.closesAt) !== time(item.dueAt) ? datedFact("Closes", "Closed", item.closesAt, now) : null;
  }

  // "Task 8" says nothing; its description does ("Reply to another student").
  // The description's first clause becomes the title, and the checklist's own
  // name for it stays in the gray line above.
  function taskTitle(entity) {
    const text = plainText(entity.description || "").trim();
    if (!/^task\s*\d+$/i.test(entity.canonicalTitle || "") || !text) return entity.canonicalTitle;
    const first = text.split(/(?<=[.!?])\s+|;\s*/)[0].replace(/[\s.;:,]+$/, "");
    return first.length > 90 ? `${first.slice(0, 90).replace(/\s+\S*$/, "")}…` : first;
  }

  // What a linked checklist task asks of its discussion.
  function linkedWhat(link) {
    const count = link.needed > 1 ? ` (${Math.min(link.replies, link.needed)} of ${link.needed})` : "";
    if (link.role === "thread") return "Start your own thread";
    if (link.role === "reply") return link.needed > 1 ? `Reply to ${link.needed} classmates' threads${count}` : "Reply to a classmate's thread";
    return link.needed > 1 ? `Post a thread and reply to ${link.needed} classmates${count}` : "Post a thread and reply to a classmate";
  }

  // A checklist task's step. One linked to a discussion follows your D2L
  // posts; any other (or one whose topic D2L still hides) is a box you tick
  // yourself. In a checklist's list (`what` set) the due date shows once at
  // the top, so steps that aren't late leave it out.
  function taskStep(index, task, what = "") {
    const now = index.now;
    const link = task.linked;
    const past = task.dueAt && time(task.dueAt) < now.getTime();
    const due = !task.dueAt ? "No due date" : past ? `Was due ${fmtDateTime(task.dueAt, now)}` : `Due ${fmtDateTime(task.dueAt, now)} · ${lowerFirst(relativeDay(task.dueAt, now))}`;
    if (!link?.known) return step("tick", what || "Check this off when it's done", what ? "" : due, { taskId: task.id, linked: link || null });
    const label = what || linkedWhat(link);
    if (link.done) return step("done", label, "Done on D2L", { linked: link });
    const closes = index.byId.get(link.discussionId)?.dates?.availableUntil;
    if (closes && time(closes) < now.getTime()) return step("missed", label, `Missed: the discussion closed ${fmtDateTime(closes, now)}.`, { linked: link });
    if (past) return step("late", label, `Late: was due ${fmtDateTime(task.dueAt, now)}.`, { linked: link });
    return step("todo", label, what ? "" : due, { linked: link });
  }

  function assignmentModel(index, entity, bundle) {
    const item = workItem(index, entity);
    const archivedFiles = evidenceOf(bundle, "assignmentAttachment").map(fileFrom);
    const files = entity.attachments?.length
      ? entity.attachments.map((file) => {
        const archived = archivedFiles.find((candidate) => candidate.name === file.name);
        return { name: file.name, size: fmtBytes(file.size), localPath: archived?.localPath || "", url: archived?.url || "", downloadUrl: archived?.downloadUrl || "" };
      })
      : archivedFiles;
    const submissions = evidenceOf(bundle, "assignmentSubmission")
      .filter(fromApi)
      .flatMap((record) => Array.isArray(record.fields?.columns?.submissions) && record.fields.columns.submissions.length
        ? record.fields.columns.submissions.map((entry) => ({ ...record, dates: { submittedAt: entry.submittedAt }, fields: { columns: { fileCount: entry.fileCount } } }))
        : [record])
      .map((record) => ({
        at: record.dates?.submittedAt || record.fields?.columns?.submittedAt || null,
        when: fmtDateTime(record.dates?.submittedAt || record.fields?.columns?.submittedAt, index.now),
        files: Number(record.fields?.columns?.fileCount || 0)
      }))
      .sort((a, b) => time(b.at) - time(a.at));
    const submittedFiles = evidenceOf(bundle, "submittedFile").filter(fromApi).map(fileFrom);
    const feedback = evidenceOf(bundle, "assignmentFeedback").filter(fromApi).map((record) => ({
      text: plainText(record.description || ""),
      score: fmtPoints(record.fields?.columns?.score, record.fields?.columns?.outOf)
    })).filter((entry) => entry.text || entry.score);
    const grade = entity.gradeEntityId ? index.byId.get(entity.gradeEntityId) : null;
    const graded = item.status.key === "graded";
    const turnedIn = submissions[0]?.at || entity.dates?.submittedAt || null;
    const turnIn = item.done
      ? step("done", "Submission", turnedIn ? `Turned in${item.status.key === "late" ? " late," : ""} ${fmtDate(turnedIn, index.now)}` : graded && !entity.submissionCount ? "" : "Turned in")
      : pendingStep("Submission", item, index.now);
    if (!item.done && entity.groupTypeId) turnIn.note = "A group assignment: turn it in on D2L.";
    return {
      kind: "assignment",
      item,
      course: item.course,
      title: entity.canonicalTitle,
      meta: ["Assignment", entity.category || ""].filter(Boolean),
      facts: [deadlineFact(item, index.now), datedFact("Opens", "Opened", item.opensAt, index.now), item.points ? { k: "Worth", v: item.points } : null, closesFact(item, index.now)].filter(Boolean).slice(0, 3),
      steps: [turnIn, graded ? step("done", "Graded") : null].filter(Boolean),
      instructions: plainText(entity.summary || ""),
      files,
      rubric: entity.rubric || null,
      rubricNote: !entity.rubric && entity.rubricCount > 0 ? `${plural(entity.rubricCount, "rubric")} attached in D2L` : "",
      submissions,
      submittedFiles,
      feedback,
      score: item.score,
      grade: grade && isGradedGrade(grade) ? { route: routeFor(grade), displayed: grade.grade?.displayed || "" } : null,
      links: [
        { label: "Open assignment in D2L", url: entity.urls?.d2l, primary: true },
        item.done ? { label: "Submission history", url: entity.urls?.history } : null,
        entity.feedbackCount ? { label: "Feedback in D2L", url: entity.urls?.feedback } : null
      ].filter((link) => link?.url)
    };
  }

  function quizModel(index, entity, bundle) {
    const item = workItem(index, entity);
    const grade = entity.gradeEntityId ? index.byId.get(entity.gradeEntityId) : null;
    const attempts = entity.attempts || {};
    const allowed = attempts.unlimited ? "unlimited" : attempts.allowed ?? null;
    const known = Boolean(attempts.source && attempts.source !== "none");
    const graded = isGradedGrade(grade);
    const summary = evidenceOf(bundle, "quizSummaryRow")[0];
    const lockdown = quizRequiresLockdown(
      entity.canonicalTitle,
      entity.description,
      ...(entity.aliases || []),
      summary?.description
    );
    // "Take the quiz (15 min, 1 attempt)": the step carries the quiz's rules.
    const rules = [
      entity.timeLimitMinutes ? `${entity.timeLimitMinutes} min` : "no time limit",
      attempts.unlimited ? "unlimited attempts" : attempts.allowed != null ? plural(attempts.allowed, "attempt") : ""
    ].filter(Boolean);
    const what = `Quiz (${rules.join(", ")})`;
    const take = attempts.completed > 0 ? step("done", what, `${attempts.completed} of ${allowed ?? "?"} used`)
      : graded ? step("done", what)
        : pendingStep(what, item, index.now, { known, missedText: " before you started it" });
    take.note = lockdown ? "Needs LockDown Browser. Open this quiz from the Respondus LockDown Browser application."
      : !known && entity.access?.attempts === "blocked" ? "D2L hides your attempts from the extension; the next sync reads them from the Quiz List page." : "";
    const description = plainText(entity.description || "");
    const repeatsSettings = onlyRepeatsSettings(description, entity.timeLimitMinutes, attempts.allowed);
    return {
      kind: "quiz",
      item,
      course: item.course,
      title: entity.canonicalTitle,
      facts: [datedFact("Opens", "Opened", item.opensAt, index.now), deadlineFact(item, index.now), item.points ? { k: "Worth", v: item.points } : null, closesFact(item, index.now)].filter(Boolean).slice(0, 3),
      steps: [take, graded ? step("done", "Graded", [gradeLabel(grade), grade.grade?.displayed].filter(Boolean).join(" · ")) : null].filter(Boolean),
      description: repeatsSettings ? "" : description,
      repeatsSettings,
      summaryText: summary?.description || "",
      lockdown,
      grade: graded ? { route: routeFor(grade) } : null,
      links: [
        { label: "Open quiz in D2L", url: entity.urls?.d2l, primary: item.status.key === "open" },
        (graded || attempts.completed > 0) ? { label: "View quiz attempts", url: entity.urls?.submissions } : null
      ].filter((link) => link?.url)
    };
  }

  function discussionModel(index, entity, bundle) {
    const item = workItem(index, entity);
    const grade = entity.gradeEntityId ? index.byId.get(entity.gradeEntityId) : null;
    const posts = evidenceOf(bundle, "discussionPost")
      .map((record) => ({ id: record.platformIds?.postId || "", parentPostId: record.fields?.columns?.parentPostId || "", subject: record.title, author: record.fields?.columns?.author || "", at: record.fields?.columns?.createdDate || null, mine: record.fields?.columns?.isMine === true, text: plainText(record.description || "") }))
      .sort((a, b) => time(b.at) - time(a.at));
    const mine = posts.filter((post) => post.mine);
    const postsKnown = entity.access?.posts === "available";
    const link = index.checklistLinks?.byDiscussion.get(entity.entityId) || null;
    const progress = discussionProgress(index, entity);
    const graded = isGradedGrade(grade);
    const oldest = (list) => [...list].sort((a, b) => time(a.at) - time(b.at));
    const firstThread = oldest(mine.filter((post) => !post.parentPostId))[0];
    const enoughReplies = oldest(mine.filter((post) => post.parentPostId))[progress.needed - 1];
    // A graded topic whose posts D2L hides counts as done; otherwise a step
    // waits on its dates like any other work.
    const pending = (what, takes) => progress.graded && !postsKnown ? step("done", what) : pendingStep(what, item, index.now, { known: postsKnown, takes });
    const thread = progress.hasThread
      ? step("done", "Start your own thread", firstThread?.at ? `Posted ${fmtDate(firstThread.at, index.now)}` : "Posted")
      : pending("Start your own thread", "posts");
    if (!progress.hasThread && entity.gate === "mustPostFirst") thread.note = "D2L shows classmates' posts after you start a thread.";
    const replyWhat = progress.needed > 1 ? `Reply to ${progress.needed} classmates' threads${postsKnown ? ` (${Math.min(progress.replies, progress.needed)} of ${progress.needed})` : ""}` : "Reply to a classmate's thread";
    const reply = progress.replies >= progress.needed
      ? step("done", replyWhat, enoughReplies?.at ? `Replied ${fmtDate(enoughReplies.at, index.now)}` : "Replied")
      : pending(replyWhat, "replies");
    const score = graded ? [gradeLabel(grade), grade.grade?.displayed].filter(Boolean).join(" · ") : fmtPoints(entity.grading?.pointsEarned, entity.grading?.pointsPossible);
    return {
      kind: "discussion",
      item,
      course: item.course,
      title: entity.canonicalTitle,
      forum: entity.forumTitle || "",
      facts: [
        item.status.key === "notOpen" ? datedFact("Opens", "Opened", item.opensAt, index.now) : null,
        item.hasDueDate ? deadlineFact(item, index.now) : null,
        datedFact("Closes", "Closed", item.closesAt, index.now),
        item.points ? { k: "Worth", v: item.points } : null,
        link ? { k: "Checklist", v: link.checklist } : null
      ].filter(Boolean).slice(0, 3),
      steps: [thread, reply, progress.graded ? step("done", "Graded", score) : null].filter(Boolean),
      prompt: plainText(entity.prompt || entity.forumDescription || ""),
      myPosts: mine.slice(0, 5),
      recentPosts: posts.slice(0, 5),
      allPosts: posts,
      rubric: entity.rubric || null,
      grade: graded ? { route: routeFor(grade) } : null,
      links: [{ label: "Open discussion in D2L", url: entity.urls?.d2l, primary: true }].filter((link) => link.url)
    };
  }

  function taskModel(index, entity) {
    const item = workItem(index, entity);
    const title = taskTitle(entity);
    const description = plainText(entity.description || "");
    const same = (a, b) => a.replace(/[\s.;:,!]+$/, "") === b.replace(/[\s.;:,!]+$/, "");
    return {
      kind: "task",
      item,
      course: item.course,
      title,
      meta: [entity.category || "Checklist task", title !== entity.canonicalTitle ? entity.canonicalTitle : ""].filter(Boolean),
      facts: [
        item.dueAt ? datedFact("Due", "Was due", item.dueAt, index.now) : { k: "Due", v: "No due date" },
        entity.category ? { k: "Checklist", v: entity.category } : null,
        item.linked ? { k: "Discussion", v: item.linked.title } : null
      ].filter(Boolean),
      steps: [taskStep(index, item)],
      description: description && !same(description, title) ? description : "",
      goTo: item.linked ? { label: "Open discussion", route: item.linked.route } : null,
      links: [{ label: "Open checklist in D2L", url: item.d2lUrl }].filter((link) => link.url)
    };
  }

  // A course's checklist tasks due on one day. The list is the page: each
  // task is a step, and the due date shows once in the gray line.
  function checklistModel(index, key) {
    const [courseId, dueDay = "none"] = String(key || "").split("|");
    const tasks = allWork(index)
      .filter((item) => item.kind === "task" && item.courseId === courseId && (dayKey(item.dueAt) || "none") === dueDay)
      .sort(byDue);
    if (!tasks.length) return null;
    const first = tasks[0];
    const checklists = [...new Set(tasks.map((task) => task.entity.category).filter(Boolean))];
    return {
      kind: "checklist",
      course: first.course,
      title: checklists.length === 1 ? checklists[0] : `${first.course?.label || "Course"} checklist`,
      meta: ["Checklist", first.dueAt ? `due ${fmtDateTime(first.dueAt, index.now)}` : "no due date"],
      groupLabel: tasks.length > 1 ? `${tasks.length} checklist tasks` : "Checklist task",
      tasks,
      facts: [],
      steps: tasks.map((task) => taskStep(index, task, taskTitle(task.entity))),
      links: [...new Map(tasks.map((task) => [task.d2lUrl, task.d2lUrl])).keys()].filter(Boolean).slice(0, 1).map((url) => ({ label: "Open checklist in D2L", url }))
    };
  }

  function announcementModel(index, entity, bundle) {
    const course = index.courseById.get(entity.courseId);
    return {
      kind: "announcement",
      course,
      title: entity.canonicalTitle,
      posted: entity.dates?.publishedAt ? `Posted ${fmtDateTime(entity.dates.publishedAt, index.now)}` : "",
      body: plainText(entity.body || ""),
      pinned: entity.isPinned === true,
      attachments: evidenceOf(bundle, "announcementAttachment").map(fileFrom),
      links: [{ label: "View in D2L", url: entity.urls?.d2l || `${D2L_ORIGIN}/d2l/le/news/${entity.courseId}/${entity.entityId.split(":").at(-1)}/view?ou=${entity.courseId}`, primary: true }]
    };
  }

  function eventModel(index, entity) {
    const course = index.courseById.get(entity.courseId);
    const at = entity.dates?.startAt || entity.dates?.dueAt;
    return {
      kind: "event",
      course,
      title: entity.eventLabel ? `${entity.canonicalTitle} - ${entity.eventLabel}` : entity.canonicalTitle,
      facts: [
        { k: "When", v: at ? fmtDateTime(at, index.now) : "No date" },
        entity.dates?.endAt && time(entity.dates.endAt) !== time(at) ? { k: "Ends", v: fmtDateTime(entity.dates.endAt, index.now) } : null
      ].filter(Boolean),
      description: entity.description || "",
      // "Belongs to" links only to items that have a screen (a whole discussion
      // forum has none; an empty link would reload the dashboard).
      target: routeFor(index.byId.get(entity.targetEntityId)) ? { route: routeFor(index.byId.get(entity.targetEntityId)), title: index.byId.get(entity.targetEntityId).canonicalTitle } : null,
      // Archives made before 0.8.162 lack the event's detail-page URL; the
      // course calendar is then the closest D2L page.
      links: [entity.urls?.d2l
        ? { label: "Open event in D2L", url: entity.urls.d2l, primary: true }
        : { label: "Open calendar in D2L", url: `${D2L_ORIGIN}/d2l/le/calendar/${entity.courseId}`, primary: true, approximate: true }]
    };
  }


  Object.assign(dash, {
    evidenceOf, fromApi, fileFrom, quizRequiresLockdown, onlyRepeatsSettings, step, dueWhen, pendingStep, deadlineFact, datedFact, closesFact, taskTitle, linkedWhat, taskStep, assignmentModel, quizModel, discussionModel, taskModel, checklistModel, announcementModel, eventModel, QUIZ_SETTINGS_SENTENCE, QUIZ_FILLER, lowerFirst
  });
})(globalThis);
