// Archive index, lessons and checklist links.
(function initDashboardModelArchive(global) {
  const dash = global.D2LDashboard ||= {};
  const { D2L_ORIGIN, DAY_MS, courseCode, courseName, percent, sectionOf, step, termOf, themeFor, time, toDate } = dash;
  // ---------------------------------------------------------------- archive

  function instructorName(value) {
    const name = String(value || "").trim().replace(/\s+/g, " ");
    const parts = name.split(",");
    return parts.length === 2 && parts.every((part) => part.trim())
      ? `${parts[1].trim()} ${parts[0].trim()}`
      : name;
  }

  function instructorOfficeHours(person) {
    const direct = String(person.officeHours || person.office_hours || person.OfficeHours || "").trim();
    if (direct) return direct;
    return extractOfficeHours(person.description || "");
  }

  function extractOfficeHours(text) {
    if (!text) return "";
    const clean = String(text).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    return clean.match(/\boffice\s*hours?\s*[:\-–]\s*([^|\n\r<]*?)(?=\s*\||\s+(?:email|phone|last accessed|location|office)\s*:|$)/i)?.[1]?.trim() || "";
  }

  function extractEmail(text, instructorNameStr = "") {
    if (!text) return "";
    const matches = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const valid = matches.filter((email) => {
      const lower = email.toLowerCase();
      if (/helpdesk|studenthelpdesk|support|service|service_desk|admin|noreply|donotreply|registrar|bursar/i.test(lower)) return false;
      if (/@(?:students|student|alumni)\./i.test(lower)) return false;
      return true;
    });
    if (!valid.length) return "";
    if (instructorNameStr) {
      const nameParts = instructorNameStr.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
      const nameMatch = valid.find((email) => nameParts.some((part) => email.toLowerCase().includes(part)));
      if (nameMatch) return nameMatch;
    }
    return valid[0] || "";
  }

  function buildIndex(raw) {
    const now = toDate(raw.now) || new Date();
    const hidden = new Set((raw.settings?.hiddenCourseIds || []).map(String));
    const shown = new Set((raw.settings?.shownCourseIds || []).map(String));
    // Once syncs record D2L's term dates, org units outside the current term
    // (old courses, advising shells) start hidden; Settings can show them.
    const termKnown = (raw.courses || []).some((course) => course.startsAt && course.endsAt);
    const entities = raw.entities || [];
    const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
    const byCourseType = new Map();
    for (const entity of entities) {
      const key = `${entity.courseId}|${entity.entityType}`;
      if (!byCourseType.has(key)) byCourseType.set(key, []);
      byCourseType.get(key).push(entity);
    }
    const list = (courseId, type) => byCourseType.get(`${courseId}|${type}`) || [];

    const allCourses = (raw.courses || [])
      .filter((course) => course.courseId && course.courseId !== "unknown")
      .map((course, index) => {
        const code = courseCode(course.code);
        const people = list(course.courseId, "person");
        const instructorPeople = people.filter((person) => /^instructor$/i.test(person.roleName || ""));
        const instructors = instructorPeople.map((person) => instructorName(person.displayName)).filter(Boolean);
        let instructorContacts = instructorPeople.map((person) => {
          const source = [person.email, person.description].filter(Boolean).join(" ");
          const name = instructorName(person.displayName);
          const email = extractEmail(source, name);
          const officeHours = instructorOfficeHours(person);
          return { name, email, officeHours };
        }).filter((person) => person.name || person.email || person.officeHours);

        // Fallback: If email or office hours are missing from Classlist person profiles,
        // extract from course overview policy bodies, syllabus topic descriptions, and announcements.
        const instructorPrimary = instructors[0] || instructorContacts[0]?.name || "";
        const courseTexts = [
          ...list(course.courseId, "coursePolicy").map((p) => [p.canonicalTitle, p.body].filter(Boolean).join(" ")),
          ...list(course.courseId, "learningResource")
            .filter((r) => /\b(?:syllabus|course\s+outline|course\s+information|course\s+info)\b/i.test(r.canonicalTitle || ""))
            .map((r) => [r.canonicalTitle, r.body, r.description].filter(Boolean).join(" ")),
          ...list(course.courseId, "announcement").map((a) => [a.canonicalTitle, a.body].filter(Boolean).join(" "))
        ];
        const combinedText = courseTexts.join("\n");
        if (combinedText) {
          const fallbackEmail = extractEmail(combinedText, instructorPrimary);
          const fallbackHours = extractOfficeHours(combinedText);
          if (instructorContacts.length) {
            instructorContacts = instructorContacts.map((contact) => ({
              ...contact,
              email: contact.email || extractEmail(combinedText, contact.name) || fallbackEmail,
              officeHours: contact.officeHours || fallbackHours
            }));
          } else if (fallbackEmail || fallbackHours || instructors.length) {
            instructorContacts = [{
              name: instructorPrimary,
              email: fallbackEmail,
              officeHours: fallbackHours
            }].filter((c) => c.name || c.email || c.officeHours);
          }
        }
        const textbooks = dash.parseTextbookMentions ? dash.parseTextbookMentions(combinedText) : [];
        const completion = list(course.courseId, "studentProgress").find((entity) => entity.progressKind === "courseCompletion") || null;
        const finalGrade = list(course.courseId, "gradeRecord").find((entity) => entity.kind === "final") || null;
        return {
          courseId: course.courseId,
          title: course.title,
          name: courseName(course.title),
          code,
          label: code || courseName(course.title),
          section: sectionOf(course.title),
          term: termOf(course.title) || course.semester || "",
          instructors,
          instructorContacts,
          textbooks,
          completion: completion && completion.requiredItems
            ? { completed: completion.completedItems, required: completion.requiredItems, pct: percent(completion.completedItems, completion.requiredItems) }
            : null,
          finalGrade,
          startsAt: course.startsAt || null,
          lastSyncedAt: course.lastSeenAt || null,
          currentTerm: Boolean(course.startsAt && course.endsAt && time(course.startsAt) <= now.getTime() && now.getTime() <= time(course.endsAt)),
          defaultHidden: termKnown && !(course.startsAt && course.endsAt && time(course.startsAt) <= now.getTime() && now.getTime() <= time(course.endsAt)),
          d2lHome: `${D2L_ORIGIN}/d2l/home/${course.courseId}`,
          ...themeFor(code, index)
        };
      })
      .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));

    const courses = allCourses.filter((course) => !hidden.has(course.courseId) && (!course.defaultHidden || shown.has(course.courseId)));
    const courseById = new Map(allCourses.map((course) => [course.courseId, course]));
    const visible = new Set(courses.map((course) => course.courseId));
    const index = { raw, now, entities, byId, list, allCourses, courses, courseById, visible, courseContactOverrides: raw.courseContactOverrides || {}, courseTextbooks: raw.courseTextbooks || {}, lessonDue: lessonDeadlines(entities, byId) };
    index.checklistLinks = checklistLinks(index);
    return index;
  }

  // Some work has no date of its own in D2L but sits in a content module that
  // does ("Lesson 6. The World of Rome - Due" on D2L's calendar). That module's
  // deadline is the work's deadline. Content links name the work by title, and
  // D2L's quick link says which tool it points at (type=discuss, quiz, dropbox).
  const LINK_KINDS = { discuss: "discussion", quiz: "quiz", dropbox: "assignment" };

  function lessonKey(courseId, title, kind) {
    return `${courseId}|${String(title || "").replace(/\s+/g, " ").trim().toLowerCase()}|${kind}`;
  }

  function lessonName(title) {
    const clean = String(title || "").trim();
    const match = clean.match(/^((?:lessons?|modules?|units?|weeks?|chapters?|topics?)\s+[\w-]+(?:\s+(?:and|&)\s+[\w-]+)?)\b/i);
    return match ? match[1] : clean;
  }

  function lessonDeadlines(entities, byId) {
    const moduleDue = new Map();
    for (const entity of entities) {
      if (entity.entityType !== "calendarEvent" || entity.eventLabel !== "Due" || !/ModuleCO$/.test(entity.sourceEntityType || "")) continue;
      const at = entity.dates?.dueAt || entity.dates?.startAt;
      if (entity.targetEntityId && at) moduleDue.set(entity.targetEntityId, at);
    }
    const deadlines = new Map();
    if (!moduleDue.size) return deadlines;
    for (const entity of entities) {
      if (entity.entityType !== "learningResource" || entity.isModule || !entity.moduleId) continue;
      const linkType = String(entity.urls?.download || entity.urls?.external || "").match(/[?&]type=(discuss|quiz|dropbox)\b/)?.[1];
      const key = lessonKey(entity.courseId, entity.canonicalTitle, LINK_KINDS[linkType] || "");
      const seen = new Set();
      for (let moduleId = entity.moduleId; moduleId && !seen.has(moduleId) && !deadlines.has(key);) {
        seen.add(moduleId);
        const id = `resource:${entity.courseId}:${moduleId}`;
        if (moduleDue.has(id)) deadlines.set(key, { at: moduleDue.get(id), lesson: lessonName(byId.get(id)?.canonicalTitle || entity.moduleTitle) });
        moduleId = byId.get(id)?.parentModuleId || "";
      }
    }
    return deadlines;
  }

  // A module named after the work itself (Quiz 1 inside "Quiz 1") isn't named again.
  function lessonDue(index, entity, kind) {
    const found = index.lessonDue?.get(lessonKey(entity.courseId, entity.canonicalTitle, kind))
      || index.lessonDue?.get(lessonKey(entity.courseId, entity.canonicalTitle, ""));
    if (!found) return null;
    const same = lessonKey("", found.lesson, "") === lessonKey("", entity.canonicalTitle, "");
    return same ? { ...found, lesson: "" } : found;
  }

  // Checklists spell out what a discussion takes: "Post your question to the
  // discussion forum", "Reply to another student", "Comment Meaningfully on 3
  // Other Posts". Each such task is linked to its topic by a topic name in
  // quotes ("Applying a Theory to Film"), or else by number: Checklist 2 goes
  // with the discussion in Lesson 2, "Module 8 Checklist" with "Module 8
  // Homework". A link gives the topic its reply count and, when D2L has no
  // date for the topic, the latest date on its tasks. The task's own done
  // state then comes from your posts on D2L, never from a tick here.
  const REPLY_STEP = /\b(?:repl(?:y|ies)|respond(?:s|ed|ing)?|answer(?:s|ed|ing)?|comment(?:s|ed|ing)?)\b[^.;]*?\b(?:another|others?|classmates?|peers?|fellow)\b/i;
  const THREAD_STEP = /\bpost\b[^.;]*?\b(?:discussion|forum|board)\b/i;
  const WHOLE_STEP = /\b(?:complete|participate|finish)\w*\b[^.;]*?\bdiscussion\b/i;
  const COUNT_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 });
  const REPLY_COUNT = /\b(\d+|one|two|three|four|five|six)\s+(?:(?:other|more|different)\s+)?(?:posts?|students?|classmates?|peers?|replies|responses|comments|threads?)\b/i;
  const UNIT_NUMBER = /^(?:lessons?|modules?|units?|weeks?|chapters?|topics?)\s+(\d+)\b/i;
  const QUOTED = /["“”]([^"“”]{3,80})["“”]/g;

  // "thread" (post your own), "reply" (answer classmates) or "whole" (both),
  // with how many replies the task asks for.
  function checklistStep(entity) {
    const text = `${entity.canonicalTitle || ""}. ${entity.description || ""}`;
    const reply = REPLY_STEP.test(text);
    const thread = THREAD_STEP.test(text);
    const whole = WHOLE_STEP.test(text);
    const role = reply && (thread || whole) ? "whole" : reply ? "reply" : thread ? "thread" : whole ? "whole" : "";
    if (!role) return null;
    const count = role === "thread" ? "" : String(text.match(REPLY_COUNT)?.[1] || "").toLowerCase();
    return { role, needed: Math.min(10, Math.max(1, Number(COUNT_WORDS[count] || count) || 1)) };
  }

  function words(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function checklistLinks(index) {
    const byTask = new Map();
    const byDiscussion = new Map();
    const unitByLink = new Map();
    for (const entity of index.entities) {
      if (entity.entityType !== "learningResource" || entity.isModule || !entity.moduleId) continue;
      if (!/[?&]type=discuss\b/.test(String(entity.urls?.download || entity.urls?.external || ""))) continue;
      const seen = new Set();
      for (let moduleId = entity.moduleId; moduleId && !seen.has(moduleId);) {
        seen.add(moduleId);
        const module = index.byId.get(`resource:${entity.courseId}:${moduleId}`);
        const unit = String(module?.canonicalTitle || "").trim().match(UNIT_NUMBER)?.[1];
        if (unit) { unitByLink.set(lessonKey(entity.courseId, entity.canonicalTitle, "discussion"), unit); break; }
        moduleId = module?.parentModuleId || "";
      }
    }
    const topics = new Map();
    for (const entity of index.entities) {
      if (entity.entityType !== "discussionThread") continue;
      const unit = unitByLink.get(lessonKey(entity.courseId, entity.canonicalTitle, "discussion")) || String(entity.canonicalTitle || "").trim().match(UNIT_NUMBER)?.[1] || "";
      if (!topics.has(entity.courseId)) topics.set(entity.courseId, []);
      topics.get(entity.courseId).push({ entity, unit, words: ` ${words(entity.canonicalTitle)} ` });
    }
    for (const entity of index.entities) {
      if (entity.entityType !== "courseToolItem" || entity.toolType !== "checklistItem") continue;
      if (fromEarlierTerm(index, entity.courseId, entity.dates?.dueAt)) continue;
      const step = checklistStep(entity);
      const courseTopics = topics.get(entity.courseId) || [];
      if (!step || !courseTopics.length) continue;
      const quoted = [...`${entity.canonicalTitle} ${entity.description || ""}`.matchAll(QUOTED)].map((match) => words(match[1])).filter(Boolean);
      let matches = courseTopics.filter((topic) => quoted.some((phrase) => topic.words.includes(` ${phrase} `)));
      if (matches.length !== 1) {
        const unit = String(entity.category || "").match(/\b(\d+)\b/)?.[1] || "";
        matches = unit ? courseTopics.filter((topic) => topic.unit === unit) : [];
      }
      if (matches.length !== 1) continue;
      const topicId = matches[0].entity.entityId;
      byTask.set(entity.entityId, { discussionId: topicId, role: step.role, needed: step.needed });
      const link = byDiscussion.get(topicId) || { checklist: entity.category || "", repliesNeeded: 1, dueAt: null, taskIds: [] };
      link.taskIds.push(entity.entityId);
      if (step.role !== "thread") link.repliesNeeded = Math.max(link.repliesNeeded, step.needed);
      const due = entity.dates?.dueAt;
      if (due && (!link.dueAt || time(due) > time(link.dueAt))) Object.assign(link, { dueAt: due, checklist: entity.category || link.checklist });
      byDiscussion.set(topicId, link);
    }
    return { byTask, byDiscussion };
  }

  // Some instructors reuse one D2L course every term, so HIST 9002 carries
  // announcements and checklists from 2023 on. Anything dated more than two
  // weeks before the course's start belongs to an earlier term; the two weeks
  // keep welcome posts sent before the first day (ART's came 3 days early).
  // Courses without a start date keep everything.
  const TERM_LEAD_MS = 14 * DAY_MS;

  function fromEarlierTerm(index, courseId, value) {
    const start = time(index.courseById.get(courseId)?.startsAt);
    const at = time(value);
    return Number.isFinite(start) && Number.isFinite(at) && at < start - TERM_LEAD_MS;
  }


  Object.assign(dash, {
    buildIndex, lessonKey, lessonName, lessonDeadlines, lessonDue, checklistStep, words, checklistLinks, fromEarlierTerm, LINK_KINDS, REPLY_STEP, THREAD_STEP, WHOLE_STEP, COUNT_WORDS, REPLY_COUNT, UNIT_NUMBER, QUOTED, TERM_LEAD_MS
  });
})(globalThis);
