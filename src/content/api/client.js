(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;

// ---- Valence API collector -----------------------------------------------
// DOM scraping misses what D2L never renders: quiz due dates, the real file
// behind a topic, and calendar events outside the visible month. All of it is
// available from the authenticated Valence API, which this content script can
// call with the user's own session cookies. Verified live 2026-09-17 against
// all four Fall 2026 courses.
const D2L_API_VERSION = "1.67";
const D2L_API_MODERN_VERSION = "1.82";
const D2L_LP_API_VERSION = "1.49";

async function apiGet(pathname) {
  try {
    const response = await fetch(pathname, { credentials: "include" });
    if (!response.ok) return { ok: false, status: response.status, data: null };
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.message || "fetch failed" };
  }
}

// Topics come back in D2L's Table of Contents order; tocOrder keeps that order
// and moduleId/moduleStartDate keep which module (and week) each belongs to.
function flattenTocTopics(modules, trail = [], counter = { value: 0 }) {
  const topics = [];
  for (const module of modules || []) {
    const path = [...trail, module.Title || ""];
    for (const topic of module.Topics || []) {
      counter.value += 1;
      topics.push({
        ...topic,
        modulePath: path.join(" / "),
        moduleId: module.ModuleId ?? "",
        moduleTitle: module.Title || "",
        moduleStartDate: module.StartDateTime || "",
        tocOrder: counter.value
      });
    }
    topics.push(...flattenTocTopics(module.Modules, path, counter));
  }
  return topics;
}

function flattenTocModules(modules, trail = [], counter = { value: 0 }, parentModuleId = "") {
  const flat = [];
  for (const module of modules || []) {
    counter.value += 1;
    const path = [...trail, module.Title || ""];
    flat.push({ ...module, modulePath: path.join(" / "), parentModuleId, tocOrder: counter.value, depth: trail.length });
    flat.push(...flattenTocModules(module.Modules, path, counter, String(module.ModuleId ?? "")));
  }
  return flat;
}

// D2L serves a topic's actual bytes here regardless of its viewer page, which
// is what makes real PDF/PPT/video capture possible. 403 means the topic has
// no stored file (an external Link topic), not an auth problem.
function directDownloadUrl(orgUnitId, topicId) {
  return `${window.location.origin}/d2l/le/content/${orgUnitId}/topics/files/download/${topicId}/DirectFileTopicDownload`;
}

function fileNameFromUrl(url, fallback) {
  try {
    const tail = decodeURIComponent(String(url).split("?")[0].split("#")[0].split("/").pop() || "");
    return /\.[a-z0-9]{2,5}$/i.test(tail) ? tail : fallback;
  } catch {
    return fallback;
  }
}

// Calendar events carry an exact entity id, so quizzes and assignments join by
// id instead of by title. Title matching was measured producing wrong dates
// (a "Quiz 1" matched an unrelated 2025 event), so it is deliberately not used.
function indexEventsByEntity(events) {
  const byEntity = new Map();
  for (const event of events || []) {
    const entity = event.AssociatedEntity;
    if (!entity?.AssociatedEntityType || entity.AssociatedEntityId == null) continue;
    const key = `${entity.AssociatedEntityType}:${entity.AssociatedEntityId}`;
    if (!byEntity.has(key)) byEntity.set(key, event);
  }
  return byEntity;
}

function resolveDue(primary, fallback, event) {
  if (primary) return { value: primary, source: "apiDueDate" };
  if (fallback) return { value: fallback, source: "apiEndDate" };
  if (event?.EndDateTime) return { value: event.EndDateTime, source: "calendarEntityJoin" };
  return { value: "", source: "none" };
}

// A grade needs two calls: /grades/ names the columns and their max points,
// /grades/values/myGradeValues/ carries this user's own scores. They join on
// GradeObjectIdentifier, and either can 403 on a course that hides grades.
function mergeGradeValues(definitions, values) {
  const byId = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (value?.GradeObjectIdentifier == null) continue;
    byId.set(String(value.GradeObjectIdentifier), value);
  }
  const merged = [];
  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const value = byId.get(String(definition.Id)) || null;
    merged.push({ definition, value });
    byId.delete(String(definition.Id));
  }
  // A score whose column the definitions call never returned still counts.
  for (const value of byId.values()) merged.push({ definition: null, value });
  return merged;
}

