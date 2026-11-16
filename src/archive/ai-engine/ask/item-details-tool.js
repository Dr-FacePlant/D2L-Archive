// item_details: everything the archive holds about one item, found by its name: its
// times and status, points and grade, a quiz's time limit and attempts, the
// instructions, its files (with the text read from them) and a link. It reads the same model as the item's pop-up
// (model-details.js), so Ask and the screen agree, and it says what isn't saved.
(function initDashboardAskItemDetailsTool(global) {
  const dash = global.D2LDashboard ||= {};
  const { askTime, plainText, plural, routeFor, ROUTE_BY_TYPE } = dash;

  const TEXT_CHARS = 1500;
  const FEEDBACK_CHARS = 600;
  const MAX_FILES = 8;
  // Files whose text is shown, each cut to TEXT_CHARS; search_archive finds the rest.
  const MAX_FILE_TEXTS = 3;
  const MAX_OTHERS = 5;
  // When several items share a name, the work itself comes before a calendar entry, a file or its grade.
  const KINDS = ["assignment", "quiz", "discussion", "task", "event", "announcement", "resource", "grade"];
  const KIND_NAMES = { assignment: "Assignment", quiz: "Quiz", discussion: "Discussion", task: "Checklist task", event: "Calendar event", announcement: "Announcement", resource: "Course content", grade: "Grade" };
  const STEP_WORDS = { done: "done", todo: "to do", late: "late", missed: "missed", closed: "closed", tick: "the student ticks it off" };
  // Why a file's text isn't shown, by what reading it found (ask/file-text-reader.js).
  const FILE_NOTES = {
    scan: () => "a scan; can't be read yet",
    empty: () => "has no text",
    "too-large": () => "over 15 MB; not read",
    unsupported: (record) => (record.what && record.what !== "file" ? `a ${record.what}; can't be read` : "this kind of file can't be read"),
    unavailable: () => "D2L didn't hand it over",
    failed: () => "couldn't be read",
    read: () => "too many files to show its text; search_archive finds it"
  };

  const ITEM_DETAILS_TOOL = Object.freeze({
    type: "function",
    function: {
      name: "item_details",
      description: "Everything saved about one assignment, quiz, discussion, announcement, calendar event, grade or course file, found by its name: due and opens times, status, points, grade, time limit, attempts, instructions, attached files with their text, and a link.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The item's name, like Lab 4 or Quiz 3" },
          course: { type: "string", description: "Optional course name, like CS 1301" }
        },
        required: ["title"]
      }
    }
  });

  const words = (value) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const cut = (text, chars) => (text.length > chars ? `${text.slice(0, chars - 1).trimEnd()}…` : text);
  const clip = (value, chars) => cut(plainText(value || "").replace(/\s+/g, " ").trim(), chars);
  // A file's text is plain already: a "<" in it is not the start of a tag.
  const clipPlain = (value, chars) => cut(String(value || "").replace(/\s+/g, " ").trim(), chars);
  const kindOf = (entity) => ROUTE_BY_TYPE[entity?.entityType] || "";
  const orList = (list) => list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0];

  // Items Ask can describe, in the courses on the dashboard. A module only holds other items. Of a
  // course's tools, only checklist items are tasks: its pages, surveys and groups have no task to show.
  function candidates(index, courseId) {
    return index.entities.filter((entity) => KINDS.includes(kindOf(entity)) && !entity.isModule
      && !(entity.entityType === "courseToolItem" && entity.toolType !== "checklistItem")
      && index.visible.has(String(entity.courseId)) && (!courseId || String(entity.courseId) === courseId));
  }

  // How a name matches, by whole words in order. 3: the same words. 2: the words are in its
  // name ("quiz 3" in "Quiz 3 (Ch. 5)", not in "Quiz 30"). 1: its name is in the words ("Lab 4" in "lab 4 instructions").
  // A task is also named with its checklist, as Upcoming shows it: "Checklist 11 · Read chapter 11".
  function nameMatch(entity, wanted) {
    const listed = kindOf(entity) === "task" && entity.category ? `${entity.category} ${entity.canonicalTitle}` : "";
    const names = [entity.canonicalTitle, entity.displayName, listed].map(words).filter(Boolean);
    if (names.includes(wanted)) return 3;
    if (names.some((name) => ` ${name} `.includes(` ${wanted} `))) return 2;
    return names.some((name) => ` ${wanted} `.includes(` ${name} `)) ? 1 : 0;
  }

  // The items called that, best first; else the archive search's guesses that hold at least
  // half the name's words (close: false). A calendar entry stands for the item it is for.
  function findItems(ctx, title, courseId) {
    const wanted = words(title);
    const pool = candidates(ctx.index, courseId);
    const ids = new Set(pool.map((entity) => entity.entityId));
    const itemOf = (entity) => (kindOf(entity) === "event" && ids.has(entity.targetEntityId) ? ctx.index.byId.get(entity.targetEntityId) : entity);
    const rank = (entity) => KINDS.indexOf(kindOf(entity));
    for (const level of [3, 2, 1]) {
      // Of names inside the words, the longest is meant: "Lab 4", not "Lab".
      const found = pool.filter((entity) => nameMatch(entity, wanted) === level)
        .sort((a, b) => (level === 1 ? words(b.canonicalTitle).length - words(a.canonicalTitle).length : 0) || rank(a) - rank(b));
      if (found.length) return { found: [...new Set(found.map(itemOf))], close: true };
    }
    const terms = [...new Set(dash.passageTokens(title))];
    const holds = (hit) => {
      const counts = ctx.passageIndex.passages.find((passage) => passage.id === hit.id)?.counts;
      return terms.filter((term) => counts?.has(term)).length * 2 >= terms.length;
    };
    const hits = ctx.passageIndex ? dash.searchPassages(ctx.passageIndex, title, { courseId, limit: 10 }).results.filter(holds) : [];
    const found = hits.map((hit) => hit.entityId).filter((id) => ids.has(id)).map((id) => itemOf(ctx.index.byId.get(id)));
    return { found: [...new Set(found)], close: false };
  }

  // Each file by name, with its text when it was read, or why not. texts: what was read, by address.
  function fileList(files, texts) {
    let shown = 0;
    const one = (file) => {
      const name = file.size ? `${file.name} (${file.size})` : file.name;
      const record = file.downloadUrl ? texts?.get(file.downloadUrl) : null;
      if (record?.state === "read" && shown < MAX_FILE_TEXTS) {
        shown += 1;
        return { name, text: clipPlain(record.text, TEXT_CHARS) };
      }
      return FILE_NOTES[record?.state] ? { name, note: FILE_NOTES[record.state](record) } : name;
    };
    return [...files.slice(0, MAX_FILES).map(one), ...(files.length > MAX_FILES ? [`and ${files.length - MAX_FILES} more`] : [])];
  }
  const stepList = (steps) => steps.map((one) => `${one.what}: ${STEP_WORDS[one.state] || one.state}`);

  // What one kind of item adds. text(key, value, label) keeps a text, or notes that it isn't saved;
  // files(list) names files with their text.
  const KIND_FACTS = {
    assignment(out, { model, entity, now, text, files }) {
      if (entity.category) out.category = entity.category;
      text("instructions", model.instructions, "instructions");
      if (model.files.length) out.files = files(model.files);
      if (model.rubric || model.rubricNote) out.rubric = model.rubricNote || "A rubric is attached in D2L";
      if (model.submissions[0]?.at) out.turned_in = askTime(model.submissions[0].at, now);
      const feedback = model.feedback.map((one) => one.text).find(Boolean);
      if (feedback) out.feedback = clip(feedback, FEEDBACK_CHARS);
    },
    quiz(out, { model, entity, missing, text }) {
      const attempts = entity.attempts || {};
      if (entity.timeLimitMinutes) out.time_limit = plural(entity.timeLimitMinutes, "minute");
      else missing.push("time limit");
      if (attempts.unlimited) out.attempts = "Unlimited";
      else if (attempts.allowed != null) out.attempts = `${plural(attempts.allowed, "attempt")} allowed${attempts.completed ? `, ${attempts.completed} used` : ""}`;
      else missing.push("number of attempts");
      if (model.lockdown) out.lockdown_browser = "Required: open it from the Respondus LockDown Browser";
      text("instructions", model.description || (model.repeatsSettings ? "" : model.summaryText), model.repeatsSettings ? "" : "instructions");
    },
    discussion(out, { model, text }) {
      if (model.forum) out.forum = model.forum;
      text("instructions", model.prompt, "instructions");
      out.steps = stepList(model.steps);
    },
    task(out, { model, entity, text }) {
      if (entity.category) out.checklist = entity.category;
      text("instructions", model.description);
      out.steps = stepList(model.steps);
    },
    announcement(out, { model, entity, now, text, files }) {
      if (entity.dates?.publishedAt) out.posted = askTime(entity.dates.publishedAt, now);
      text("text", model.body, "text");
      if (model.attachments.length) out.files = files(model.attachments);
    },
    event(out, { model, text }) {
      if (model.target) out.belongs_to = model.target.title;
      text("description", model.description);
    },
    grade(out, { model, now, text }) {
      const { row } = model;
      if (model.source) out.for = `${model.source.kind}: ${model.source.title}`;
      if (row.points) out.points = row.points;
      if (row.grade) out.grade = row.grade;
      if (row.weight) out.weight_achieved = row.weight;
      if (row.gradedAt) out.graded = askTime(row.gradedAt, now);
      if (model.marks.length) out.marks = model.marks;
      if (model.feedback[0]) out.feedback = clip(model.feedback.join(" "), FEEDBACK_CHARS);
      text("description", model.description);
    },
    resource(out, { entity, text, files }) {
      if (entity.resourceType) out.type = entity.resourceType;
      if (entity.moduleTitle || entity.module) out.module = entity.moduleTitle || entity.module;
      text("description", entity.description);
      // A Content topic that is a file: what the file says.
      const [file] = entity.urls?.download ? files([{ name: entity.canonicalTitle || "File", downloadUrl: entity.urls.download }]) : [];
      if (file?.text) out.file_text = file.text;
      else if (file?.note) out.file = file.note;
    }
  };

  // The item as the model reads it: plain facts, its times in one line as search_archive gives them.
  function describe(ctx, entity, bundle) {
    const now = ctx.now;
    const kind = kindOf(entity);
    const course = ctx.index.courseById.get(entity.courseId)?.label || "";
    const model = kind === "resource" ? null : dash.detailFor({ ...ctx.index, now }, { name: kind, id: entity.entityId }, bundle);
    const item = dash.askWorkItem(ctx, entity.entityId);
    const out = { course, kind: KIND_NAMES[kind], title: model?.title || entity.canonicalTitle || "", ...dash.askItemFacts(ctx, entity) };
    if (item) Object.assign(out, item.points ? { points: item.points } : {}, item.score ? { grade: item.score } : {});
    const missing = [];
    const text = (key, value, label = "") => {
      const clean = clip(value, TEXT_CHARS);
      if (clean) out[key] = clean;
      else if (label) missing.push(label);
    };
    KIND_FACTS[kind](out, { model: model || {}, entity, now, missing, text, files: (list) => fileList(list, ctx.fileTexts) });
    const link = model?.links?.find((one) => one.primary)?.url || model?.links?.[0]?.url || entity.urls?.d2l || entity.urls?.item || "";
    if (link) out.link = link;
    if (missing.length) out.not_saved = `The archive has no saved ${orList(missing)} for it.`;
    return out;
  }

  // ctx as for the other tools, plus bundleFor(entityId): a promise of the item's saved records, or
  // nothing, and fileTexts: what was read from each course file, by its address.
  async function itemDetailsTool(ctx, args) {
    const title = String(args.title ?? "").trim();
    const course = String(args.course ?? "").trim();
    if (!title) return { result: { error: "Give the item's name." }, sources: [] };
    if (!ctx.index) return { result: { error: "The archive isn't read yet." }, sources: [] };
    const scope = course ? dash.findPassageCourse(ctx.passageIndex, { course }) : null;
    if (course && !scope) return { result: dash.askUnknownCourse(ctx.passageIndex, course), sources: [] };
    const { found, close } = findItems(ctx, title, scope?.courseId || "");
    if (!found.length) return { result: { error: `Nothing saved is called "${title}"${scope ? ` in ${scope.label}` : ""}. Try search_archive.` }, sources: [] };
    const [entity] = found;
    let bundle = null;
    try { bundle = await ctx.bundleFor?.(entity.entityId) || null; } catch { bundle = null; }
    const details = describe(ctx, entity, bundle);
    // A grade row named like the work it grades says nothing new; anything else may be what was meant.
    const others = found.slice(1)
      .filter((other) => !(kindOf(other) === "grade" && other.courseId === entity.courseId))
      .slice(0, MAX_OTHERS)
      .map((other) => `${other.canonicalTitle} (${KIND_NAMES[kindOf(other)]}, ${ctx.index.courseById.get(other.courseId)?.label || "no course"})`);
    const note = close ? "" : `Nothing is called "${title}"; this is the closest match.`;
    return {
      result: { item: details, ...(others.length ? { others } : {}), ...(note ? { note } : {}) },
      sources: [{ title: details.title, course: details.course, route: routeFor(entity) }]
    };
  }

  Object.assign(dash, { ASK_ITEM_DETAILS_TOOL: ITEM_DETAILS_TOOL, askItemDetailsTool: itemDetailsTool });
})(globalThis);
