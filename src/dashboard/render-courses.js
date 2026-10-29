// Courses list and course home pages.
(function initDashboardRenderCourses(global) {
  const dash = global.D2LDashboard ||= {};
  const { cardHead, courseCard, emptyState, escapeHtml: e, selectMenu, icon, notFoundPage, plural, statusMark, workRow } = dash;
  // -------------------------------------------------------------- courses

  function coursesPage(model) {
    return `<div class="page" data-screen="courses">
      <div class="page-head"><div><h1>Courses</h1><p>${e(model.subtitle)}</p></div>
        ${selectMenu("courses-term-menu", "Semester", model.selectedTerm, model.termOptions, "Filter courses by semester")}
      </div>
      <div class="course-grid big">${model.courses.map((card) => courseCard(card, true)).join("")}</div>
    </div>`;
  }

  function announcementRow(a) {
    return `<a class="row compact" href="${e(a.route)}"><span class="ico">${icon("megaphone", 20)}</span><span class="grow"><span class="title plain">${e(a.title)}</span><span class="meta">${e(a.date)}</span></span></a>`;
  }

  // Copy, edit and visit are icon-only outlined buttons that stay visible on
  // every row, so each one names itself through aria-label and title.
  function instructorCopyButton(value, label) {
    return `<button class="instructor-copy" type="button" data-action="copy-instructor" data-copy-value="${e(value)}" data-copy-label="${e(label)}" aria-label="Copy ${e(label)}" title="Copy ${e(label)}"${value ? "" : " disabled"}>${icon("copy", 15)}</button>`;
  }

  function instructorEditButton(label) {
    return `<button class="instructor-edit" type="button" data-action="edit-instructor" aria-label="Edit ${e(label)}" title="Edit ${e(label)}">${icon("pen", 15)}</button>`;
  }

  function instructorContactRow({ courseId, index, field, label, iconName, value, copyLabel, editLabel, valueHtml }) {
    return `<div class="instructor-contact-row" data-contact-row data-course-id="${e(courseId)}" data-contact-index="${index}" data-field="${e(field)}" data-edit-value="${e(value)}">
      <span class="ico">${icon(iconName, 16)}</span>
      <span class="instructor-contact-value">${e(label)}: ${valueHtml || (value ? e(value) : "N/A")}</span>
      <span class="instructor-actions">${instructorCopyButton(value, copyLabel)}${instructorEditButton(editLabel)}<span class="sr-only" role="status" data-copy-status></span></span>
    </div>`;
  }

  function syllabusVisitButton(syllabus, courseId) {
    if (!syllabus) return `<button class="instructor-visit" type="button" disabled aria-label="Visit syllabus (not available)" title="No syllabus found">${icon("link", 15)}</button>`;
    if (syllabus.type === "text" || syllabus.type === "file") {
      return `<button class="instructor-visit" type="button" data-action="view-custom-syllabus" data-course-id="${e(courseId)}" aria-label="Visit syllabus: ${e(syllabus.title)}" title="Visit syllabus">${icon("file", 15)}</button>`;
    }
    const targetUrl = syllabus.url || (syllabus.id ? `#/resources/${encodeURIComponent(courseId)}?item=${encodeURIComponent(syllabus.id)}` : `#/resources/${encodeURIComponent(courseId)}`);
    return `<a class="instructor-visit" href="${e(targetUrl)}" aria-label="Visit syllabus: ${e(syllabus.title)}" title="Visit syllabus">${icon("link", 15)}</a>`;
  }

  function instructorContactCard(contacts = [], syllabus = null, courseId = "", syllabusOverride = "") {
    const people = contacts.length ? contacts : [{}];
    const rows = people.map((contact, index) => `<div class="instructor-contact-group">
      ${instructorContactRow({ courseId, index, field: "name", label: "Instructor", iconName: "user", value: contact.name, copyLabel: "instructor name", editLabel: "instructor name" })}
      ${instructorContactRow({ courseId, index, field: "email", label: "Email", iconName: "mail", value: contact.email, copyLabel: "instructor email", editLabel: "instructor email", valueHtml: contact.email ? `<a class="instructor-email" href="mailto:${e(contact.email)}">${e(contact.email)}</a>` : "" })}
      ${instructorContactRow({ courseId, index, field: "officeHours", label: "Office hours", iconName: "clock", value: contact.officeHours, copyLabel: "instructor office hours", editLabel: "office hours" })}
    </div>`).join("");
    const syllabusRow = `<div class="instructor-contact-row instructor-syllabus-row" data-contact-row data-course-id="${e(courseId)}" data-contact-index="0" data-field="syllabus" data-edit-value="${e(syllabusOverride)}"><span class="ico">${icon("book", 16)}</span><span class="instructor-contact-value">Syllabus: ${syllabus ? e(syllabus.title) : "N/A"}</span><span class="instructor-actions">${syllabusVisitButton(syllabus, courseId)}${instructorEditButton("syllabus link")}</span></div>`;
    return `<section class="card instructor-contact-card" aria-label="Instructor and course information">${rows}${syllabusRow}</section>`;
  }

  function courseHomePage(model) {
    if (!model) return notFoundPage("That course isn't in your archive.");
    const c = model.course;
    return `<div class="page" data-screen="course">
      <a class="back-link" href="#/courses" data-course-back>${icon("chevronLeft", 18)}<span>Back to Courses</span></a>
      <div class="course-page-layout">
        <div class="course-main-column stack">
          <section class="card course-header-card">
            <div class="course-banner course-hero" style="background:${e(c.tint)}">${c.image ? `<img src="${e(c.image)}" alt="" draggable="false">` : ""}</div>
            <div class="course-header-body">
              <div class="course-header-meta">
                <div class="course-code" style="color:${e(c.ink)}">${e([c.label, c.term].filter(Boolean).join("  ·  "))}</div>
                <div class="course-title-row"><h1 title="${e(c.title)}">${e(c.name)}</h1>${c.d2lHome ? `<a class="icon-btn" href="${e(c.d2lHome)}" rel="noopener noreferrer" data-d2l-link title="Open in D2L" aria-label="Open ${e(c.name)} in D2L">${icon("external", 18)}</a>` : ""}</div>
                ${c.section ? `<div style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:8px;font-size:13.5px;color:var(--ink-4)"><span>${e(c.section)}</span></div>` : ""}
              </div>
            </div>
          </section>
          <section class="card card-pad sec-upcoming">
            ${cardHead("Upcoming work", { href: `#/work?course=${encodeURIComponent(c.courseId)}`, label: "View all" }, model.upcomingTotal > model.upcomingShown ? `${model.upcomingShown} of ${model.upcomingTotal}` : "")}
            ${model.upcoming.length ? model.upcoming.map((item) => workRow(item, { hideCourse: true, rel: true })).join("") : emptyState("", "No upcoming work in this course.")}
          </section>
          <section class="card card-pad sec-content">
            ${cardHead("Content", { href: `#/resources/${encodeURIComponent(c.courseId)}`, label: "View all" })}
            ${model.modules.length ? model.modules.map((module) => `<a class="row compact" href="${e(module.route)}"><span class="ico">${icon("folder", 20)}</span><span class="grow"><span class="title plain">${e(module.title)}</span><span class="meta">${e([module.topics, module.completion].join(" · "))}</span></span><span class="chev">${icon("chevronRight", 16)}</span></a>`).join("") : emptyState("", "This course has no content modules in the archive.")}
          </section>
        </div>
        <div class="course-side-column stack">
          ${instructorContactCard(model.contacts, model.syllabus, c.courseId, model.syllabusOverride)}
          <section class="card card-pad sec-announcements">
            ${cardHead("Announcements", model.announcementTotal ? { href: `#/updates?course=${encodeURIComponent(c.courseId)}`, label: "View all" } : null, model.announcementTotal ? plural(model.announcementTotal, "announcement") : "")}
            ${model.announcements.length ? model.announcements.map(announcementRow).join("") : emptyState("", model.earlierAnnouncements.length ? "No announcements this term yet." : "This course has no announcements.")}
            ${model.earlierAnnouncements.length ? `<details class="earlier"><summary>From earlier terms (${model.earlierAnnouncements.length}) ${icon("chevronDown", 15)}</summary>${model.earlierAnnouncements.map(announcementRow).join("")}</details>` : ""}
          </section>
          ${model.discussions.length ? `<section class="card card-pad sec-discussions">
            ${cardHead("Discussions", { href: `#/work?type=discussion&tab=all&course=${encodeURIComponent(c.courseId)}`, label: "View all" })}
            ${model.discussions.map((item) => `<a class="row compact" href="${e(item.route)}"><span class="ico">${icon("chat", 20)}</span><span class="grow"><span class="title plain">${e(item.title)}</span><span class="meta">${e(item.dueLine)}</span></span>${statusMark(item.status)}</a>`).join("")}
          </section>` : ""}
        </div>
      </div>
    </div>`;
  }


  Object.assign(dash, {
    coursesPage, announcementRow, courseHomePage
  });
})(globalThis);
