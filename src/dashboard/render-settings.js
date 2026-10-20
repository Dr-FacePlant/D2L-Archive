// Settings, About and shell pages.
(function initDashboardRenderSettings(global) {
  const dash = global.D2LDashboard ||= {};
  const { emptyState, escapeHtml: e, fmtDateTime, icon, plural, pressed, statusMark } = dash;
  // ------------------------------------------------------------- settings

  // Settings opens over the current page, like an assignment, with its
  // sections listed on the left (#/settings/<section>).
  const SETTINGS_SECTIONS = Object.freeze([
    ["appearance", "Appearance", "palette"],
    ["courses", "Courses", "book"],
    ["sync", "Sync", "sync"],
    ["activity", "Activity history", "clock"],
    ["storage", "Storage", "storage"],
    ["about", "About", "help"]
  ]);

  function settingsSectionName(name) {
    return SETTINGS_SECTIONS.some(([key]) => key === name) ? name : "appearance";
  }

  function settingsNav(section) {
    return SETTINGS_SECTIONS.map(([key, label, iconName]) => `<a class="settings-tab" href="#/settings/${key}" ${key === section ? 'aria-current="page"' : ""}>${icon(iconName, 18)}${label}</a>`).join("");
  }

  function settingsShell(section = "appearance") {
    return `<div class="detail-layer settings-layer" data-kind="settings" data-action="close-detail" data-backdrop="true">
      <section class="detail-panel settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
        <header class="settings-head">
          <h1 id="settings-title">Settings</h1>
          <button class="icon-btn" type="button" data-action="close-detail" aria-label="Close settings" title="Close settings">${icon("close", 18)}</button>
        </header>
        <div class="settings-frame">
          <nav class="settings-nav" aria-label="Settings sections">${settingsNav(section)}</nav>
          <div class="settings-content" data-detail-body data-screen="settings" data-section="${e(section)}"></div>
        </div>
      </section>
    </div>`;
  }

  const lookButton = (key, value, current, body, extra = "") => `<button ${extra} type="button" data-action="set-look" data-key="${key}" data-value="${e(value)}" ${pressed(current === value)}>${body}</button>`;

  function appearanceSection(model) {
    const { look, choices } = model;
    const backgrounds = Object.entries(choices.BACKGROUNDS);
    const tile = (key, label) => lookButton("background", key, look.background,
      `<span class="tile-color" style="--tile:${key === "image" ? `url(&quot;${e(wallpaperUrl)}&quot;)` : `var(--bg-${key})`}"></span><span>${e(label)}</span>`, `class="tile" aria-label="${e(label)} background"`);
    return `<h2>Appearance</h2>
      <div class="setting-block">
        <div class="setting-name" id="set-theme">Theme</div>
        <div class="seg" role="group" aria-labelledby="set-theme">${Object.entries(choices.THEMES).map(([key, label]) => lookButton("theme", key, look.theme, e(label))).join("")}</div>
      </div>
      <div class="setting-block">
        <div class="setting-name" id="set-accent">Accent color</div>
        <div class="swatches" role="group" aria-labelledby="set-accent">${Object.entries(choices.ACCENTS).map(([key, label]) => lookButton("accent", key, look.accent, "", `class="swatch" style="--swatch:var(--accent-${key})" aria-label="${e(label)}" title="${e(label)}"`)).join("")}</div>
      </div>
      <div class="setting-block">
        <div class="setting-name" id="set-background">Background</div>
        <div class="tiles" role="group" aria-labelledby="set-background">${backgrounds.map(([key, label]) => tile(key, label)).join("")}</div>
      </div>`;
  }

  function coursesSection(model) {
    return `<h2>Courses</h2>
      <p>Hidden courses stay in the archive but leave the dashboard and are skipped by Sync.</p>
      ${model.courses.length ? model.courses.map((course) => `<div class="setting"><div class="l"><b>${e(course.label)}</b><span>${e(course.title)}${course.defaultHidden ? " · not in the current term" : ""}</span></div><button class="switch" type="button" role="switch" data-action="toggle-course" data-course="${e(course.courseId)}" aria-checked="${model.visible.has(course.courseId)}" aria-label="${e(`Show ${course.label}`)}"></button></div>`).join("") : emptyState("", "No courses yet. Sync first.")}`;
  }

  function syncSection(model) {
    return `<h2>Sync</h2>
      <div class="setting"><div class="l"><b>${e(model.sync.label)}</b><span>Sync reads your courses from D2L in a background tab. Files already in your archive are reused.</span></div><button class="btn btn-primary" type="button" data-action="sync">${icon("sync", 16)} Sync now</button></div>
      <div class="setting"><div class="l"><b>Download course files</b><span>Save files from your courses into your archive. When off, Sync refreshes course data only and files already saved stay linked.</span></div><button class="switch" type="button" role="switch" data-action="toggle-download-files" aria-checked="${model.settings.downloadCourseFiles === true}" aria-label="Download course files"></button></div>
      <div class="setting"><div class="l"><b>Automatic refresh</b><span>Brief refreshes keep course data current. Course files download only when Download course files is on.</span></div>${statusMark({ key: "completed", label: "Enabled" })}</div>
      ${model.sync.partialCategories?.length ? `<div class="banner warn"><b>Partial areas</b><br>${e(model.sync.partialCategories.join(", "))} will be retried on a later sync.</div>` : ""}
      <div class="setting"><div class="l"><b>Remind me to sync</b><span>The top bar turns yellow when your copy is older than this.</span></div>
        <select class="field" style="width:auto" data-action="set-reminder" aria-label="Remind me to sync">${[[12, "After 12 hours"], [24, "After 1 day"], [72, "After 3 days"], [0, "Never"]].map(([value, label]) => `<option value="${value}" ${Number(model.settings.reminderHours ?? 24) === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>`;
  }

  function sizeLabel(bytes) {
    if (!bytes) return "0 KB";
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function storageSection(model) {
    const previews = model.storage?.previews;
    return `<h2>Storage</h2>
      <div class="setting"><div class="l"><b>Saved previews</b><span>${previews ? `${e(plural(previews.count, "file"))} · ${sizeLabel(previews.bytes)}. ` : ""}Files you open in Preview are kept on this computer so they open faster. The oldest go first after 300 MB.</span></div><button class="btn" type="button" data-action="clear-previews" ${previews?.count ? "" : "disabled"}>Clear</button></div>`;
  }

  function activitySection(model) {
    const events = model.activity?.items || [];
    const summary = model.activitySummary || {};
    const statusText = Object.entries(summary.byStatus || {}).map(([key, value]) => `${value} ${key}`).join(" · ") || "No events yet";
    const rows = events.length ? events.map((event) => `<div class="setting activity-row"><div class="l"><b>${e(event.operation)}</b><span>${e([event.status, event.source, event.courseId && `Course ${event.courseId}`].filter(Boolean).join(" · "))}${event.error ? ` · ${e(event.error)}` : ""}</span></div><time datetime="${e(event.timestamp)}">${e(fmtDateTime(event.timestamp))}</time></div>`).join("") : emptyState("No activity yet", "Syncs and local changes will appear here.");
    return `<h2>Activity history</h2>
      <p class="prose">A local record of syncs, downloads, exports, recovery events, and changes made in this dashboard. It does not contain passwords, tokens, or private message bodies.</p>
      <div class="banner"><b>${e(String(summary.total || 0))} recorded events</b><br>${e(statusText)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button class="btn" type="button" data-action="export-activity" data-format="json">Export JSON</button><button class="btn" type="button" data-action="export-activity" data-format="csv">Export CSV</button></div>
      <div class="stack" style="gap:0;margin-top:12px">${rows}</div>`;
  }

  function aboutSection() {
    return `<h2>About</h2>
      <p class="prose" style="font-size:13.5px;margin-top:10px">D2L Archive is not affiliated with, endorsed by, or made by Kennesaw State University or D2L. It reads the D2L pages you can already see, saves them on this computer, and never submits, posts, or changes anything in D2L.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><a class="btn" href="#/about">How this dashboard is paid for</a><a class="btn" href="popup.html" target="_blank" rel="noopener">Extractor tools (advanced)</a></div>`;
  }

  function settingsSection(model) {
    const section = settingsSectionName(model.section);
    if (section === "courses") return coursesSection(model);
    if (section === "sync") return syncSection(model);
    if (section === "storage") return storageSection(model);
    if (section === "activity") return activitySection(model);
    if (section === "about") return aboutSection(model);
    return appearanceSection(model);
  }

  function aboutPage() {
    return `<div class="page slim" data-screen="about">
      <div class="page-head"><div><h1>About</h1><p>An archive of your D2L courses that stays on your computer</p></div></div>
      <section class="card card-body stack">
        <p class="prose">This dashboard is free. It keeps your D2L data on your own computer and never sends your courses, grades, or anything else it reads to anyone.</p>
        <p class="prose">Course files are downloaded only when Download course files is on in Settings. Everything else stays in your browser's own archive.</p>
        <p class="prose" style="font-size:13px;color:var(--muted)">Not affiliated with Kennesaw State University or D2L.</p>
      </section>
    </div>`;
  }


  Object.assign(dash, {
    settingsSectionName, settingsNav, settingsShell, appearanceSection, coursesSection, syncSection, sizeLabel, storageSection, activitySection, aboutSection, settingsSection, aboutPage, SETTINGS_SECTIONS, lookButton
  });
})(globalThis);
