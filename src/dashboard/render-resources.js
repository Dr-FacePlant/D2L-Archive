// Resources page.
(function initDashboardRenderResources(global) {
  const dash = global.D2LDashboard ||= {};
  const { emptyState, escapeHtml: e, selectMenu, icon, plural } = dash;
  // ------------------------------------------------------------ resources

  // One control per topic: the whole row previews a file, opens the course
  // link, or opens the topic in D2L. A file is a topic D2L hands over as a
  // file, or one with a saved copy. The icon on the right is only a marker
  // of where the row goes; it is never a second hit area.
  function resourceRow(item, highlight) {
    const typeIcon = item.icon || "doc";
    const file = !item.external && (item.localPath || dash.isTopicFileUrl(item.downloadUrl));
    const meta = e([item.type, item.dates, item.exempt ? "Exempt" : ""].filter(Boolean).join(" · "));
    const body = `<span class="ico">${icon(typeIcon, 20)}</span>
      <span class="grow"><span class="title plain">${e(item.title)}</span><span class="meta">${meta}</span></span>
      <span class="row-icon" aria-hidden="true">${icon(file ? "eye" : "external", 16)}</span>`;
    const id = `id="${e(item.id)}" style="${highlight === item.id ? "background:var(--cal-selected)" : ""}" data-entity="${e(item.id)}"`;
    const fileData = `data-path="${e(item.localPath || "")}" data-name="${e(item.title)}" data-d2l="${e(item.d2lUrl || "")}" data-download="${e(item.downloadUrl || "")}"`;
    // A file row stays a link to its D2L page, so a modified click still
    // opens D2L in a new tab; a plain click previews it here.
    if (file && item.d2lUrl) {
      return `<a class="row compact resource-row" ${id} href="${e(item.d2lUrl)}" ${fileData} data-preview>${body}<span class="sr-only"> Previews the file.</span></a>`;
    }
    if (file) {
      return `<button class="row compact resource-row" type="button" ${id} data-action="preview-file" ${fileData}>${body}<span class="sr-only"> Previews the file.</span></button>`;
    }
    if (item.external) {
      return `<a class="row compact resource-row" ${id} href="${e(item.external)}" rel="noopener noreferrer" data-confirm-external="${e(item.title)}">${body}<span class="sr-only"> Opens an external site.</span></a>`;
    }
    if (item.d2lUrl) {
      return `<a class="row compact resource-row" ${id} href="${e(item.d2lUrl)}" rel="noopener noreferrer" data-d2l-link data-confirm-title="${e(item.title)}">${body}<span class="sr-only"> Opens in D2L.</span></a>`;
    }
    return `<div class="row compact resource-row resource-static" ${id}>${body}</div>`;
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
          ${module.d2lUrl ? `<div class="module-foot"><a class="link-btn" href="${e(module.d2lUrl)}" rel="noopener noreferrer" data-d2l-link>Open module in D2L ${icon("external", 14)}</a></div>` : ""}
        </details>`).join("") : emptyState("No content", "This course has no content in the archive.")}
    </div>`;
  }


  Object.assign(dash, {
    resourceRow, resourcesPage
  });
})(globalThis);