function gradeDisplay(value) {
  if (!value) return "";
  if (value.DisplayedGrade) return normalizeText(value.DisplayedGrade);
  if (value.PointsNumerator != null && value.PointsDenominator != null) {
    return `${value.PointsNumerator}/${value.PointsDenominator}`;
  }
  return "";
}

function richText(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeText(value);
  return normalizeText(value.Text || value.Html || value.Content || "");
}

function firstRichText(...values) {
  for (const value of values) {
    const text = richText(value);
    if (text) return text;
  }
  return "";
}

function apiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Objects)) return data.Objects;
  if (Array.isArray(data?.Items)) return data.Items;
  return [];
}

function derivedStudentUsefulRows(item) {
  // Rubric rows are already the real rubric; deriving from them would overwrite it.
  if (item?.source === "rubric" || item?.source === "rubricFeedback") return [];
  const text = `${item.title || ""} ${item.description || ""} ${item.type || ""} ${item.url || ""}`;
  const rows = [];
  const base = {
    title: item.title,
    description: item.description,
    url: item.url,
    downloadUrl: item.downloadUrl,
    suggestedFileName: item.suggestedFileName,
    type: item.type,
    dueAtText: item.dueAtText,
    availabilityText: item.availabilityText,
    ids: item.ids,
    columns: {
      derivedFromSource: item.source || "",
      originalType: item.type || ""
    }
  };

  if (/syllabus|course schedule|schedule of assignments|tentative schedule|calendar of assignments|course policy|policies|late work|late policy|grading policy|office hours|instructor information|professor|contact information/i.test(text)) {
    rows.push({ ...base, source: "syllabusPolicy" });
  }

  if (/rubric|criteria|criterion|performance level|assessment rubric|grading rubric/i.test(text)) {
    rows.push({ ...base, source: "rubric" });
  }

  return rows;
}

function appendDerivedRows(items) {
  const derived = [];
  for (const item of items) derived.push(...derivedStudentUsefulRows(item));
  return [...items, ...derived];
}

function apiProbeStatus(status) {
  if (status >= 200 && status < 300) return "available";
  if (status === 401 || status === 403) return "blocked";
  if (status === 404) return "notEnabledOrHidden";
  if (status === 0) return "unreachable";
  return "unavailable";
}

function addApiProbeRow(items, orgUnitId, tool, status, detail = {}, options = {}) {
  if (status === undefined || status === null) return;
  const isAvailable = status >= 200 && status < 300;
  if (isAvailable && !options.includeAvailable) return;
  const evidenceCount = Number(detail.evidenceCount ?? 0);
  const probeStatus = isAvailable && evidenceCount === 0 ? "availableEmpty" : apiProbeStatus(status);
  const ids = { courseOrgUnitId: orgUnitId };
  for (const key of ["dropboxFolderId", "assignmentFolderId", "quizId", "discussionForumId", "discussionTopicId", "newsItemId"]) {
    if (detail[key] !== undefined && detail[key] !== null && String(detail[key]).trim()) ids[key] = String(detail[key]);
  }
  items.push({
    source: "apiProbe",
    title: `${tool} API ${status}`,
    description: isAvailable
      ? `Read-only ${tool} API probe returned ${status} with ${evidenceCount} extracted evidence row${evidenceCount === 1 ? "" : "s"}.`
      : `Read-only ${tool} API probe returned ${status}. This usually means the tool is hidden, empty, unavailable to students, or blocked by D2L permissions.`,
    url: `${window.location.origin}/d2l/home/${orgUnitId}`,
    status: probeStatus,
    type: tool,
    columns: { status, ...detail },
    ids
  });
}


  Object.assign(content, {
    D2L_API_VERSION, D2L_API_MODERN_VERSION, D2L_LP_API_VERSION,
    apiGet, flattenTocTopics, flattenTocModules, directDownloadUrl, fileNameFromUrl,
    indexEventsByEntity, resolveDue, mergeGradeValues, gradeDisplay,
    richText, firstRichText, apiList, derivedStudentUsefulRows,
    appendDerivedRows, apiProbeStatus, addApiProbeRow
  });
})();
