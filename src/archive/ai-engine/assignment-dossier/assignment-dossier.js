// Assignment dossier: read course documents in the background and cache a sourced brief.
(function initAssignmentDossier(global) {
  const dash = global.D2LDashboard ||= {};
  const DB_NAME = "student-archive-assignment-dossiers";
  const STORE = "dossiers";
  const MAX_SOURCES = 6;
  const LATER = new Set(["signed-out", "offline", "no-answer"]);
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const web = (value) => /^https?:\/\//i.test(value || "") ? value : "";
  const escape = (value) => dash.escapeHtml(String(value ?? ""));

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Dossier storage failed."));
    });
  }

  function createCache(indexedDB = global.indexedDB) {
    let opening = null;
    function database() {
      if (!indexedDB) return Promise.reject(new Error("IndexedDB is unavailable."));
      opening ||= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { opening = null; reject(request.error); };
      });
      return opening;
    }
    return {
      async get(key) { return requestValue((await database()).transaction(STORE).objectStore(STORE).get(key)); },
      async put(record) { return requestValue((await database()).transaction(STORE, "readwrite").objectStore(STORE).put(record)); }
    };
  }

  function fileCandidate(name, url, relation, priority = 3) {
    return { name: clean(name) || "Course document", url: web(url), relation, priority };
  }

  function candidatesFor(assignment, index) {
    const candidates = [];
    for (const file of assignment.files || []) candidates.push(fileCandidate(file.name, file.downloadUrl || file.url, "Attached to this assignment", 0));
    for (const group of assignment.related || []) for (const item of group.items || []) {
      const peek = item.peek || {};
      candidates.push(fileCandidate(peek.title || item.title, peek.downloadUrl || peek.d2lUrl, "Related course content", 2));
    }
    const courseId = assignment.item?.courseId || assignment.course?.courseId;
    const title = clean(assignment.title).toLowerCase();
    const titleWords = title.split(/\W+/).filter((word) => word.length > 2);
    for (const topic of courseId ? index?.list?.(courseId, "learningResource") || [] : []) {
      if (topic.isModule) continue;
      const name = topic.canonicalTitle || "Course document";
      const lower = name.toLowerCase();
      const titleMatch = titleWords.some((word) => lower.includes(word));
      const guide = /syllabus|rubric|instruction|assignment|prompt|writing|citation|style guide|guideline|course overview/i.test(name);
      if (!titleMatch && !guide) continue;
      candidates.push(fileCandidate(name, topic.urls?.download || topic.urls?.item || topic.urls?.d2l, titleMatch ? "Title-matched course content" : "Course guide", titleMatch ? 1 : 2));
    }
    const unique = new Map();
    for (const candidate of candidates.filter((entry) => entry.url)) {
      const old = unique.get(candidate.url);
      if (!old || candidate.priority < old.priority) unique.set(candidate.url, candidate);
    }
    return [...unique.values()].sort((a, b) => a.priority - b.priority).slice(0, MAX_SOURCES);
  }

  function hash(value) {
    let result = 2166136261;
    for (const char of value) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
    return (result >>> 0).toString(36);
  }

  function cacheKey(accountId, assignment, candidates) {
    const input = [assignment.item?.id, assignment.title, assignment.instructions, ...candidates.map((file) => `${file.url}:${file.name}`)].join("|");
    return `dossier-v1|${accountId}|${hash(input)}`;
  }

  function sourceLines(record, source) {
    const pages = Array.isArray(record.pageText) ? record.pageText : null;
    const chunks = pages ? pages.map((text, page) => ({ text, page: page + 1 })) : [{ text: record.text || "", page: null }];
    return chunks.flatMap(({ text, page }) => String(text || "").split(/\n+/).map(clean)
      .filter((line) => line.length > 12).map((text) => ({ text, page, source })));
  }

  function relevant(line, assignmentTitle) {
    const titleWords = clean(assignmentTitle).toLowerCase().split(/\W+/).filter((word) => word.length > 2);
    const text = line.text.toLowerCase();
    return titleWords.some((word) => text.includes(word)) || /submit|assignment|project|paper|report|requirement|citation|format|word count|page count|deliverable|upload|rubric|must|should/.test(text);
  }

  function requirementsFrom(lines) {
    const found = [];
    const add = (line, label) => found.push({ text: label, source: line.source, page: line.page });
    for (const line of lines) {
      const text = line.text;
      const styles = text.match(/\b(?:APA|MLA|Chicago|IEEE)\b/gi) || [];
      for (const style of new Set(styles.map((value) => value.toUpperCase()))) add(line, `Possible citation style: ${style}`);
      const length = text.match(/\b\d[\d,]*(?:\s*[-–]\s*\d[\d,]*)?\s*(?:-word|words?|pages?)\b/gi) || [];
      for (const value of new Set(length.map(clean))) add(line, `Possible length: ${value}`);
      const format = text.match(/\b(?:PDF|DOCX?|Word document)\b/gi) || [];
      for (const value of new Set(format.map((entry) => entry.toUpperCase()))) {
        if (/submit|save|upload|file|format/i.test(text)) add(line, `Possible file format: ${value}`);
      }
    }
    const seen = new Set();
    return found.filter((rule) => {
      const key = `${rule.text}|${rule.source.url}|${rule.page}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12).map((rule, at) => ({ ...rule, id: `rule-${at + 1}` }));
  }

  function synthesize({ key, assignment, documents, candidates }) {
    const readable = documents.filter(({ record }) => record?.state === "read");
    const lines = readable.flatMap(({ source, record }) => sourceLines(record, source)).filter((line) => relevant(line, assignment.title));
    const seen = new Set();
    const brief = lines.filter((line) => {
      const text = clean(line.text);
      if (seen.has(text.toLowerCase())) return false;
      seen.add(text.toLowerCase());
      return true;
    }).slice(0, 8).map((line) => ({ text: line.text, source: line.source, page: line.page }));
    const sources = documents.map(({ source, record }) => ({ ...source, state: record?.state || "failed" }));
    const requirements = requirementsFrom(lines);
    const fallbackLinks = sources.filter((source) => source.state !== "read" && source.url);
    if (!candidates.length || !brief.length) {
      const link = (assignment.links || []).find((entry) => entry.primary && web(entry.url)) || (assignment.links || []).find((entry) => web(entry.url));
      if (link && !fallbackLinks.some((source) => source.url === link.url)) fallbackLinks.push({ name: link.label || "Open assignment in D2L", url: link.url, relation: "Assignment", state: "missing" });
    }
    return {
      key, state: brief.length ? "ready" : "fallback", brief, sources,
      requirements, fallbackLinks,
      checks: {}, copyText: [...brief.map((line) => line.text), ...requirements.map((rule) => `${rule.text} — Inferred from ${rule.source.name}${rule.page ? ` p. ${rule.page}` : ""}`)].join("\n")
    };
  }

  function createAssignmentDossier({ indexedDB = global.indexedDB, fileTextStore = dash.askFileTexts, readFile = dash.askReadFileText, document = global.document, navigator = global.navigator, cache } = {}) {
    const storage = cache || createCache(indexedDB);
    const inFlight = new Map();
    async function get({ accountId, assignment, index }) {
      const account = clean(accountId);
      const candidates = candidatesFor(assignment, index);
      const key = cacheKey(account, assignment, candidates);
      if (!account) return synthesize({ key, assignment, documents: [], candidates });
      const cached = await storage.get(key).catch(() => null);
      if (cached) return { ...cached, cached: true };
      if (inFlight.has(key)) return inFlight.get(key);
      const pending = (async () => {
        const known = await Promise.resolve(fileTextStore?.all?.(account)).catch(() => new Map()) || new Map();
        const documents = [];
        let retry = false;
        for (const source of candidates) {
          let record = known.get(source.url);
          if (!record || LATER.has(record.state)) {
            try { record = await readFile?.(source); } catch { record = { state: "failed" }; }
          }
          record ||= { state: "unavailable" };
          if (LATER.has(record.state)) retry = true;
          if (record.state !== "signed-out" && record.state !== "offline" && record.state !== "no-answer") {
            await Promise.resolve(fileTextStore?.keep?.(account, source.url, { ...record, name: source.name })).catch(() => {});
          }
          documents.push({ source, record });
        }
        const result = synthesize({ key, assignment, documents, candidates });
        if (!retry) await storage.put(result).catch(() => {});
        return result;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
      return pending;
    }
    async function setChecked(accountId, key, id, checked) {
      const record = await storage.get(key).catch(() => null);
      if (!record || !key.startsWith(`dossier-v1|${clean(accountId)}|`)) return;
      record.checks ||= {};
      record.checks[id] = checked === true;
      await storage.put(record).catch(() => {});
    }
    function bindEvents() {
      if (!document?.addEventListener || document.__assignmentDossierBound) return;
      document.__assignmentDossierBound = true;
      document.addEventListener("click", async (event) => {
        const button = event.target?.closest?.("[data-dossier-copy]");
        if (!button) return;
        const root = button.closest("#assignment-dossier");
        const status = root?.querySelector("[data-dossier-status]");
        try {
          await navigator?.clipboard?.writeText(root?.dataset.copyText || "");
          if (status) status.textContent = "Copied";
        } catch { if (status) status.textContent = "Copy unavailable"; }
      });
      document.addEventListener("change", (event) => {
        const input = event.target;
        if (!input?.dataset?.dossierCheck) return;
        const root = input.closest("#assignment-dossier");
        if (root) void setChecked(root.dataset.accountId, root.dataset.cacheKey, input.dataset.dossierCheck, input.checked);
      });
    }
    bindEvents();
    return Object.freeze({ get, setChecked });
  }

  function citation(source, page, inferred = false) {
    const label = `${inferred ? "Inferred from " : "From "}${source.name}${page ? ` p. ${page}` : ""}`;
    return source.url ? `<a class="dossier-citation" href="${escape(source.url)}" rel="noopener noreferrer" data-d2l-link>${escape(label)}</a>` : `<span class="dossier-citation">${escape(label)}</span>`;
  }

  function assignmentDossierHtml(dossier) {
    const key = escape(dossier.key);
    const accountId = escape(dossier.key.split("|")[1] || "");
    const sources = dossier.sources.map((source) => `<li>${citation(source, null)} <span class="dossier-source-state">${source.state === "read" ? "Read" : "Open source"}</span></li>`).join("");
    const brief = dossier.brief.length ? `<ul class="dossier-brief">${dossier.brief.map((line) => `<li><span>${escape(line.text)}</span>${citation(line.source, line.page)}</li>`).join("")}</ul>` : `<p class="prose">No readable instructions were found in the related course files.</p>`;
    const engineBadge = `<span class="dossier-engine-badge" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;background:var(--accent-tint, rgba(0,102,204,0.1));color:var(--accent, #0066cc);margin-left:8px;">Local Synthesis Engine Active</span>`;
    const requirements = dossier.requirements.length ? `<h3>Possible requirements</h3><ul class="dossier-requirements">${dossier.requirements.map((rule) => `<li><label><input type="checkbox" data-dossier-check="${escape(rule.id)}" aria-label="Mark ${escape(rule.text)} complete" ${dossier.checks?.[rule.id] ? "checked" : ""}><span>${escape(rule.text)}</span></label>${citation(rule.source, rule.page, true)}</li>`).join("")}</ul>` : "";
    const fallback = dossier.fallbackLinks.map((source) => `<li><a href="${escape(source.url)}" rel="noopener noreferrer" data-d2l-link>Open or download ${escape(source.name)}</a></li>`).join("");
    const title = "assignment-dossier-title";
    return `<section class="card assignment-dossier" id="assignment-dossier" role="region" aria-labelledby="${title}" data-account-id="${escape(accountId)}" data-cache-key="${key}" data-copy-text="${escape(dossier.copyText || "")}" aria-busy="false">
      <div class="dossier-head"><div><h2 id="${title}" style="display:flex;align-items:center;flex-wrap:wrap;">Brief &amp; Requirements${engineBadge}</h2><p>Possible requirements are inferences from course files.</p></div><button class="btn dossier-copy" type="button" data-dossier-copy aria-label="Copy brief and requirements">Copy</button></div>
      ${brief}${requirements}${sources ? `<h3>Sources</h3><ul class="dossier-sources">${sources}</ul>` : ""}${fallback ? `<h3>Open the original</h3><ul class="dossier-fallback">${fallback}</ul>` : ""}<span class="sr-only" aria-live="polite" data-dossier-status></span>
    </section>`;
  }

  let defaultEngine;
  function mountAssignmentDossier({ accountId, assignment, index, isCurrent = () => true }) {
    const target = global.document?.getElementById("assignment-dossier");
    if (!target || !assignment || assignment.kind !== "assignment") return;
    target.innerHTML = `<h2 id="assignment-dossier-title">Brief &amp; Requirements</h2><p>Checking course documents…</p>`;
    target.setAttribute("aria-busy", "true");
    defaultEngine ||= createAssignmentDossier();
    void defaultEngine.get({ accountId, assignment, index }).then((dossier) => {
      if (!isCurrent() || !target.isConnected) return;
      target.outerHTML = assignmentDossierHtml(dossier);
    }).catch(() => {
      if (!isCurrent() || !target.isConnected) return;
      target.innerHTML = `<h2 id="assignment-dossier-title">Brief &amp; Requirements</h2><p>No readable course instructions were found.</p>`;
      target.setAttribute("aria-busy", "false");
    });
  }

  function addPlaceholder(detailBody) {
    if (typeof detailBody !== "function") return;
    dash.detailBody = function assignmentDossierBody(model) {
      const html = detailBody(model);
      if (model?.kind !== "assignment" || html.includes('id="assignment-dossier"')) return html;
      const start = html.indexOf("<h2>Instructions</h2>");
      const end = html.indexOf("</p>", start);
      if (start < 0 || end < 0) return html;
      const placeholder = `<section class="card assignment-dossier" id="assignment-dossier" role="region" aria-labelledby="assignment-dossier-title" aria-busy="true"><h2 id="assignment-dossier-title">Brief &amp; Requirements</h2><p>Checking course documents…</p></section>`;
      return `${html.slice(0, end + 4)}${placeholder}${html.slice(end + 4)}`;
    };
  }

  function watchAssignmentDetails() {
    const root = global.document?.getElementById?.("detail-root");
    if (!root || !global.MutationObserver) return;
    const mounting = new WeakSet();
    const mount = () => {
      const target = root.querySelector('#assignment-dossier[aria-busy="true"]');
      if (!target || mounting.has(target)) return;
      const routeHash = global.location?.hash || "";
      const route = dash.parseRoute?.(routeHash);
      const app = dash.appModules;
      const state = app?.state;
      if (route?.name !== "assignment" || !state?.index || !app.bundleFor) return;
      mounting.add(target);
      const accountId = state.account?.id || "";
      Promise.resolve(app.bundleFor(route.id)).then((bundle) => {
        if (global.location?.hash !== routeHash || !target.isConnected) return null;
        return dash.detailFor?.(state.index, route, bundle);
      }).then((assignment) => {
        if (!assignment || global.location?.hash !== routeHash || !target.isConnected) return;
        mountAssignmentDossier({ accountId, assignment, index: state.index, isCurrent: () => global.location?.hash === routeHash && state.account?.id === accountId });
      }).catch(() => {});
    };
    new global.MutationObserver(mount).observe(root, { childList: true, subtree: true });
    global.addEventListener?.("hashchange", mount);
    mount();
  }

  
  // Dev feature: Sample assignment with attached documents to test and preview the dossier.
  const SAMPLE_ASSIGNMENT = Object.freeze({
    kind: "assignment",
    title: "Research Essay: Ethics in Technology",
    item: { id: "assignment:dev:sample", courseId: "dev-preview" },
    instructions: "The instructor didn't add instructions in D2L.",
    files: [{ name: "Essay_Guidelines_and_Rubric.pdf", downloadUrl: "https://example.edu/d2l/files/Essay_Guidelines.pdf" }],
    links: [{ label: "Open assignment in D2L", url: "https://example.edu/d2l/dropbox/1", primary: true }],
    related: [],
    course: { name: "Ethics in Computer Science", code: "CS 3801" },
    facts: [{ k: "Due", v: "Nov 15 at 11:59 PM" }, { k: "Points", v: "100" }]
  });

  const SAMPLE_DOSSIER = Object.freeze({
    key: "dossier-v1|dev|preview-sample",
    state: "ready",
    brief: [
      { text: "Submit a 1,500 to 2,000-word argumentative research paper examining ethical dilemmas in autonomous systems.", source: { name: "Essay_Guidelines_and_Rubric.pdf", url: "https://example.edu/d2l/files/Essay_Guidelines.pdf" }, page: 1 },
      { text: "Must synthesize at least 4 peer-reviewed sources and evaluate competing philosophical frameworks.", source: { name: "Essay_Guidelines_and_Rubric.pdf", url: "https://example.edu/d2l/files/Essay_Guidelines.pdf" }, page: 2 },
      { text: "Include title page, abstract, running head, and references section formatted strictly according to APA 7th edition.", source: { name: "Syllabus_Fall2026.pdf", url: "https://example.edu/d2l/files/Syllabus.pdf" }, page: 5 }
    ],
    requirements: [
      { id: "sample-rule-1", text: "Possible citation style: APA 7th edition", source: { name: "Syllabus_Fall2026.pdf", url: "https://example.edu/d2l/files/Syllabus.pdf" }, page: 5 },
      { id: "sample-rule-2", text: "Possible length: 1,500 - 2,000 words", source: { name: "Essay_Guidelines_and_Rubric.pdf", url: "https://example.edu/d2l/files/Essay_Guidelines.pdf" }, page: 1 },
      { id: "sample-rule-3", text: "Possible file format: PDF", source: { name: "Essay_Guidelines_and_Rubric.pdf", url: "https://example.edu/d2l/files/Essay_Guidelines.pdf" }, page: 3 },
      { id: "sample-rule-4", text: "Deliverable requirement: Minimum 4 peer-reviewed sources", source: { name: "Essay_Guidelines_and_Rubric.pdf", url: "https://example.edu/d2l/files/Essay_Guidelines.pdf" }, page: 2 }
    ],
    sources: [
      { name: "Essay_Guidelines_and_Rubric.pdf", url: "https://example.edu/d2l/files/Essay_Guidelines.pdf", state: "read" },
      { name: "Syllabus_Fall2026.pdf", url: "https://example.edu/d2l/files/Syllabus.pdf", state: "read" }
    ],
    fallbackLinks: [],
    copyText: "Research Essay: Ethics in Technology\n\nBrief:\n- Submit a 1,500 to 2,000-word argumentative research paper examining ethical dilemmas in autonomous systems.\n- Must synthesize at least 4 peer-reviewed sources and evaluate competing philosophical frameworks.\n\nRequirements:\n[ ] Possible citation style: APA 7th edition\n[ ] Possible length: 1,500 - 2,000 words\n[ ] Possible file format: PDF\n[ ] Deliverable requirement: Minimum 4 peer-reviewed sources",
    checks: {}
  });

  function openSampleDossier() {
    const doc = global.document;
    if (!doc) return;

    // Use full preview dialog container
    let container = doc.getElementById("sample-dossier-preview-dialog");
    if (!container) {
      container = doc.createElement("div");
      container.id = "sample-dossier-preview-dialog";
      container.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);z-index:99999;display:grid;place-items:center;padding:20px;overflow-y:auto;";
      doc.body.appendChild(container);
    }

    const dossierHtml = assignmentDossierHtml(SAMPLE_DOSSIER);
    container.innerHTML = `
      <div style="background:var(--surface,#ffffff);color:var(--ink,#1e2022);max-width:760px;width:100%;max-height:90vh;overflow-y:auto;border-radius:12px;border:1px solid var(--border,#d0d7de);box-shadow:0 12px 40px rgba(0,0,0,0.25);padding:24px;position:relative;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid var(--border,#e1e4e8);padding-bottom:14px;margin-bottom:18px;">
          <div>
            <div style="font-size:12px;font-weight:600;text-transform:uppercase;color:var(--accent,#0066cc);letter-spacing:0.04em;">${escape(SAMPLE_ASSIGNMENT.course.code)} · ${escape(SAMPLE_ASSIGNMENT.course.name)}</div>
            <h1 style="font-size:20px;margin:4px 0 0;font-weight:700;">${escape(SAMPLE_ASSIGNMENT.title)}</h1>
          </div>
          <button type="button" class="btn" data-close-sample style="padding:6px 12px;font-size:14px;font-weight:600;cursor:pointer;">✕ Close Preview</button>
        </div>
        <div>
          <h2 style="font-size:15px;margin:0 0 6px;">LMS Instructions (from D2L)</h2>
          <p style="color:var(--muted,#656d76);font-size:13px;margin:0 0 16px;">${escape(SAMPLE_ASSIGNMENT.instructions)}</p>
          <div style="margin-bottom:16px;">
            <span style="font-size:12px;font-weight:600;">Attached Document: </span>
            <a href="${escape(SAMPLE_ASSIGNMENT.files[0].downloadUrl)}" style="color:var(--accent,#0066cc);font-size:13px;" target="_blank" rel="noopener noreferrer">${escape(SAMPLE_ASSIGNMENT.files[0].name)}</a>
          </div>
        </div>
        ${dossierHtml}
      </div>
    `;
    container.removeAttribute("hidden");

    const close = () => {
      container.setAttribute("hidden", "true");
      doc.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    container.onclick = (e) => {
      if (e.target === container || e.target.closest("[data-close-sample]")) close();
    };
    doc.addEventListener("keydown", onKey);
  }

  // Press & hold profile button (1.5 seconds) to reveal Dev Menu
  function initProfileHoldDevMenu() {
    const doc = global.document;
    if (!doc?.addEventListener || doc.__profileDevMenuBound) return;
    doc.__profileDevMenuBound = true;

    let holdTimer = null;
    let holdTriggered = false;

    function createDevModal() {
      let modal = doc.getElementById("dev-menu-modal");
      if (modal) return modal;
      modal = doc.createElement("div");
      modal.id = "dev-menu-modal";
      modal.className = "dev-menu-overlay";
      modal.setAttribute("hidden", "true");
      modal.innerHTML = `
        <div class="card dev-menu-card" role="dialog" aria-modal="true" aria-labelledby="dev-menu-title">
          <div class="dev-menu-header">
            <h2 id="dev-menu-title" style="margin:0;font-size:16px;">Developer Tools</h2>
            <button type="button" class="btn" data-dev-action="close" aria-label="Close Developer Menu">&times;</button>
          </div>
          <p class="prose" style="font-size:13px;color:var(--muted);margin:8px 0 16px;">
            Quick actions to test and preview features without waiting for real LMS sync data.
          </p>
          <div style="display:grid;gap:10px;">
            <button type="button" class="btn btn-primary" data-dev-action="open-sample-dossier" style="justify-content:flex-start;padding:10px 14px;text-align:left;">
              <div>
                <b style="display:block;font-size:13px;">Preview Assignment Dossier</b>
                <span style="font-size:12px;opacity:0.85;font-weight:normal;">Opens an assignment with an attached PDF brief and checklist</span>
              </div>
            </button>
          </div>
        </div>
      `;
      doc.body.appendChild(modal);

      modal.addEventListener("click", (e) => {
        if (e.target === modal || e.target.closest('[data-dev-action="close"]')) {
          modal.setAttribute("hidden", "true");
        } else if (e.target.closest('[data-dev-action="open-sample-dossier"]')) {
          modal.setAttribute("hidden", "true");
          try {
            openSampleDossier();
          } catch (err) {
            console.error("Failed to open sample dossier:", err);
            alert("Error opening dossier preview: " + (err.message || err));
          }
        }
      });
      return modal;
    }

    // Keyboard shortcut (Shift + D) as an immediate, reliable trigger
    doc.addEventListener("keydown", (e) => {
      if (e.key === "D" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = doc.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const modal = createDevModal();
        modal.removeAttribute("hidden");
      }
    });

    // Hold profile button (mousedown / touchstart)
    const onStart = (e) => {
      const button = e.target.closest("#profile-button");
      if (!button) return;
      holdTriggered = false;
      holdTimer = setTimeout(() => {
        holdTriggered = true;
        const modal = createDevModal();
        modal.removeAttribute("hidden");
        dash.appModules?.closeMenu?.();
      }, 800);
    };

    const onEnd = (e) => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (holdTriggered && e.type === "click") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    doc.addEventListener("mousedown", onStart, true);
    doc.addEventListener("touchstart", onStart, { capture: true, passive: true });
    doc.addEventListener("mouseup", onEnd, true);
    doc.addEventListener("touchend", onEnd, true);
    doc.addEventListener("click", onEnd, true);
  }

  Object.assign(dash, { createAssignmentDossier, assignmentDossierHtml, mountAssignmentDossier, dossierCandidates: candidatesFor, openSampleDossier });
  addPlaceholder(dash.detailBody);
  watchAssignmentDetails();
  initProfileHoldDevMenu();
})(globalThis);
