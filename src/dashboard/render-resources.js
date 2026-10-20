// Resources page.
(function initDashboardRenderResources(global) {
  const dash = global.D2LDashboard ||= {};
  const { emptyState, escapeHtml: e, selectMenu, icon, plural, previewButton } = dash;
  // ------------------------------------------------------------ resources

  // One main action per topic: preview the saved file, open the web link, or
  // open the topic in D2L. D2L stays one small icon when it isn't the main one.
  function resourceRow(item, highlight) {
    const typeIcon = item.icon || "doc";
    const main = item.localPath
      ? previewButton({ name: item.title, localPath: item.localPath, d2lUrl: item.d2lUrl, downloadUrl: item.downloadUrl })
      : item.external ? `<a class="btn" href="${e(item.external)}" target="_blank" rel="noopener noreferrer">Open link ${icon("external", 14)}</a>`
      : item.d2lUrl ? `<a class="icon-btn" href="${e(item.d2lUrl)}" target="_blank" rel="noopener noreferrer" data-d2l-link title="Open in D2L" aria-label="Open ${e(item.title)} in D2L">${icon("external", 16)}</a>` : "";
    const d2l = item.d2lUrl && (item.localPath || item.external)
      ? `<a class="icon-btn" href="${e(item.d2lUrl)}" target="_blank" rel="noopener noreferrer" data-d2l-link title="Open in D2L" aria-label="Open ${e(item.title)} in D2L">${icon("external", 16)}</a>`
      : "";
    const actions = main + d2l;
    return `<div class="row compact" id="${e(item.id)}" style="${highlight === item.id ? "background:var(--cal-selected)" : ""}" data-entity="${e(item.id)}">
      <span class="ico">${icon(typeIcon, 20)}</span>
      <span class="grow"><span class="title plain">${e(item.title)}</span><span class="meta">${e([item.type, item.dates, item.exempt ? "Exempt" : ""].filter(Boolean).join(" · "))}</span></span>
      <span class="row-actions">${actions}</span>
    </div>`;
  }

  function resourcesPage(model) {
    return `<div class="page" data-screen="resources">
      <div class="page-head"><div><h1>Content</h1></div></div>
      <div class="toolbar">
        ${selectMenu("resources-course-menu", "Course", model.courseId, model.courseChips.map((chip) => ({ ...chip, href: `#/resources/${encodeURIComponent(chip.key)}` })), "Choose a course")}${model.completion ? `<span class="select-note">${e(`${model.course.label}: ${model.completion.completed} of ${model.completion.required} content items done`)}</span>` : ""}<span class="grow"></span>
        ${model.modules.length > 1 ? `<button class="btn" type="button" data-action="modules" data-open="true">Expand all</button>` : ""}
      </div>
      ${model.pinned.length ? `<details class="card module pinned" open><summary class="module-head">${icon("book", 20)}<h2>Syllabus and course info</h2><span class="sub">${e(plural(model.pinned.length, "item"))}</span><span class="fold">${icon("chevronDown", 18)}</span></summary>${model.pinned.map((item) => resourceRow(item, model.highlight)).join("")}</details>` : ""}
      ${model.modules.length ? model.modules.map((module) => `<details class="card module" id="module-${e(module.id)}"${module.id === model.openModule || module.items.some((item) => item.id === model.highlight) ? " open" : ""}>
          <summary class="module-head">${icon("folder", 20)}<h2>${e(module.title)}</h2><span class="sub">${e([module.topics, module.startsAt, module.completion].filter(Boolean).join(" · "))}</span><span class="fold">${icon("chevronDown", 18)}</span></summary>
          ${module.items.length ? module.items.map((item) => resourceRow(item, model.highlight)).join("") : emptyState("", module.subModules ? "This module's topics are in its sub-modules below." : "No topics in this module.")}
          ${module.d2lUrl ? `<div class="module-foot"><a class="link-btn" href="${e(module.d2lUrl)}" target="_blank" rel="noopener noreferrer" data-d2l-link>Open module in D2L ${icon("external", 14)}</a></div>` : ""}
        </details>`).join("") : emptyState("No content", "This course has no content in the archive.")}
    </div>`;
  }


  Object.assign(dash, {
    resourceRow, resourcesPage
  });
})(globalThis);
