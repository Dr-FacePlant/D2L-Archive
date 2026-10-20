// Courses list and course home pages.
(function initDashboardRenderCourses(global) {
  const dash = global.D2LDashboard ||= {};
  const { cardHead, courseCard, emptyState, escapeHtml: e, selectMenu, gradeText, icon, notFoundPage, plural, statusMark, workRow } = dash;
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

  function instructorCopyButton(value, label) {
    return `<button class="instructor-copy" type="button" data-action="copy-instructor" data-copy-value="${e(value)}" data-copy-label="${e(label)}" aria-label="Copy ${e(label)}">${icon("copy", 14)}<span class="copy-label" aria-live="polite">Copy</span></button>`;
  }

  function syllabusVisitButton(syllabus, courseId) {
    if (!syllabus) return `<button class="instructor-visit" type="button" disabled aria-label="Syllabus not available">${icon("link", 14)}<span>Visit</span></button>`;
    return `<a class="instructor-visit" href="#/resources/${encodeURIComponent(courseId)}?item=${encodeURIComponent(syllabus.id)}" aria-label="Visit syllabus: ${e(syllabus.title)}">${icon("link", 14)}<span>Visit</span></a>`;
  }

  function instructorContactCard(contacts = [], syllabus = null, courseId = "") {
    if (!contacts.length && !syllabus) return "";
    const rows = contacts.map((contact) => `<div class="instructor-contact-group">
      ${contact.name ? `<div class="instructor-contact-row"><span class="ico">${icon("user", 16)}</span><span class="instructor-contact-value">Instructor: ${e(contact.name)}</span>${instructorCopyButton(contact.name, "instructor name")}</div>` : ""}
      <div class="instructor-contact-row"><span class="ico">${icon("mail", 16)}</span><span class="instructor-contact-value">Email: ${contact.email ? `<a class="instructor-email" href="mailto:${e(contact.email)}">${e(contact.email)}</a>` : "N/A"}</span>${instructorCopyButton(contact.email || "N/A", contact.email ? "instructor email" : "email availability")}</div>
      <div class="instructor-contact-row"><span class="ico">${icon("clock", 16)}</span><span class="instructor-contact-value">Office hours: ${contact.officeHours ? e(contact.officeHours) : "N/A"}</span>${instructorCopyButton(contact.officeHours || "N/A", contact.officeHours ? "instructor office hours" : "office-hours availability")}</div>
    </div>`).join("");
    const syllabusRow = `<div class="instructor-contact-row instructor-syllabus-row"><span class="ico">${icon("book", 16)}</span><span class="instructor-contact-value">Syllabus: ${syllabus ? e(syllabus.title) : "N/A"}</span>${syllabusVisitButton(syllabus, courseId)}</div>`;
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
                <div class="course-title-row"><h1 title="${e(c.title)}">${e(c.name)}</h1>${c.d2lHome ? `<a class="icon-btn" href="${e(c.d2lHome)}" target="_blank" rel="noopener noreferrer" data-d2l-link title="Open in D2L" aria-label="Open ${e(c.name)} in D2L">${icon("external", 18)}</a>` : ""}</div>
                ${c.section ? `<div style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:8px;font-size:13.5px;color:var(--ink-4)"><span>${e(c.section)}</span></div>` : ""}
              </div>
              <div class="course-header-summary">
                ${c.completion ? `<div class="course-completion"><div class="course-completion-label"><span>Content completed</span><span>${e(`${c.completion.completed} of ${c.completion.required}`)}</span></div><div class="progress" style="margin:0"><div class="bar" style="height:6px"><i style="width:${c.completion.pct}%;background:${e(c.color)}"></i></div></div></div>` : ""}
                <a class="btn course-grades" href="#/grades?course=${encodeURIComponent(c.courseId)}">${e(model.final ? `Grades: ${gradeText(model.final)}` : `Grades: ${model.gradedCount} of ${model.gradeCount} graded`)}</a>
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
          ${instructorContactCard(c.instructorContacts, model.syllabus, c.courseId)}
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
