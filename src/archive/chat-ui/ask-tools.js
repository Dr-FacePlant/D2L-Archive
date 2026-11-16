// What Ask can look up for the model: passages from the archive, what is due
// soon, one item in full (ask/item-details-tool.js), and earlier messages. All only read what the dashboard already holds. A result
// is plain data for the model, plus the sources the screen shows as links.
(function initDashboardAskTools(global) {
  const dash = global.D2LDashboard ||= {};
  const { searchPassages, findPassageCourse } = dash;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_DUE_ITEMS = 15;
  const MAX_DUE_DAYS = 120;
  const LATE_DAYS = 2;
  const SEARCH_LIMIT = 5;
  const ROW_CHARS = 600;
  const ASKED_CHARS = 200;
  const ANSWERED_CHARS = 400;

  const ASK_TOOLS = Object.freeze([
    {
      type: "function",
      function: {
        name: "search_archive",
        description: "Searches the student's saved course materials (syllabus, announcements, assignments, quizzes, grades, and the text inside course files) and returns the best matching passages.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Keywords or the question to look up" },
            course: { type: "string", description: "Optional course name, like CS 1301" }
          },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "upcoming_due",
        description: "Lists work still to do that is due in the next few days, soonest first, with its status. Includes work that went late in the last 2 days.",
        parameters: {
          type: "object",
          properties: {
            days: { type: "integer", description: "How many days ahead to look; 7 if left out" },
            course: { type: "string", description: "Optional course name" }
          },
          required: []
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_past_messages",
        description: "Searches your earlier messages with the student, saved on this computer: this chat and earlier chats. Returns what was asked, what you answered, the chat's name and when.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Words to look for in earlier questions and answers" }
          },
          required: ["query"]
        }
      }
    },
    dash.ASK_ITEM_DETAILS_TOOL,
    dash.ASK_CHAT_LOG_TOOL
  ]);

  const courseNames = (index) => index.courses.map((course) => course.label).filter(Boolean);
  const unknownCourse = (index, wanted) => ({ error: `No course matches "${wanted}". The courses are: ${courseNames(index).join(", ") || "none"}.` });

  // The dashboard's own work items at the time of the question, by entity id: the status the
  // student sees (Open, Late, Submitted…) and the real due date, with their ticks and marks.
  const workCache = new WeakMap();
  function workById(ctx) {
    if (!ctx.index) return new Map();
    if (!workCache.has(ctx)) {
      const items = dash.withHiddenState(dash.withChecklistState(dash.allWork({ ...ctx.index, now: ctx.now }), ctx.checklistDone), ctx.hiddenWork);
      workCache.set(ctx, new Map(items.map((item) => [item.id, item])));
    }
    return workCache.get(ctx);
  }
  const workItem = (ctx, entityId) => workById(ctx).get(entityId) || null;

  // The calendar entries D2L keeps for each item, by the item's id.
  const eventCache = new WeakMap();
  function eventsFor(ctx, entityId) {
    if (!eventCache.has(ctx)) {
      const byTarget = new Map();
      for (const entity of ctx.index?.entities || []) {
        if (entity.entityType === "calendarEvent" && entity.targetEntityId) byTarget.set(entity.targetEntityId, [...(byTarget.get(entity.targetEntityId) || []), entity]);
      }
      eventCache.set(ctx, byTarget);
    }
    return eventCache.get(ctx).get(entityId) || [];
  }

  // An item's status and times: its work item's when it is work; else the times saved on it,
  // or the due and opening times the calendar keeps for it (a content topic's due).
  function itemFacts(ctx, entity) {
    const item = workItem(ctx, entity.entityId);
    if (item) return { status: item.status.label, ...dash.askTimes(item, ctx.now) };
    if (entity.entityType === "calendarEvent") return dash.askTimes(dash.askEventTimes(entity, ctx.index.byId.get(entity.targetEntityId)?.entityType), ctx.now);
    const calendar = eventsFor(ctx, entity.entityId).map((event) => dash.askEventTimes(event, entity.entityType));
    const pick = (key) => calendar.find((times) => times[key])?.[key] || "";
    return dash.askTimes({ dueAt: entity.dates?.dueAt || pick("dueAt"), opensAt: entity.dates?.availableFrom || pick("opensAt") }, ctx.now);
  }

  // The saved item a search hit is about: a calendar entry is about the item it is for, and a
  // saved page with no item of its own (a quiz's settings) is about the item of its name.
  function ownerOf(ctx, hit) {
    const { byId, entities } = ctx.index || {};
    if (!byId) return null;
    const entity = hit.entityId ? byId.get(hit.entityId) : null;
    if (entity) return (entity.entityType === "calendarEvent" && byId.get(entity.targetEntityId)) || entity;
    if (hit.entityId || hit.kind === "File") return null;
    const title = hit.title.toLowerCase();
    const named = entities.filter((one) => String(one.courseId) === hit.courseId && one.entityType !== "calendarEvent" && String(one.canonicalTitle || "").toLowerCase() === title);
    return named.find((one) => workItem(ctx, one.entityId)) || named[0] || null;
  }

  // One row per item: the passages about it (its text, its calendar entries, a page of its
  // name) meet in one row with its own status and times, so no time comes without its meaning.
  // A row about nothing saved that has no text and no time says nothing, and is left out.
  function searchTool(ctx, args) {
    const { passageIndex } = ctx;
    const query = String(args.query ?? "").trim();
    const course = String(args.course ?? "").trim();
    if (!query) return { result: { error: "Give a query to search for." }, sources: [] };
    if (course && !findPassageCourse(passageIndex, { course })) return { result: unknownCourse(passageIndex, course), sources: [] };
    const found = searchPassages(passageIndex, query, { course, limit: SEARCH_LIMIT * 3 });
    const rows = new Map();
    for (const hit of found.results) {
      const owner = ownerOf(ctx, hit);
      const key = owner?.entityId || `${hit.kind}|${hit.courseId}|${hit.title}`;
      if (!rows.has(key)) {
        const facts = owner ? itemFacts(ctx, owner) : dash.askTimes(hit, ctx.now);
        if (rows.size === SEARCH_LIMIT || (!owner && !hit.snippet && !facts.when)) continue;
        const own = (owner && owner.entityId !== hit.entityId && passageIndex.passages.find((one) => one.entityId === owner.entityId)) || hit;
        rows.set(key, { own, facts, texts: [] });
      }
      const { texts } = rows.get(key);
      if (hit.snippet && !texts.includes(hit.snippet)) texts.push(hit.snippet);
    }
    const results = [...rows.values()].map(({ own, facts, texts }) => ({
      course: own.course, kind: own.kind, title: own.title, ...(own.partOf ? { part_of: own.partOf } : {}), ...facts,
      ...(texts.length ? { text: clip(texts.join(" … "), ROW_CHARS) } : {})
    }));
    const sources = [...rows.values()].map(({ own }) => ({ title: own.title, course: own.course, route: own.route }));
    return { result: results.length ? { results } : { results, note: "Nothing in the archive matched." }, sources };
  }

  // The dashboard's Upcoming list within the window: work still to do, soonest first, and
  // work that went late in the last LATE_DAYS while D2L still takes it. Turned-in work is left out.
  function dueTool(ctx, args) {
    const { passageIndex, now } = ctx;
    const course = String(args.course ?? "").trim();
    const scope = course ? findPassageCourse(passageIndex, { course }) : null;
    if (course && !scope) return { result: unknownCourse(passageIndex, course), sources: [] };
    const days = Math.min(Math.max(Math.round(Number(args.days)) || 7, 1), MAX_DUE_DAYS);
    const from = now.getTime() - LATE_DAYS * DAY_MS;
    const to = now.getTime() + days * DAY_MS;
    const due = (ctx.index ? dash.upcomingWork({ ...ctx.index, now }, scope?.courseId || "", ctx.checklistDone, ctx.hiddenWork) : [])
      .filter((item) => { const at = Date.parse(item.dueAt); return at >= from && at <= to; })
      .slice(0, MAX_DUE_ITEMS);
    const items = due.map((item) => ({ course: item.course?.label || "", title: item.title, kind: item.typeLabel, status: item.status.label, ...dash.askTimes(item, now) }));
    const sources = due.map((item) => ({ title: item.title, course: item.course?.label || "", route: item.route }));
    return { result: items.length ? { days, items } : { days, items, note: `Nothing is due in the next ${days} days.` }, sources };
  }

  const clip = (text, chars) => (text.length > chars ? `${text.slice(0, chars - 1).trimEnd()}…` : text);

  // pastChats is the saved chats' index from buildChatIndex (ask-saved-chats.js).
  function pastChatsTool({ pastChats, now }, args) {
    const query = String(args.query ?? "").trim();
    if (!query) return { result: { error: "Give a query to search for." }, sources: [] };
    const found = pastChats ? dash.searchSavedChats(pastChats, query, SEARCH_LIMIT) : [];
    const results = found.map((one) => ({ chat: one.chat, when: dash.askTime(one.when, now), this_chat: one.thisChat, asked: clip(one.asked, ASKED_CHARS), answered: clip(one.answered, ANSWERED_CHARS) }));
    return { result: results.length ? { results } : { results, note: "No earlier chat matched." }, sources: [] };
  }

  // ctx: { passageIndex, index (the dashboard's), checklistDone, hiddenWork, now (a Date), pastChats, bundleFor,
  // fileTexts (what was read from each course file, by its address) }.
  // item_details answers with a promise; the others at once. A lookup that breaks on something
  // saved is an error the model reads, so the answer carries on without it.
  function runAskTool(ctx, name, args) {
    const broke = (error) => {
      console.warn(`Ask lookup ${name} broke:`, error);
      return { result: { error: "That lookup broke on something saved in the archive. Try other words or another tool." }, sources: [] };
    };
    try {
      const out = runOne(ctx, name, args);
      return typeof out?.then === "function" ? out.catch(broke) : out;
    } catch (error) {
      return broke(error);
    }
  }

  function runOne(ctx, name, args) {
    const clean = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    if (name === "search_archive") return searchTool(ctx, clean);
    if (name === "upcoming_due") return dueTool(ctx, clean);
    if (name === "item_details") return dash.askItemDetailsTool(ctx, clean);
    if (name === "search_past_messages") return pastChatsTool(ctx, clean);
    if (name === "chat_log") return dash.askChatLogTool(ctx, clean);
    return { result: { error: `There is no tool called ${name}.` }, sources: [] };
  }

  Object.assign(dash, { ASK_TOOLS, runAskTool, askWorkItem: workItem, askItemFacts: itemFacts, askUnknownCourse: unknownCourse });
})(globalThis);
