// Ranked search over the archive's text, for questions like "when is the final
// exam?". Long text is cut into short passages, each passage is scored against
// the query's words, and the best few come back with where each one came from.
// Pure: it reads the entities, evidence, course files' text and courses it is given and nothing else.
(function initDashboardModelPassageSearch(global) {
  const dash = global.D2LDashboard ||= {};
  const { plainText, routeFor, KIND_LABELS, ROUTE_BY_TYPE } = dash;

  const CHUNK_WORDS = 90;
  const CHUNK_STEP = 70;
  const SNIPPET_CHARS = 420;
  const DEFAULT_LIMIT = 5;
  const MAX_LIMIT = 20;
  const K1 = 1.2;
  const B = 0.75;
  const TITLE_WEIGHT = 3;
  const SKIPPED_TYPES = new Set(["extractionState"]);
  const SKIPPED_SOURCES = new Set(["apiProbe"]);
  const ENTITY_TEXT_FIELDS = ["summary", "description", "body", "prompt", "instructions", "feedback"];
  const STOPWORDS = new Set("a an and are as at be been by can could did do does for from had has have how i if in is it its me my of on or our should so than that the their them there these they this to was we were what when where which who why will with would you your".split(" "));

  // A light stemmer, enough that "assignments", "graded" and "grading" meet.
  function stem(word) {
    let out = word;
    if (out.length > 4 && out.endsWith("ies")) return `${out.slice(0, -3)}y`;
    if (out.length > 5 && out.endsWith("zzes")) return out.slice(0, -3);
    if (out.length > 3 && out.endsWith("s") && !out.endsWith("ss") && !out.endsWith("us")) out = out.slice(0, -1);
    if (out.length > 5 && out.endsWith("ing")) out = out.slice(0, -3);
    else if (out.length > 4 && out.endsWith("ed")) out = out.slice(0, -2);
    if (out.length > 4 && out.endsWith("e")) out = out.slice(0, -1);
    return out;
  }

  function tokens(text) {
    return String(text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word && !STOPWORDS.has(word)).map(stem);
  }

  const clean = (value) => plainText(value).replace(/\s+/g, " ").trim();
  const squash = (value) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

  // A date on the student's own clock, searchable as a date and in words: in Georgia,
  // "2026-11-06T04:59:00Z" reads as "2026-11-05 Thursday, November 5, 2026 at 11:59 PM".
  function dateWords(iso) {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""));
    const at = new Date(dateOnly ? `${iso}T12:00` : iso);
    if (!iso || Number.isNaN(at.getTime())) return "";
    const two = (n) => String(n).padStart(2, "0");
    const day = at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const time = dateOnly ? "" : ` at ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${day}${time}`;
  }

  function chunks(text) {
    const words = text.split(" ");
    if (words.length <= CHUNK_WORDS) return text ? [text] : [];
    const out = [];
    for (let start = 0; start < words.length; start += CHUNK_STEP) {
      out.push(words.slice(start, start + CHUNK_WORDS).join(" "));
      if (start + CHUNK_WORDS >= words.length) break;
    }
    return out;
  }

  // files: the text read from course files, [{ key, courseId, title, partOf, route, text }]; partOf
  // names the item a file belongs to, so "Lab 4" finds the files of Lab 4.
  function buildPassageIndex({ entities = [], evidence = [], files = [], courses = [] } = {}) {
    const labels = new Map(courses.map((course) => [String(course.courseId), course.label || course.title || ""]));
    const passages = [];
    const seen = new Set();
    // hidden holds words that find a passage without being shown: its dates and raw status,
    // which Ask writes out itself in one style, worked out when it looks. A file's text is
    // plain already: a "<" in it is not the start of a tag.
    const add = (passage, bodyText, hidden = "", plain = false) => {
      const text = plain ? bodyText : clean(bodyText);
      const key = `${passage.courseId}|${passage.title}|${hidden}|${text}`.toLowerCase();
      if ((!text && !passage.title) || seen.has(key)) return;
      seen.add(key);
      const course = labels.get(String(passage.courseId)) || "";
      const counts = new Map();
      for (const word of [...tokens(`${course} ${passage.kind} ${hidden}`), ...tokens(text), ...Array(TITLE_WEIGHT).fill(tokens(passage.title)).flat()]) counts.set(word, (counts.get(word) || 0) + 1);
      passages.push({ ...passage, course, text, counts, length: [...counts.values()].reduce((sum, n) => sum + n, 0) });
    };

    for (const entity of entities) {
      if (!entity || SKIPPED_TYPES.has(entity.entityType)) continue;
      const kind = KIND_LABELS?.[ROUTE_BY_TYPE?.[entity.entityType]] || String(entity.entityType || "").replace(/([A-Z])/g, " $1").toLowerCase();
      const dueAt = entity.dates?.dueAt || "";
      const opensAt = entity.dates?.availableFrom || "";
      const facts = entity.grade?.displayed ? `Grade ${entity.grade.displayed}.` : "";
      const hidden = [dueAt && `due ${dateWords(dueAt)}`, opensAt && `opens ${dateWords(opensAt)}`, entity.status].filter(Boolean).join(" ");
      const base = { courseId: entity.courseId, kind, title: entity.canonicalTitle || entity.displayName || "", dueAt, opensAt, entityId: entity.entityId, route: routeFor ? routeFor(entity) : "" };
      const body = ENTITY_TEXT_FIELDS.map((field) => clean(entity[field])).filter(Boolean).join(" ");
      const pieces = chunks(body);
      if (!pieces.length) add({ ...base, id: entity.entityId }, facts, hidden);
      pieces.forEach((piece, i) => add({ ...base, id: `${entity.entityId}#${i}` }, `${i === 0 ? facts : ""} ${piece}`, i === 0 ? hidden : ""));
    }
    for (const record of evidence) {
      if (!record || SKIPPED_SOURCES.has(record.source)) continue;
      const base = { courseId: record.courseId, kind: record.source || "", title: record.title || "", dueAt: record.dates?.dueAt || "", opensAt: "", entityId: "", route: "" };
      const pieces = chunks(clean(record.description));
      if (!pieces.length) add({ ...base, id: record.evidenceId }, "");
      pieces.forEach((piece, i) => add({ ...base, id: `${record.evidenceId}#${i}` }, piece));
    }
    for (const file of files) {
      const base = { courseId: file.courseId, kind: "File", title: file.title || "", partOf: file.partOf || "", dueAt: "", opensAt: "", entityId: "", route: file.route || "" };
      chunks(String(file.text ?? "").replace(/\s+/g, " ").trim()).forEach((piece, i) => add({ ...base, id: `file:${file.key}#${i}` }, piece, base.partOf, true));
    }

    const df = new Map();
    for (const passage of passages) for (const word of passage.counts.keys()) df.set(word, (df.get(word) || 0) + 1);
    const avgLength = passages.length ? passages.reduce((sum, p) => sum + p.length, 0) / passages.length : 1;
    return { passages, df, avgLength, courses: [...labels].map(([courseId, label]) => ({ courseId, label })) };
  }

  // Looks a course up by id or by its name, ignoring case and spaces ("cs1301").
  function findCourse(index, { courseId, course } = {}) {
    if (courseId) return index.courses.find((one) => one.courseId === String(courseId)) || null;
    const wanted = squash(course);
    if (!wanted) return null;
    return index.courses.find((one) => {
      const label = squash(one.label);
      return label && (label.includes(wanted) || wanted.includes(label));
    }) || null;
  }

  function searchPassages(index, query, options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const terms = [...new Set(tokens(query))];
    const empty = { query: String(query ?? ""), total: 0, results: [] };
    if (!terms.length || !index?.passages?.length) return empty;
    let scope = null;
    if (options.courseId || options.course) {
      scope = findCourse(index, options);
      if (!scope) return { ...empty, note: "No course matches that name." };
    }
    const total = index.passages.length;
    const scored = [];
    for (const passage of index.passages) {
      if (scope && String(passage.courseId) !== scope.courseId) continue;
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const tf = passage.counts.get(term);
        if (!tf) continue;
        matched += 1;
        const df = index.df.get(term) || 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * passage.length / index.avgLength));
      }
      if (matched) scored.push({ passage, score: score * (0.4 + 0.6 * matched / terms.length) });
    }
    scored.sort((a, b) => b.score - a.score || a.passage.title.localeCompare(b.passage.title));
    const results = scored.slice(0, limit).map(({ passage, score }) => ({
      id: passage.id,
      score: Math.round(score * 100) / 100,
      courseId: String(passage.courseId),
      course: passage.course,
      kind: passage.kind,
      title: passage.title,
      snippet: passage.text.length > SNIPPET_CHARS ? `${passage.text.slice(0, SNIPPET_CHARS).trimEnd()}…` : passage.text,
      dueAt: passage.dueAt,
      opensAt: passage.opensAt,
      entityId: passage.entityId,
      partOf: passage.partOf || "",
      route: passage.route
    }));
    return { query: empty.query, total: scored.length, results };
  }

  Object.assign(dash, { buildPassageIndex, searchPassages, findPassageCourse: findCourse, passageTokens: tokens });
})(globalThis);
