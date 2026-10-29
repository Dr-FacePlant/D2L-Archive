// Dashboard overview, course cards, first run and study banner.
(function initDashboardRenderDashboard(global) {
  const dash = global.D2LDashboard ||= {};
  const { KIND_ICON, dateBox, emptyState, escapeHtml: e, fmtShortDate, icon, instructorNames, plural } = dash;
  // ------------------------------------------------------------ dashboard

  function workRow(item, options = {}) {
    return `<a class="row" href="${e(item.route)}" data-entity="${e(item.id)}">
      ${dateBox(item.parts, item.count)}
      <span class="ico">${icon(KIND_ICON[item.kind] || "doc", 22)}</span>
      <span class="grow"><span class="title">${e(item.title)}</span><span class="meta">${e([item.typeLabel, options.hideCourse ? "" : item.course?.code, options.hideCourse ? item.points : item.course?.name].filter(Boolean).join("  ·  "))}</span></span>
      <span class="aside">${e(item.dueLine)}${options.rel && item.rel && !item.count ? `<br>${e(item.rel)}` : ""}</span>
      <span class="chev">${icon("chevronRight", 16)}</span>
    </a>`;
  }

  function updateRow(update, big = false, more = false) {
    return `<div class="row compact" data-update="${e(update.id)}"${more ? " hidden data-more" : ""}>
      <span class="dot-unread ${update.unread ? "on" : ""}" aria-label="${update.unread ? "New" : ""}"></span>
      <span class="ico">${icon(update.icon, 21)}</span>
      <a class="grow" href="${e(update.route || "#/updates")}" data-action="read-update" data-update-id="${e(update.id)}" style="color:inherit;text-decoration:none">
        <span class="title plain ${update.unread ? "unread" : ""}">${e(update.label)}</span>
        <span class="meta">${e(update.sub)}</span>
      </a>
      <span class="aside">${e(update.ago)}</span>
      ${big ? `<button class="link-btn" type="button" data-action="toggle-read" data-update-id="${e(update.id)}">${update.unread ? "Mark read" : "Mark unread"}</button>` : ""}
    </div>`;
  }

  function courseCard(card, big = false) {
    const banner = `<div class="course-banner" style="background:${e(card.tint)}">${card.image ? `<img src="${e(card.image)}" alt="" draggable="false">` : ""}</div>`;
    const progress = card.completion
      ? `<div class="progress" title="D2L content completion"><div class="bar"><i style="width:${card.completion.pct}%;background:${e(card.color)}"></i></div><span>${e(card.progressLabel)}</span></div>`
      : "";
    const next = card.next
      ? `<div class="next-up"><span class="lbl">NEXT UP</span><span class="t">${e(card.next.title)}</span><span class="d">${e(card.next.due)}</span></div>`
      : `<div class="next-up"><span class="d">No upcoming work</span></div>`;
    const facts = big ? `<div class="course-facts">
        <div>${icon("user", 16)} ${instructorNames(card.instructors)}</div>
        <div>${icon("calendar", 16)} ${e([card.term, card.section].filter(Boolean).join(" · "))}</div>
      </div>` : "";
    return `<a class="course-card" href="${e(card.route)}" data-course="${e(card.courseId)}">
      ${banner}
      <div class="body">
        <div class="course-code" style="color:${big ? e(card.ink) : "inherit"}">${e(card.code || [card.term, card.section].filter(Boolean).join(" · "))}</div>
        <div class="course-name">${e(card.name)}</div>
        <div class="course-grade" aria-hidden="true"></div>
        ${facts}
        ${progress}
        ${next}
      </div>
    </a>`;
  }

  function dashboardGradeSparkline(card) {
    if (!card.chart?.length) return `<div class="grade-spark-empty">Not enough dated scores yet</div>`;
    const points = card.chart.map((point) => ({ ...point, x: 30 + point.x * 2.02, y: 12 + (100 - point.y) * .76 }));
    const line = points.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" ");
    const last = points.at(-1);
    const gradient = `grade-fill-${encodeURIComponent(card.courseId)}`;
    return `<svg class="grade-spark" viewBox="0 0 244 102" role="img" aria-label="Recent individual grade item scores, not overall course grade history">
      <defs><linearGradient id="${e(gradient)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--spark)" stop-opacity=".24"/><stop offset="100%" style="stop-color:var(--spark)" stop-opacity="0"/></linearGradient></defs>
      ${[0, 1, 2].map((i) => `<line class="grade-grid-line" x1="30" x2="232" y1="${12 + i * 38}" y2="${12 + i * 38}"/><text x="22" y="${15 + i * 38}" text-anchor="end">${e(card.chartMax - i * (card.chartMax - card.chartMin) / 2)}</text>`).join("")}
      <path d="${line} L${last.x},88 L${points[0].x},88 Z" fill="url(#${e(gradient)})"/>
      <path class="grade-spark-line" d="${line}"/>
      ${points.map((point) => `<circle class="grade-score-dot" cx="${point.x}" cy="${point.y}" r="3"><title>${e(`${point.title}: ${point.label}`)}</title></circle>`).join("")}
      <circle class="grade-end-halo" cx="${last.x}" cy="${last.y}" r="7"/>
      <circle class="grade-end-dot" cx="${last.x}" cy="${last.y}" r="4"/>
    </svg><div class="grade-chart-dates"><span>${e(card.chartStart)}</span><span>${e(card.chartEnd)}</span></div>`;
  }

  function dashboardGradeCard(card, options = {}) {
    const value = card.grade?.value || "—";
    const selected = options.selected === true;
    return `<a class="grade-widget-main${options.compact ? " grade-overview-card" : ""}" href="${e(card.route)}" data-course="${e(card.courseId)}"${selected ? ` aria-current="page"` : ""} aria-label="${e(`${card.label}: ${card.gradeText}. ${card.grade?.label || ""}. Open course grades`)}">
      <div class="grade-widget-head">
        <span class="grade-book">${icon("book", 21)}</span>
        <span class="grade-widget-title"><b title="${e(card.name)}">${e(card.label)}</b><small>Current grade</small></span>
      </div>
      <div class="grade-widget-body">
        <div class="grade-number${value.length > 6 ? " grade-number-long" : ""}">${e(value.replace(/\s+%$/, "%"))}</div>
        ${card.letter ? `<div class="grade-letter" title="Letter grade published by D2L">${e(card.letter)}</div>` : ""}
      </div>
      <div class="grade-widget-detail" title="${e(card.grade?.explanation || "")}">${e(card.grade ? [card.grade.label, card.grade.detail].filter(Boolean).join(" · ") : "No final grade yet")}</div>
      <div class="grade-chart-label"><span>Recent scores</span></div>
      <div class="grade-chart">${dashboardGradeSparkline(card)}</div>
    </a>`;
  }

  function dashboardGrades(grades) {
    if (!grades.length) return emptyState("No grades yet", "Sync from D2L to see grade snapshots.");
    return `<div class="grade-carousel" aria-label="Grade overview">
      <button class="grade-carousel-btn prev" type="button" data-action="grade-prev" aria-label="Previous grade card" disabled>${icon("chevronLeft", 20)}</button>
      <div class="grade-widget-window">
        <div class="grade-widget">
          ${grades.map(dashboardGradeCard).join("")}
        </div>
      </div>
      <button class="grade-carousel-btn next" type="button" data-action="grade-next" aria-label="Next grade card">${icon("chevronRight", 20)}</button>
    </div>`;
  }

  // Offered when an archive saved before accounts were kept apart has no confirmed owner.
  function adoptLegacyNotice({ name, confirming, pending, error }) {
    const who = e(name || "this account");
    const text = confirming
      ? `<b>Use the older archive for ${who}?</b><br>Only do this if those courses are yours. Nothing is deleted: anything synced to this account so far stays on this computer but stops showing here.`
      : `<b>Older archive found</b><br>This computer has an archive saved before the dashboard kept accounts apart, and it couldn't tell whose it is. If it's yours, you can use it for ${who}.`;
    const buttons = confirming
      ? `<button class="btn btn-primary" type="button" data-action="adopt-legacy-confirm"${pending ? " disabled" : ""}>${pending ? "Switching…" : "Yes, it's mine"}</button><button class="btn" type="button" data-action="adopt-legacy-cancel"${pending ? " disabled" : ""}>Cancel</button>`
      : `<button class="btn" type="button" data-action="adopt-legacy">Use it for my account</button>`;
    return `<div class="banner adopt-legacy" data-adopt-legacy role="status"><span class="grow">${text}${error ? `<br>${e(error)}` : ""}</span>${buttons}</div>`;
  }

  // Shown after the browser erased this account's saved archive and the extension started it again empty.
  function archiveRecreatedNotice({ at }) {
    const when = fmtShortDate(at);
    return `<div class="banner archive-recreated" data-archive-recreated role="status"><span class="grow"><b>Saved archive was erased</b><br>The browser deleted this computer's copy of your D2L data${when ? ` on ${e(when)}` : ""}. Current courses are being synced again from D2L; older history saved only here can't be brought back.</span><button class="btn" type="button" data-action="dismiss-recreated">Dismiss</button></div>`;
  }

  // ----- TEMP STUDY BANNER (replaces the sponsor promo + attention bar) -----
  // Chosen mockup "Option D". To put the original back: restore render.js and
  // dashboard.css from _backup-dashboard-before-study-banner-2026-10-19, or
  // undo the two spots marked TEMP in this file.
  function studyChip(item) {
    const c = item?.count;
    const p = item?.parts;
    if (!c && !p?.day) return "";
    const route = typeof item?.route === "string" && item.route.startsWith("#/") ? item.route : "";
    const tag = route ? "a" : "div";
    const when = c ? (c.late ? "overdue" : `due in ${c.n} ${c.unit}`) : `due ${p.mon} ${p.day}`;
    const aria = route ? ` href="${e(route)}" aria-label="${e(`Open ${item.title || "quiz"}, ${when}`)}"` : "";
    const short = item.title && item.title.length > 34 ? `${item.title.slice(0, 32)}…` : item.title || "";
    if (!c) {
      return `<${tag} class="study-chip"${aria}><b>${e(p.day)}</b><span>${e(`${p.mon} · ${short}`)}</span></${tag}>`;
    }
    const big = `${c.n}${c.letter.toUpperCase()}`;
    const span = c.late ? `late · ${short}` : short;
    return `<${tag} class="study-chip${c.late ? " warn" : ""}"${aria}><b>${e(big)}</b><span>${e(span)}</span></${tag}>`;
  }

  function studyBanner(model) {
    const list = (model.soonQuizzes || []).filter(Boolean);
    const focus = list[0] || null;
    const chips = list.map(studyChip).filter(Boolean).join("");
    const art = `<div class="promo-art" aria-hidden="true"><div class="wedge"></div><div class="panel"></div><div class="glass"></div></div>`;
    if (!focus) {
      return `<section class="promo study-banner" aria-label="Study plan">${art}
        <div class="promo-copy">
          <span class="promo-label">No quizzes or tests ahead</span>
          <h2>Nothing to study for right now.</h2>
          <p>Nothing is coming up to study for — everything else stays in Work.</p>
          <a class="btn btn-primary" href="#/work">See work ${icon("chevronRight", 16)}</a>
        </div>
      </section>`;
    }
    return `<section class="promo study-banner" aria-label="Study plan">${art}
      ${chips ? `<div class="study-chips">${chips}</div>` : ""}
      <div class="promo-copy">
        <span class="promo-label">Upcoming quizzes &amp; tests</span>
        <h2>Time to hit the books.</h2>
        <div class="prow"><a class="btn btn-primary" href="${e(focus.route)}">Get to studying</a></div>
      </div>
      <a class="study-lnk" href="#/work?type=quiz">All quizzes &amp; tests ${icon("arrowRight", 15)}</a>
    </section>`;
  }
  // ----- end TEMP STUDY BANNER -----

  function attentionBar(model) {
    if (!model.attention) return "";
    const line = `${plural(model.attention, "graded item")} ${model.attention === 1 ? "needs" : "need"} attention: late, or closing within 3 days and not turned in`;
    return `<a class="attention-bar" href="#/work?tab=attention">${icon("clock", 18)}<span>${e(line)}</span>${icon("arrowRight", 16)}</a>`;
  }

  function dashboardPage(model, notice = "") {
    if (!model.hasArchive) return firstRunPage(notice);
    return `<div class="page" data-screen="dashboard">
      ${notice}
      ${studyBanner(model)}
      ${attentionBar(model)}
      <div class="cols dashboard-overview">
        <section class="card card-pad wide" aria-labelledby="h-next">
          <div class="card-head"><h2 id="h-next">What's next</h2><a class="link-btn" href="#/work">View all ${icon("arrowRight", 15)}</a></div>
          ${model.next.length ? model.next.map((item) => workRow(item)).join("") : emptyState("You're all caught up.", "Nothing open is due in your archived courses.")}
        </section>
        <section class="card card-pad side" aria-labelledby="h-updates">
          <div class="card-head"><h2 id="h-updates">Recent updates</h2><a class="link-btn" href="#/updates">View all ${icon("arrowRight", 15)}</a></div>
          ${model.updates.length ? model.updates.map((update) => updateRow(update)).join("") : emptyState("", "No announcements or grades yet.")}
        </section>
      </div>
      <div class="grade-widget-wrap">
        ${dashboardGrades(model.grades)}
      </div>
    </div>`;
  }

  function firstRunPage(notice = "") {
    return `<div class="page slim" data-screen="first-run">
      ${notice}
      <div class="page-head"><div><h1>Welcome</h1><p>This dashboard shows a copy of your D2L courses that lives on this computer.</p></div></div>
      <section class="card card-body stack">
        <p class="prose">Nothing has been synced yet. Sync opens D2L in a background tab while you're signed in, reads your current courses, and saves them here. It only reads; it never submits, posts, or changes anything in D2L.</p>
        <div><button class="btn btn-primary" type="button" data-action="sync">${icon("sync", 16)} Sync from D2L</button></div>
      </section>
    </div>`;
  }


  Object.assign(dash, {
    workRow, updateRow, courseCard, dashboardGradeSparkline, dashboardGradeCard, dashboardGrades, adoptLegacyNotice, archiveRecreatedNotice, studyChip, studyBanner, dashboardPage, firstRunPage
  });
})(globalThis);
