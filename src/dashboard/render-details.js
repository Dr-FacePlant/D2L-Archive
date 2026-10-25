// Detail pages and file preview.
(function initDashboardRenderDetails(global) {
  const dash = global.D2LDashboard ||= {};
  const { STEP_MARK, escapeHtml: e, extLink, fileRow, fmtDateTime, icon, notFoundPage, plural, rubricTable } = dash;
  // ---------------------------------------------------------- detail pages

  const HIDEABLE_KINDS = new Set(["assignment", "quiz", "discussion"]);
  const TYPE_LABEL = Object.freeze({ assignment: "Assignment", quiz: "Quiz", discussion: "Discussion", task: "Checklist task", checklist: "Checklist", announcement: "Announcement", grade: "Grade", event: "Calendar event" });
  const WORK_KINDS = new Set(["assignment", "quiz", "discussion", "task", "checklist"]);
  const STEP_WORD = Object.freeze({ done: "Done", todo: "To do", late: "Late", missed: "Missed", closed: "Closed" });

  // Under a step that follows a discussion: which topic it watches.
  function followNote(link) {
    const topic = `<a href="${e(link.route)}">${e(link.title)}</a>`;
    if (link.done) return `Follows your posts in ${topic}.`;
    if (!link.known) return `D2L hides the posts in ${topic} for now, so tick it yourself.`;
    const shows = link.role === "thread" ? "your thread" : link.role === "reply" ? (link.needed > 1 ? `${link.needed} replies` : "your reply") : "your thread and replies";
    return `Ticks itself when D2L shows ${shows} in ${topic}.`;
  }

  // One row of a to-do card: a mark (or a tick box), what to do, and when.
  function stepRow(item, model) {
    const note = item.linked ? followNote(item.linked) : item.note ? e(item.note) : "";
    const body = `<span class="step-body"><span class="step-what">${e(item.what)}</span>${item.when ? `<span class="step-when">${e(item.when)}</span>` : ""}${note ? `<span class="step-note">${note}</span>` : ""}</span>`;
    if (item.state === "tick") {
      const checked = Boolean(model.checklistDone?.[item.taskId]);
      return `<label class="step tick${checked ? " is-checked" : ""}" data-checklist-item="${e(item.taskId)}"><input type="checkbox" data-action="toggle-checklist" data-task-id="${e(item.taskId)}"${checked ? " checked" : ""}>${body}</label>`;
    }
    return `<div class="step ${e(item.state)}"><span class="step-mark">${STEP_MARK[item.state] || ""}</span><span class="sr-only">${e(STEP_WORD[item.state] || "")}: </span>${body}</div>`;
  }

  function stepList(model) {
    return model.steps?.length ? `<div class="steps">${model.steps.map((item) => stepRow(item, model)).join("")}</div>` : "";
  }

  // The student's own close-out for work the dashboard can't see is done
  // (handled another way) or that doesn't apply to them: one quiet line at
  // the foot of the to-do card. Only this dashboard changes; D2L doesn't.
  // Work D2L already counts as done gets no line, unless it was marked, so
  // the mark can be undone.
  function hideLine(model) {
    if (!HIDEABLE_KINDS.has(model.kind) || !model.item?.id) return "";
    const mark = model.hiddenWork?.[model.item.id];
    if (!mark && model.item.done) return "";
    const id = e(model.item.id);
    const tip = `title="Only this dashboard changes. D2L doesn't."`;
    if (mark) return `<p class="quiet" data-hide-card ${tip}>${mark.reason === "done" ? "Marked done by you" : "Skipped by you"}<span class="sep" aria-hidden="true">·</span><button class="link-btn" type="button" data-action="unmark-work" data-entity-id="${id}">Undo</button></p>`;
    return `<p class="quiet" data-hide-card ${tip}>Done another way? <button class="link-btn" type="button" data-action="mark-done" data-entity-id="${id}">Mark as done</button><span class="sep" aria-hidden="true">·</span><button class="link-btn" type="button" data-action="skip-work" data-entity-id="${id}">Hide from Needs attention</button></p>`;
  }

  // A smaller D2L link under the to-do card's one button.
  function moreLink(link) {
    return `<a class="link-btn" href="${e(link.url)}" rel="noopener noreferrer" data-d2l-link>${e(link.label)} ${icon("external", 14)}</a>`;
  }

  // The to-do card: the steps, one button, smaller links, the quiet line.
  // The button jumps to the linked discussion when there is one, else to
  // D2L. Nothing is submitted from here.
  function todoCard(model) {
    const links = model.links || [];
    let button = "";
    let more = links;
    if (model.goTo) {
      button = `<a class="btn btn-primary open-d2l" href="${e(model.goTo.route)}">${e(model.goTo.label)} ${icon("arrowRight", 15)}</a>`;
    } else if (links[0]) {
      button = extLink(links[0]);
      more = links.slice(1);
    }
    const score = model.kind === "assignment" && model.score ? `<div class="big-score"><b>${e(model.score)}</b>${model.grade?.displayed && model.grade.displayed.replace(/\s+/g, "") !== model.score.replace(/\s+/g, "") ? `<span>${e(model.grade.displayed)}</span>` : ""}</div>` : "";
    const extras = [
      model.grade ? `<a class="link-btn" href="${e(model.grade.route)}">See the grade ${icon("arrowRight", 15)}</a>` : "",
      ...more.map(moreLink)
    ].filter(Boolean);
    return `<aside class="card side-card todo-card" aria-label="To do">
      ${model.kind === "checklist" ? "" : stepList(model)}
      ${score}
      ${button}
      ${extras.length ? `<div class="todo-links">${extras.join("")}</div>` : ""}
      ${hideLine(model)}
    </aside>`;
  }

  // A checklist's own page: how many are done, then every task as a step.
  function checklistBody(model) {
    const steps = model.steps || [];
    const isDone = (item) => item.state === "tick" ? Boolean(model.checklistDone?.[item.taskId]) : item.state === "done";
    const done = steps.filter(isDone).length;
    const linked = steps.filter((item) => item.state !== "tick").length;
    const hint = done === steps.length ? "Everything is done."
      : linked === steps.length ? "These follow your posts on D2L."
        : linked ? "Tick the rest yourself; tasks tied to a discussion follow D2L."
          : "Tick tasks off as you finish them.";
    return `<div class="checklist-progress" aria-live="polite"><strong>${done} of ${steps.length} done</strong><span>${e(hint)}</span></div>${stepList(model)}`;
  }

  // Related items: side labels and an icon-tile pill per item, with a one-line
  // hover card (also shown on keyboard focus). A Content pill that has
  // something behind it opens the side panel; every other pill is a plain link.
  function relatedPill(item, id) {
    const label = `<span class="rel-tile">${icon(item.icon, 13)}</span><span class="rel-name">${e(item.title)}</span>`;
    const pill = item.peek
      ? `<button class="rel-pill" type="button" data-action="peek-content" data-peek="${e(JSON.stringify(item.peek))}" aria-haspopup="dialog" aria-describedby="${id}">${label}</button>`
      : `<a class="rel-pill" href="${e(item.route)}" aria-describedby="${id}">${label}</a>`;
    return `<span class="rel">${pill}<div class="rel-tip" role="tooltip" id="${id}">${e(item.line)}</div></span>`;
  }

  // Its own card under both columns, so it spans from the content card to the
  // right edge of the to-do card.
  function relatedCard(groups) {
    let count = 0;
    const total = groups.reduce((sum, group) => sum + group.items.length + (group.more?.count || 0), 0);
    return `<section class="card related-card"><h2>Related items <span class="rel-count">${total}</span></h2><div class="related">${groups.map((group) => `<div class="rel-group"><div class="rel-label">${e(group.label)}</div><div class="rel-pills">${group.items.map((item) => relatedPill(item, `rel-tip-${++count}`)).join("")}${group.more ? `<a class="rel-more" href="${e(group.more.route)}">+${e(group.more.count)} more</a>` : ""}</div></div>`).join("")}</div></section>`;
  }

  // The gray line over the title: course, then what kind of item it is.
  function detailMeta(model) {
    const course = model.course;
    const parts = model.meta || [TYPE_LABEL[model.kind], model.forum].filter(Boolean);
    return `<div class="detail-meta">${course ? `<a href="#/course/${encodeURIComponent(course.courseId)}">${e([course.code, course.name].filter(Boolean).join(" · "))}</a>` : ""}${parts.map((part) => `<span>${e(part)}</span>`).join("")}</div>`;
  }

  // Every item's screen: the title card, the content card, and a side card.
  // Work gets the to-do card (steps, one button); on a narrow screen it sits
  // between the title and the content.
  function detailPage(model, crumb) {
    if (!model) return notFoundPage("That item isn't in your archive. It may have been removed from D2L.");
    const course = model.course;
    const sections = [];
    if (model.kind === "assignment") {
      sections.push(`<h2>Instructions</h2>${model.instructions ? `<p class="prose">${e(model.instructions)}</p>` : `<p class="prose" style="color:var(--muted)">The instructor didn't add instructions in D2L.</p>`}`);
      if (model.files.length) sections.push(`<h2>Attached files</h2><div class="file-list">${model.files.map(fileRow).join("")}</div>`);
      if (model.submissions?.length > 1 || model.submittedFiles?.length) sections.push(`<h2>Your submissions</h2><div class="file-list">${(model.submissions || []).map((s) => `<div class="file">${icon("check", 18)}<span class="n">Turned in ${e(s.when || "")}</span><span class="s">${e(plural(s.files, "file"))}</span></div>`).join("")}${(model.submittedFiles || []).map(fileRow).join("")}</div>`);
      for (const entry of model.feedback || []) sections.push(`<h2>Instructor feedback</h2><div class="feedback-box">${entry.score ? `<div class="k">${e(entry.score)}</div>` : ""}${e(entry.text)}</div>`);
      if (model.rubric) sections.push(rubricTable(model.rubric));
      else if (model.rubricNote) sections.push(`<h2>Rubric</h2><p class="prose">${e(model.rubricNote)}. D2L shows it on the assignment page.</p>`);
    }
    if (model.kind === "quiz" && !model.repeatsSettings) {
      sections.push(`<h2>Description</h2>${model.description ? `<p class="prose">${e(model.description)}</p>` : `<p class="prose" style="color:var(--muted)">The instructor didn't add a description in D2L.</p>`}`);
    }
    if (model.kind === "discussion") {
      sections.push(`<h2>Prompt</h2>${model.prompt ? `<p class="prose">${e(model.prompt)}</p>` : `<p class="prose" style="color:var(--muted)">This topic has no written prompt in D2L.</p>`}`);
      if (model.rubric) sections.push(rubricTable(model.rubric));
      if (model.myPosts.length) sections.push(`<h2>Your posts</h2>${model.myPosts.map((post) => `<div class="feedback-box" style="margin-bottom:8px"><div class="k">${e(post.subject)} · ${e(fmtDateTime(post.at))}</div>${e(post.text)}</div>`).join("")}`);
      if (model.allPosts?.length) sections.push(`<h2>Discussion</h2><p class="note">Read-only archive. Post or reply in D2L.</p><div class="discussion-list">${model.allPosts.map((post) => `<article class="discussion-post${post.parentPostId ? " reply" : ""}"><div class="k">${e(post.subject || "Post")} · ${e(post.author || "Unknown author")} · ${e(fmtDateTime(post.at))}</div><p class="prose">${e(post.text)}</p></article>`).join("")}</div>`);
    }
    if (model.kind === "task" && model.description) sections.push(`<p class="prose detail-lead">${e(model.description)}</p>`);
    if (model.kind === "checklist") sections.push(checklistBody(model));
    if (model.kind === "event") {
      sections.push(model.description ? `<h2>Details</h2><p class="prose">${e(model.description)}</p>` : "");
      if (model.target) sections.push(`<h2>Belongs to</h2><a class="btn" href="${e(model.target.route)}">${e(model.target.title)} ${icon("arrowRight", 15)}</a>`);
    }
    if (model.kind === "announcement") {
      sections.push(`<div class="prose" style="margin-top:18px">${e(model.body || "This announcement has no text.")}</div>`);
      if (model.attachments.length) sections.push(`<h2>Attachments</h2><div class="file-list">${model.attachments.map(fileRow).join("")}</div>`);
    }
    if (model.kind === "grade") {
      if (model.marks.length) sections.push(`<p class="detail-marks">${model.marks.map((mark) => `<span>${e(mark)}</span>`).join("")}</p>`);
      sections.push(`<h2>Feedback</h2>${model.feedback.length ? model.feedback.map((text) => `<div class="feedback-box">${e(text)}</div>`).join("") : `<p class="prose" style="color:var(--muted)">No written feedback in D2L.</p>`}`);
      if (model.description) sections.push(`<h2>About this item</h2><p class="prose">${e(model.description)}</p>`);
      if (model.rubric) sections.push(rubricTable(model.rubric));
      if (model.source) sections.push(`<h2>Graded work</h2><a class="btn" href="${e(model.source.route)}">${e(`${model.source.kind}: ${model.source.title}`)} ${icon("arrowRight", 15)}</a>`);
    }

    const relatedBlock = (model.kind === "assignment" || model.kind === "quiz") && model.related?.length ? relatedCard(model.related) : "";

    const work = WORK_KINDS.has(model.kind);
    let sideCard;
    if (work) sideCard = todoCard(model);
    else {
      const side = [];
      if (model.kind === "announcement") side.push(`<h2>From ${e(course?.label || "your course")}</h2><p class="note">${e(model.posted)}${model.pinned ? " · Pinned in D2L" : ""}</p>`);
      if (model.kind === "grade") side.push(`<h2>In D2L</h2><p class="note">Grades are read from D2L. The dashboard never works out its own grade.</p>`);
      if (model.kind === "event") side.push(`<h2>In D2L</h2>`);
      side.push(...(model.links || []).map((link) => extLink(link)));
      sideCard = `<aside class="card side-card">${side.join("")}</aside>`;
    }

    const facts = model.facts?.length ? `<div class="facts">${model.facts.map((fact) => `<div class="fact"><div class="k">${e(fact.k)}</div><div class="v">${e(fact.v)}</div></div>`).join("")}</div>` : "";
    // Assignment and quiz pop-ups keep a steady top row (see .detail-top in the
    // CSS). Their text sits in a clamp that Show more opens, so a long
    // description can't push the Related items card down the page.
    const fixedTop = (model.kind === "assignment" || model.kind === "quiz") && Boolean(facts || sections.length);
    const details = fixedTop && sections.length
      ? `<div class="detail-clamp" id="detail-clamp">${sections.join("")}<button class="detail-more" type="button" data-action="detail-more" aria-expanded="false" aria-controls="detail-clamp" hidden>Show more</button></div>`
      : sections.join("");
    const content = `${facts}${details}`;
    // A checklist's list is its to-do, so only the other work moves its side
    // card up. That card follows the title in the page too, so keyboards and
    // screen readers reach what to do before the details.
    const todoFirst = work && model.kind !== "checklist";
    const main = content ? `<section class="card detail">${content}</section>` : "";
    const top = `<header class="card detail-head">
          ${detailMeta(model)}
          <h1 id="detail-content-title">${e(model.title)}</h1>
          ${model.posted ? `<p class="detail-posted">${e(model.posted)}</p>` : ""}
        </header>
        ${todoFirst ? `${sideCard}${main}` : `${main}${sideCard}`}`;
    const layout = `<div class="detail-frame"><div class="detail-layout${todoFirst ? " has-todo" : ""}${content ? "" : " no-content"}${fixedTop ? " is-fixed" : ""}">
        ${fixedTop ? `<div class="detail-top">${top}</div>` : top}
        ${relatedBlock}
      </div></div>`;
    const body = `<div class="page detail-page" data-screen="${e(model.kind)}">${layout}</div>`;
    if (crumb?.body) return body;
    if (crumb?.layer) return detailShell(crumb, body, model.title);
    return `<div class="page" data-screen="${e(model.kind)}">
      <nav class="crumbs">${crumb.parent ? `<a href="${e(crumb.parent.href)}">${e(crumb.parent.label)}</a><span>/</span>` : ""}<a href="${e(crumb.href)}">${e(crumb.label)}</a><span>/</span><span class="here">${e(model.title)}</span></nav>
      ${layout}
    </div>`;
  }

  function detailShell(context = {}, body = "", title = "") {
    const origin = context.originLabel ? `Back to ${context.originLabel}` : "Back";
    const loaded = Boolean(body);
    return `<div class="detail-layer" data-action="close-detail" data-backdrop="true">
      <section class="detail-panel" role="dialog" aria-modal="true" ${loaded ? `aria-labelledby="detail-content-title"` : `aria-label="Loading details"`} tabindex="-1">
        <header class="detail-layer-head">
          <button class="detail-back" type="button" data-action="detail-back">${icon("chevronLeft", 18)}<span>${e(origin)}</span></button>
          <button class="icon-btn" type="button" data-action="close-detail" aria-label="Close details" title="Close details">${icon("close", 18)}</button>
        </header>
        <div class="detail-layer-scroll" data-detail-body aria-busy="${loaded ? "false" : "true"}">${body}</div>
      </section>
    </div>`;
  }

  function detailBody(model) {
    return detailPage(model, { body: true });
  }

  function detailLayer(model, context = {}) {
    return detailShell(context, detailBody(model), model?.title || "Details");
  }

  // --------------------------------------------------------- file preview

  const PREVIEW_NOTES = Object.freeze({
    loading: "Opening the file…",
    missing: "This file couldn't be loaded from D2L, and it isn't saved on this computer. Sign in to D2L in another tab, then try again.",
    access: "This file couldn't be loaded from D2L. To show the copy saved on this computer instead, open your browser's Extensions page, choose Details under D2L Archive, and turn on “Allow access to file URLs”. Then try again.",
    stale: "The extension was updated after this page opened. Reload the page to keep using it.",
    unsupported: "This kind of file can't be shown inside the browser. Open it on this computer instead.",
    error: "The file couldn't be read."
  });

  function previewBody(view) {
    return view.state === "ready"
      ? view.kind === "pdf" ? `<iframe src="${e(view.src)}" title="${e(view.name || view.title)}"></iframe>`
        : view.kind === "image" ? `<img src="${e(view.src)}" alt="${e(view.name || view.title)}">`
        : view.kind === "video" ? `<video src="${e(view.src)}" controls></video>`
        : view.kind === "audio" ? `<audio src="${e(view.src)}" controls></audio>`
        : `<pre>${e(view.text || "")}</pre>`
      : `<div class="viewer-note">${e(view.message || PREVIEW_NOTES[view.state] || PREVIEW_NOTES.error)}${view.state === "stale" ? `<button class="btn btn-primary" type="button" data-action="reload-page">Reload</button>` : ""}</div>`;
  }

  function filePreview(view) {
    const body = previewBody(view);
    return `<div class="viewer" data-action="close-preview" data-backdrop="true">
      <div class="viewer-panel" role="dialog" aria-modal="true" aria-label="${e(`Preview of ${view.name}`)}">
        <div class="viewer-head">
          ${icon("file", 18)}<b>${e(view.name)}</b>
          ${view.localPath ? `<button class="btn" type="button" data-action="open-file" data-path="${e(view.localPath)}">Open on this computer</button>` : ""}
          ${view.d2lUrl ? `<a class="btn" href="${e(view.d2lUrl)}" rel="noopener noreferrer" data-d2l-link>Open in D2L ${icon("external", 14)}</a>` : ""}
          <button class="icon-btn" type="button" data-action="close-preview" aria-label="Close preview">${icon("close", 18)}</button>
        </div>
        <div class="viewer-body ${e(view.state === "ready" ? view.kind : "note")}">${body}</div>
      </div>
    </div>`;
  }


  // ------------------------------------------- side panel for a Content item

  const PEEK_EXT = Object.freeze({ "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg", "video/mp4": ".mp4", "audio/mpeg": ".mp3" });

  function siteOf(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return ""; }
  }

  // What the panel says when it can't show the item itself. Word and
  // PowerPoint files, links and D2L pages all end here, with Open in D2L.
  function peekNote(view) {
    if (view.state === "unsupported") return "This kind of file can't be shown here. Open it in D2L to read it.";
    if (view.state === "page") return "This is a page in D2L, which can't be shown here yet. Open it in D2L to read it.";
    if (view.state === "link") return `This links to ${siteOf(view.external) || "another site"}, which can't be shown here.`;
    return "";
  }

  function contentPeek(view) {
    const title = e(view.title);
    const message = peekNote(view);
    const open = view.d2lUrl
      ? `<a class="btn btn-primary" href="${e(view.d2lUrl)}" rel="noopener noreferrer" data-d2l-link data-confirm-title="${title}">Open in D2L ${icon("external", 14)}</a>`
      : view.external ? `<a class="btn btn-primary" href="${e(view.external)}" rel="noopener noreferrer" data-confirm-external="${title}">Open link ${icon("external", 14)}</a>` : "";
    const save = view.state === "ready" && view.src ? `<a class="btn" href="${e(view.src)}" download="${e(`${view.title}${PEEK_EXT[view.mime] || ""}`)}">Download</a>` : "";
    const step = (by, label, name) => `<button class="icon-btn" type="button" data-action="peek-step" data-step="${by}" aria-label="${label}" ${view.at + by < 0 || view.at + by >= view.count ? "disabled" : ""}>${icon(name, 18)}</button>`;
    const pager = view.count > 1 ? `<span class="peek-pager">${step(-1, "Previous item", "chevronLeft")}<span aria-live="polite">${view.at + 1} of ${view.count}</span>${step(1, "Next item", "chevronRight")}</span>` : "";
    const meta = [view.module, view.type, view.visited ? "Viewed" : ""].filter(Boolean).join(" · ");
    return `<div class="peek-scrim" data-action="close-peek"></div>
      <aside class="peek" role="dialog" aria-modal="true" aria-label="${e(`Preview of ${view.title}`)}">
        <div class="peek-head">
          <span class="rel-tile big">${icon(view.icon || "doc", 16)}</span>
          <div class="peek-tt"><b>${title}</b>${meta ? `<span>${e(meta)}</span>` : ""}</div>
          <button class="icon-btn" type="button" data-action="close-peek" aria-label="Close preview">${icon("close", 18)}</button>
        </div>
        <div class="peek-bar">${open}${save}${pager}</div>
        <div class="viewer-body peek-body ${e(view.state === "ready" ? view.kind : "note")}">${previewBody(message ? { ...view, message } : view)}</div>
      </aside>`;
  }

  Object.assign(dash, {
    followNote, stepRow, stepList, hideLine, moreLink, todoCard, checklistBody, detailMeta, detailPage, detailShell, detailBody, detailLayer, filePreview, contentPeek, HIDEABLE_KINDS, TYPE_LABEL, WORK_KINDS, STEP_WORD, PREVIEW_NOTES
  });
})(globalThis);
