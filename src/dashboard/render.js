// HTML for every dashboard screen, built from the view models in model.js.
// Pure string functions so the same output can be checked in Node tests.
(function initDashboardRender(global) {
  const dash = global.D2LDashboard ||= {};
  const { escapeHtml: e, fmtShortDate, fmtDateTime, fmtTime, plural } = dash;

  // Icon paths from the mockup's icon set.
  const ICONS = Object.freeze({
    doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5",
    quiz: "M9 3.5h6v3H9z M15 5h2.5A1.5 1.5 0 0 1 19 6.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5H9 M9 12h6 M9 16h4",
    chat: "M20 15.5a2 2 0 0 1-2 2H8.5L4 21V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z M8 9h8 M8 12.5h5",
    task: "M20.5 12a8.5 8.5 0 1 1-4.3-7.4 M20.5 5 12 13.5l-3-3",
    megaphone: "M3.5 10h3l8.5-4.5v13L6.5 14h-3z M7.5 14.3 9 19h2.2l-1.1-4 M18 9.5a3.5 3.5 0 0 1 0 5",
    check: "M20.5 12a8.5 8.5 0 1 1-4.3-7.4 M20.5 5 12 13.5l-3-3",
    book: "M3 5.5A1.5 1.5 0 0 1 4.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4.5A1.5 1.5 0 0 1 3 16z M21 5.5A1.5 1.5 0 0 0 19.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5h5a1.5 1.5 0 0 0 1.5-1.5z",
    calendar: "M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M8 3v4 M16 3v4 M3.5 10h17",
    grade: "M4 20h16 M7 16.5V14 M12 16.5V9.5 M17 16.5V5.5",
    search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M20 20l-4.2-4.2",
    home: "M3.5 10.2 12 3.5l8.5 6.7v9.3a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z",
    bell: "M6 9.5a6 6 0 0 1 12 0c0 5.5 2.5 7 2.5 7h-17S6 15 6 9.5 M10 20a2.2 2.2 0 0 0 4 0",
    work: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 17.5l.6-2.4 4.2-4.2 1.8 1.8-4.2 4.2z",
    folder: "M3.5 7a2 2 0 0 1 2-2h3.6l2 2.2h7.4a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
    file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 16.5h4",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2",
    external: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
    user: "M19 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-7A3.5 3.5 0 0 0 5 18.5V20 M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z",
    mail: "M4 5h16v14H4z M4.5 6l7.5 6 7.5-6",
    copy: "M8 8h11v13H8z M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2",
    users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20 M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35 M15.5 4.6a3.5 3.5 0 0 1 0 6.8",
    pen: "M4 20h4L19.3 8.7a2.1 2.1 0 0 0-3-3L5 17z M14.5 7.5l2 2",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7.5V12l3 2",
    help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.5 M12 17.2h.01",
    settings: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4z",
    sync: "M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4",
    heart: "M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z",
    chevronRight: "m9.5 6 6 6-6 6",
    chevronDown: "m6 9.5 6 6 6-6",
    eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    eyeOff: "M3.5 3.5l17 17 M10.2 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.4 17.4 0 0 1-2.9 3.7 M6.7 6.7C4 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5 M9.9 9.9a3 3 0 0 0 4.2 4.2",
    close: "M6 6l12 12 M18 6 6 18",
    chevronLeft: "m14.5 6-6 6 6 6",
    arrowRight: "M5 12h14M13 6l6 6-6 6",
    zoomIn: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M20 20l-4.2-4.2 M11 8v6 M8 11h6",
    palette: "M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01 M17 11h.01",
    storage: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
    zoomOut: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M20 20l-4.2-4.2 M8 11h6"
  });

  function icon(name, size = 20, extra = "") {
    const path = ICONS[name] || ICONS.doc;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}><path d="${path}"/></svg>`;
  }

  function selectMenu(id, label, selectedKey, options, ariaLabel = label) {
    const selected = options.find((option) => option.key === selectedKey) || options[0];
    return `<div class="select">
      <span class="select-label">${e(label)}</span>
      <button class="select-trigger" type="button" data-action="filter-menu-toggle" aria-label="${e(ariaLabel)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${e(id)}">
        <span>${e(selected?.label || label)}</span>${icon("chevronDown", 15)}
      </button>
      <div class="select-popover" id="${e(id)}" role="listbox" aria-label="${e(ariaLabel)}" hidden>
        ${options.map((option) => `<button class="select-option" type="button" role="option" aria-selected="${selectedKey === option.key}" data-action="filter-menu-option" data-href="${e(option.href)}"><span>${e(option.label)}</span><span class="select-check" aria-hidden="true">${selectedKey === option.key ? icon("check", 15) : ""}</span></button>`).join("")}
      </div>
    </div>`;
  }

  const KIND_ICON = Object.freeze({ assignment: "work", quiz: "quiz", discussion: "chat", task: "task" });

  // The marks a to-do step wears on a detail screen; list rows reuse them.
  // Every mark is a ring. A symbol always comes with a fill: done (check),
  // late ("!") and missed (cross); a ring alone is still going.
  const STEP_MARK = Object.freeze({
    done: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>`,
    late: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" aria-hidden="true"><path d="M12 6v7.5M12 18.5v.01"/></svg>`,
    missed: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`
  });
  const DONE_KEYS = new Set(["graded", "posted", "attempted", "submitted", "completed"]);
  const LATE_KEYS = new Set(["pastDue", "partialLate", "past"]);

  // A status in a list: a step mark beside the word. Done work gets a filled
  // green check, work to do an empty gray ring, partly done work still open
  // an empty amber ring, late work a filled amber "!", missed work a filled
  // red cross, and work that closed without D2L showing whether you did it a
  // gray ring. Work turned in late wears two: "! Late" then "✓ Submitted".
  function statusMark(statusValue) {
    if (!statusValue?.label) return "";
    const one = (state, label) => `<span class="status ${state}"><span class="status-mark">${STEP_MARK[state] || ""}</span><span>${e(label)}</span></span>`;
    if (statusValue.key === "late") return `<span class="status-pair">${one("late", "Late")}${one("done", "Submitted")}</span>`;
    const state = DONE_KEYS.has(statusValue.key) ? "done"
      : statusValue.tone === "bad" || statusValue.key === "partialClosed" ? "missed"
        : LATE_KEYS.has(statusValue.key) ? "late"
          : statusValue.tone === "warn" ? "warn"
            : statusValue.key === "closed" ? "closed" : "todo";
    return one(state, statusValue.label);
  }

  // D2L's grade with D2L's points after it: "100 % (65 / 65)".
  function gradeText(grade) {
    return grade.detail ? `${grade.value} (${grade.detail})` : grade.value;
  }

  // Always takes up its line, so nothing shifts when a name arrives later.
  function instructorNames(names) {
    return names.length ? e(names.join(", ")) : `<span class="not-listed">Not listed yet</span>`;
  }

  // Open work shows how long is left ("in 2 days", "late 2 days"); a tap flips
  // the box to the date and back without opening the row (app.js, flip-date).
  // Screen readers skip the flipping box and read the due line beside it.
  function dateBox(parts, count = null) {
    if (!parts?.day) return `<div class="datebox" aria-hidden="true"><span class="mon">—</span></div>`;
    const date = `<span class="mon">${e(parts.mon)}</span><span class="day">${e(parts.day)}</span><span class="dow">${e(parts.dow)}</span>`;
    if (!count) return `<div class="datebox">${date}</div>`;
    return `<span class="datebox flip${count.late ? " late" : ""}" data-action="flip-date" data-due="${e(count.at)}" title="Tap to see the date" aria-hidden="true"><span class="face cd"><span class="mon">${count.late ? "late" : "in"}</span><span class="day">${e(count.n)}<span class="unit">${e(count.letter)}</span></span></span><span class="face dt">${date}</span></span>`;
  }

  function extLink(link, extraClass = "") {
    if (!link?.url) return "";
    const cls = link.primary ? "btn btn-primary open-d2l" : "btn open-d2l";
    return `<a class="${cls} ${extraClass}" href="${e(link.url)}" rel="noopener noreferrer" data-d2l-link>${e(link.label)} ${icon("external", 15)}</a>`;
  }

  function previewButton(file, label = "Preview") {
    return `<button class="btn" type="button" data-action="preview-file" data-path="${e(file.localPath)}" data-name="${e(file.name)}" data-d2l="${e(file.d2lUrl || file.url || "")}" data-download="${e(file.downloadUrl || "")}">${icon("eye", 16)} ${e(label)}</button>`;
  }

  // A file D2L can hand over, or one with a saved copy, previews here.
  function fileRow(file) {
    const actions = file.localPath || dash.isD2lFileUrl(file.downloadUrl)
      ? previewButton(file)
      : file.url ? `<a class="btn" href="${e(file.url)}" rel="noopener noreferrer">Download from D2L ${icon("external", 14)}</a>` : "";
    return `<div class="file">${icon("file", 18)}<span class="n">${e(file.name)}</span>${file.size ? `<span class="s">${e(file.size)}</span>` : ""}${actions}</div>`;
  }

  // D2L's "View Graded Rubric", as a table.
  function rubricTable(rubric) {
    if (!rubric) return "";
    const head = rubric.assessed
      ? `${e(rubric.name)}${rubric.overallScore != null ? ` · ${e(dash.fmtNumber(rubric.overallScore))} points` : ""}${rubric.overallLevel ? ` · ${e(rubric.overallLevel)}` : ""}`
      : `${e(rubric.name)} · not scored yet`;
    return `<h2>Graded rubric</h2><p style="font-size:13px;color:var(--muted);margin-bottom:8px">${head}</p>
      <div class="card" style="overflow:hidden">${rubric.criteria.map((criterion) => `<div class="table-row" style="cursor:default;min-height:48px">
        <span style="flex:1;min-width:0;font-size:13.5px;color:var(--ink-2)">${e(criterion.name)}${criterion.feedback ? `<span style="display:block;font-size:12.5px;color:var(--muted);margin-top:3px">${e(criterion.feedback)}</span>` : ""}</span>
        <span style="width:110px;flex:none;font-size:13px;color:var(--ink-3)">${e(criterion.level || "—")}</span>
        <span class="col-score">${e(criterion.score != null ? dash.fmtPoints(criterion.score, criterion.outOf) : `- / ${dash.fmtNumber(criterion.outOf)}`)}</span>
      </div>`).join("")}</div>
      ${rubric.overallFeedback ? `<div class="feedback-box" style="margin-top:8px">${e(rubric.overallFeedback)}</div>` : ""}`;
  }

  function emptyState(title, text = "") {
    return `<div class="empty">${title ? `<b>${e(title)}</b>` : ""}${e(text)}</div>`;
  }

  function cardHead(title, link = null, sub = "") {
    return `<div class="card-head"><div><h2>${e(title)}</h2>${sub ? `<div class="sub">${e(sub)}</div>` : ""}</div>${link ? `<a class="link-btn" href="${e(link.href)}">${e(link.label)} ${icon("arrowRight", 15)}</a>` : ""}</div>`;
  }

  const pressed = (value) => `aria-pressed="${value ? "true" : "false"}"`;
  function notFoundPage(text) {
    return `<div class="page slim" data-screen="not-found">${emptyState("Not found", text)}<div style="text-align:center"><a class="btn" href="#/">Back to dashboard</a></div></div>`;
  }

  function loadingPage(text = "Loading your archive…") {
    return `<div class="page slim" data-screen="loading">${emptyState("", text)}</div>`;
  }

  // Shown when D2L has not told the archive which account is signed in: nothing is read.
  function noAccountPage() {
    return `<div class="page slim" data-screen="no-account">${emptyState("Open D2L to continue", "Open your D2L course site in this browser so the archive can tell which account is signed in. Your saved data stays on this device and will appear once your account is known.")}</div>`;
  }

  // A link that leaves the archive asks once before it opens. The destination
  // is named so the choice is concrete, not a generic warning.
  function linkConfirmPanel({ title, domain, kind = "external" }) {
    const d2l = kind === "d2l";
    return `<div class="viewer link-confirm" data-action="close-link-confirm" data-backdrop="true">
      <div class="link-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="link-confirm-title">
        <div class="link-confirm-icon">${icon("external", 20)}</div>
        <h2 id="link-confirm-title">${d2l ? "Open in D2L?" : "Open this link?"}</h2>
        <p>This opens <b>${e(title)}</b> ${d2l ? "in D2L. You'll stay in this tab." : "in this tab."}</p>
        <div class="link-confirm-dest">
          <span class="link-confirm-badge">${icon("external", 16)}</span>
          <span class="grow"><span class="k">${e(domain)}</span><span class="v">${d2l ? "D2L course site" : "External website"}</span></span>
        </div>
        <div class="link-confirm-actions">
          <button class="btn" type="button" data-action="close-link-confirm">Cancel</button>
          <button class="btn btn-primary" type="button" data-action="confirm-link">${d2l ? "Open in D2L" : "Open link"} ${icon("arrowRight", 14)}</button>
        </div>
      </div>
    </div>`;
  }


  Object.assign(dash, {
    icon, selectMenu, statusMark, gradeText, instructorNames, dateBox, extLink, previewButton, fileRow, rubricTable, emptyState, cardHead, notFoundPage, loadingPage, noAccountPage, linkConfirmPanel, ICONS, KIND_ICON, STEP_MARK, DONE_KEYS, LATE_KEYS, pressed
  });
})(globalThis);
