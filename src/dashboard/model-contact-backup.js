// Portable backup of the manual instructor-contact edits. The edits live in
// this browser's storage, so this document is the only way to carry them to
// another browser or back after a reinstall. It never contains D2L data.
(function initDashboardContactBackup(global) {
  const dash = global.D2LDashboard ||= {};

  const KIND = "d2l-archive-contact-edits";
  const VERSION = 1;
  const FIELDS = Object.freeze(["name", "email", "officeHours"]);
  const FIELD_LIMITS = Object.freeze({ name: 200, email: 320, officeHours: 500 });
  const MAX_COURSES = 200;
  const MAX_CONTACTS = 50;
  const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const clean = (value) => String(value ?? "").trim();

  function normalizeOverrides(input) {
    const overrides = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) return overrides;
    for (const [rawCourseId, contacts] of Object.entries(input)) {
      if (Object.keys(overrides).length >= MAX_COURSES) break;
      const courseId = clean(rawCourseId);
      if (!courseId || courseId.length > 80 || UNSAFE_KEYS.has(courseId)) continue;
      if (!contacts || typeof contacts !== "object" || Array.isArray(contacts)) continue;
      const kept = {};
      for (const [rawIndex, values] of Object.entries(contacts)) {
        if (Object.keys(kept).length >= MAX_CONTACTS) break;
        if (!/^\d{1,2}$/.test(rawIndex) || Number(rawIndex) >= MAX_CONTACTS) continue;
        if (!values || typeof values !== "object" || Array.isArray(values)) continue;
        const fields = {};
        for (const field of FIELDS) {
          if (typeof values[field] !== "string") continue;
          fields[field] = values[field].trim().slice(0, FIELD_LIMITS[field]);
        }
        if (Object.keys(fields).length) kept[rawIndex] = fields;
      }
      if (Object.keys(kept).length) overrides[courseId] = kept;
    }
    return overrides;
  }

  function contactEditCount(overrides) {
    let count = 0;
    for (const contacts of Object.values(normalizeOverrides(overrides))) {
      for (const fields of Object.values(contacts)) count += Object.keys(fields).length;
    }
    return count;
  }

  function contactBackupDocument(overrides, { exportedAt = new Date().toISOString() } = {}) {
    return {
      kind: KIND,
      version: VERSION,
      exportedAt,
      overrides: normalizeOverrides(overrides)
    };
  }

  // Accepts the document this app writes. Anything else is refused with a
  // sentence the caller can show, so a wrong file never touches storage.
  function parseContactBackup(text) {
    let data;
    try {
      data = JSON.parse(String(text ?? ""));
    } catch {
      return { ok: false, error: "that file isn't valid JSON." };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "that file isn't a contact-edits backup." };
    }
    if (data.kind !== undefined && data.kind !== KIND) {
      return { ok: false, error: "that file is a different kind of backup." };
    }
    if (data.version !== undefined && !(Number(data.version) >= 1 && Number(data.version) <= VERSION)) {
      return { ok: false, error: "that backup was written by a newer version." };
    }
    if (!data.overrides || typeof data.overrides !== "object" || Array.isArray(data.overrides)) {
      return { ok: false, error: "that file has no contact edits in it." };
    }
    const overrides = normalizeOverrides(data.overrides);
    const fields = contactEditCount(overrides);
    if (!fields) return { ok: false, error: "that file has no usable contact edits in it." };
    return { ok: true, overrides, courses: Object.keys(overrides).length, fields };
  }

  // Imported values win, but courses and fields missing from the file are left
  // alone, so importing an older backup never erases newer edits.
  function mergeContactOverrides(current, incoming) {
    const before = normalizeOverrides(current);
    const added = normalizeOverrides(incoming);
    const next = {};
    for (const [courseId, contacts] of Object.entries(before)) next[courseId] = { ...contacts };
    let changed = 0;
    for (const [courseId, contacts] of Object.entries(added)) {
      next[courseId] ||= {};
      for (const [index, fields] of Object.entries(contacts)) {
        const existing = next[courseId][index] || {};
        for (const [field, value] of Object.entries(fields)) {
          if (existing[field] !== value) changed += 1;
        }
        next[courseId][index] = { ...existing, ...fields };
      }
    }
    return { next, changed };
  }

  Object.assign(dash, {
    CONTACT_BACKUP_KIND: KIND,
    normalizeContactOverrides: normalizeOverrides,
    contactEditCount,
    contactBackupDocument,
    parseContactBackup,
    mergeContactOverrides
  });
})(globalThis);
