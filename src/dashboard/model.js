// View models for every dashboard screen. Pure functions over what the
// extension's read-only API returned: no DOM, no chrome.*, no invented values.
// Anything the archive lacks is reported as missing, never filled in.
(function initDashboardModel(global) {
  const dash = global.D2LDashboard ||= {};
  const {
    toDate, dayKey, dateParts, fmtTime, fmtDate, fmtDateTime, fmtShortDate, monthLabel, relativeDay, countdown, ago,
    fmtNumber, fmtPoints, fmtBytes, courseCode, courseName, sectionOf, termOf, plural, percent, plainText, startOfDay, DAY_MS
  } = dash;

  const D2L_ORIGIN = "https://kennesaw.view.usg.edu";

  // A D2L address the viewer can load a file from. Quick links open tools,
  // not files.
  function isD2lFileUrl(url) {
    return typeof url === "string" && url.startsWith(`${D2L_ORIGIN}/d2l/`) && !/quickLink/i.test(url);
  }

  // A Content topic D2L hands over as a file (a PDF, a Word file, a page made
  // in D2L). Quizzes, discussions and tools keep their D2L page address in
  // the same place, so only D2L's file download address counts.
  function isTopicFileUrl(url) {
    return isD2lFileUrl(url) && /\/DirectFileTopicDownload$/i.test(url);
  }

  // Colors and banners follow the mockup's course cards; unknown courses get
  // the palette in order.
  // In the dark theme a course's tint and text color are mixed from its main
  // color and the theme's own surface and text (light-dark() follows the
  // color-scheme that dashboard.css sets for each theme).
  const shaded = (theme) => Object.freeze({
    ...theme,
    tint: `light-dark(${theme.tint}, color-mix(in srgb, ${theme.color} 18%, var(--surface)))`,
    ink: `light-dark(${theme.ink}, color-mix(in srgb, ${theme.color} 55%, var(--ink)))`
  });
  const COURSE_THEMES = Object.freeze({
    ART: shaded({ color: "#00925A", tint: "#E3F4EC", ink: "#0B6B43", image: "src/dashboard/img/course-art.jpg" }),
    HIST: shaded({ color: "#0A66F2", tint: "#E4EEFE", ink: "#0A4FB8", image: "src/dashboard/img/course-hist.jpg" }),
    POLS: shaded({ color: "#7A0FEB", tint: "#F0E7FD", ink: "#5A12AD", image: "src/dashboard/img/course-pols.jpg" }),
    CRJU: shaded({ color: "#0B5CE8", tint: "#E3EBFD", ink: "#0B45AE", image: "src/dashboard/img/course-crju.jpg" })
  });
  const PALETTE = Object.freeze([
    shaded({ color: "#0A66F2", tint: "#E4EEFE", ink: "#0A4FB8" }),
    shaded({ color: "#00925A", tint: "#E3F4EC", ink: "#0B6B43" }),
    shaded({ color: "#7A0FEB", tint: "#F0E7FD", ink: "#5A12AD" }),
    shaded({ color: "#C2410C", tint: "#FDEBDD", ink: "#9A3412" }),
    shaded({ color: "#0E7490", tint: "#DDF3F8", ink: "#155E75" }),
    shaded({ color: "#B91C1C", tint: "#FDE4E4", ink: "#991B1B" })
  ]);

  const KIND_LABELS = Object.freeze({ assignment: "Assignment", quiz: "Quiz", discussion: "Discussion", task: "Checklist task" });
  const KIND_PLURALS = Object.freeze({ assignment: "Assignments", quiz: "Quizzes", discussion: "Discussions", task: "Checklist tasks" });
  const ROUTE_BY_TYPE = Object.freeze({
    assignmentBundle: "assignment",
    quizBundle: "quiz",
    discussionThread: "discussion",
    courseToolItem: "task",
    announcement: "announcement",
    gradeRecord: "grade",
    calendarEvent: "event",
    learningResource: "resource"
  });

  const DETAIL_ROUTES = Object.freeze(new Set(["assignment", "quiz", "discussion", "task", "checklist", "announcement", "grade", "event"]));

  function time(value) {
    const date = toDate(value);
    return date ? date.getTime() : NaN;
  }

  function routeFor(entity) {
    if (!entity) return "";
    const kind = ROUTE_BY_TYPE[entity.entityType];
    if (!kind) return "";
    if (kind === "resource") return `#/resources/${encodeURIComponent(entity.courseId)}?item=${encodeURIComponent(entity.entityId)}`;
    return `#/${kind}/${encodeURIComponent(entity.entityId)}`;
  }

  function themeFor(code, index) {
    const prefix = String(code || "").split(" ")[0];
    return COURSE_THEMES[prefix] || { ...PALETTE[index % PALETTE.length], image: "" };
  }


  Object.assign(dash, {
    time, routeFor, themeFor, D2L_ORIGIN, isD2lFileUrl, isTopicFileUrl, shaded, COURSE_THEMES, PALETTE, KIND_LABELS, KIND_PLURALS, ROUTE_BY_TYPE, DETAIL_ROUTES
  });
})(globalThis);
