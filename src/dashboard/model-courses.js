// Courses screen, course home and grade summaries.
(function initDashboardModelCourses(global) {
  const dash = global.D2LDashboard ||= {};
  const { ago, allWork, byDue, countdownFor, courseCard, dateParts, dueLine, fmtDate, fmtNumber, fmtPoints, fmtShortDate, fromEarlierTerm, gradeLabel, isGradedGrade, itemCount, nextRows, plural, relativeDay, resourceModules, routeFor, time, upcomingWork } = dash;
  // --------------------------------------------------------------- courses

  function coursesModel(index, params = {}, hiddenWork = {}) {
    const upcoming = upcomingWork(index, "", {}, hiddenWork);
    const manuallyHidden = new Set((index.raw.settings?.hiddenCourseIds || []).map(String));
    const available = index.allCourses.filter((course) => !manuallyHidden.has(course.courseId));
    const terms = [...new Set(available.map((course) => course.term).filter(Boolean))]
      .sort((a, b) => {
        const aStart = Math.max(...available.filter((course) => course.term === a).map((course) => time(course.startsAt) || 0));
        const bStart = Math.max(...available.filter((course) => course.term === b).map((course) => time(course.startsAt) || 0));
        return bStart - aStart || b.localeCompare(a);
      });
    const currentTerm = available.find((course) => course.currentTerm)?.term || index.courses.find((course) => course.term)?.term || terms[0] || "all";
    const selectedTerm = params.term === "all" || terms.includes(params.term) ? params.term : currentTerm;
    const selectedCourses = selectedTerm === "all" ? available : available.filter((course) => course.term === selectedTerm);
    return {
      subtitle: [selectedTerm === "all" ? "Every archived semester" : selectedTerm, plural(selectedCourses.length, "course")].filter(Boolean).join(" · "),
      selectedTerm,
      termOptions: [
        ...terms.map((term) => ({ key: term, label: term, href: `#/courses?term=${encodeURIComponent(term)}` })),
        { key: "all", label: "All courses", href: "#/courses?term=all" }
      ],
      courses: selectedCourses.map((course) => courseCard(index, course, upcoming))
    };
  }

  function finalGradeLabel(course) {
    const final = course.finalGrade;
    if (!final || final.status !== "graded") return null;
    const points = fmtPoints(final.grade?.pointsEarned, final.grade?.pointsPossible);
    return { value: final.grade?.displayed || points, detail: final.grade?.displayed && points && final.grade.displayed !== points ? points : "" };
  }

  function gradePercent(grade) {
    const displayed = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(String(grade?.displayed || "").trim());
    if (displayed) return Number(displayed[1]);
    return Number.isFinite(grade?.pointsEarned) && Number.isFinite(grade?.pointsPossible) && grade.pointsPossible > 0
      ? grade.pointsEarned / grade.pointsPossible * 100 : null;
  }

  function courseGradeSummary(index, course) {
    const records = index.list(course.courseId, "gradeRecord");
    const final = finalGradeLabel(course);
    if (final) {
      const pct = gradePercent(course.finalGrade.grade);
      const letter = /^[A-F][+-]?$/.test(final.value) ? final.value : "";
      return {
        value: pct == null ? final.value : `${fmtNumber(pct)}%`,
        detail: fmtPoints(course.finalGrade.grade?.pointsEarned, course.finalGrade.grade?.pointsPossible),
        label: "Published by D2L", letter,
        explanation: `D2L reports ${final.value}${final.detail ? ` (${final.detail})` : ""}. ${pct == null ? "" : "The percentage uses D2L's published percentage or its published total points."}`.trim()
      };
    }
    const eligible = records.filter((r) => !r.excludedFromDisplay && !r.excludedFromFinal && !r.isDropped && !r.isExempt);
    const items = eligible.filter((r) => r.kind === "item" && isGradedGrade(r));
    if (!items.length) return null;
    const systems = new Set(records.map((r) => r.gradingSystem).filter(Boolean));
    if (systems.size !== 1) return null;
    const system = [...systems][0];
    const zeroNote = records.some((r) => r.ungradedCountsAsZero)
      ? " D2L is configured to count ungraded work as zero, so its calculated total may differ." : "";
    if (/^points$/i.test(system)) {
      if (items.some((r) => !Number.isFinite(r.grade?.pointsEarned) || !Number.isFinite(r.grade?.pointsPossible)
        || r.grade.pointsPossible < 0 || r.category?.lowestToDrop || r.category?.highestToDrop)) return null;
      const earned = items.reduce((sum, r) => sum + r.grade.pointsEarned, 0);
      const possible = items.reduce((sum, r) => sum + (r.isBonus ? 0 : r.grade.pointsPossible), 0);
      if (possible <= 0) return null;
      return {
        value: `${fmtNumber(earned / possible * 100)}%`, detail: fmtPoints(earned, possible), label: "Graded work only", letter: "",
        explanation: `${fmtPoints(earned, possible)} points across ${plural(items.length, "graded item")}. Ungraded, excluded, exempt and dropped items are omitted; bonus points add to earned points only. This is not a published course total.${zeroNote}`
      };
    }
    if (!/^weighted$/i.test(system)) return null;
    // Category totals already include their children and D2L's drop rules.
    // Only top-level contributions belong in the estimate's denominator.
    const categoryId = (r) => r.category?.id || r.grade?.categoryId || "";
    const totals = eligible.filter((r) => r.kind === "category" && isGradedGrade(r));
    if (items.some((r) => categoryId(r) && !totals.some((t) => categoryId(t) === categoryId(r)))) return null;
    const parts = [...totals, ...items.filter((r) => !categoryId(r))];
    if (parts.some((r) => !Number.isFinite(r.grade?.weightAchieved?.numerator)
      || !Number.isFinite(r.grade?.weightAchieved?.denominator) || r.grade.weightAchieved.denominator < 0)) return null;
    const earned = parts.reduce((sum, r) => sum + r.grade.weightAchieved.numerator, 0);
    const possible = parts.reduce((sum, r) => sum + r.grade.weightAchieved.denominator, 0);
    if (possible <= 0) return null;
    return {
      value: `${fmtNumber(earned / possible * 100)}%`, detail: "", label: "Estimated · graded work", letter: "",
      explanation: `D2L's counted weight: ${fmtPoints(earned, possible)} (${parts.map((r) => `${r.canonicalTitle}: ${fmtPoints(r.grade.weightAchieved.numerator, r.grade.weightAchieved.denominator)}`).join("; ")}). Category totals are counted once, without adding their individual items again. Ungraded categories and items are omitted. This is not a published course total.${zeroNote}`
    };
  }

  function dashboardGradeSnapshot(index, course, upcoming) {
    const grades = index.list(course.courseId, "gradeRecord").filter((entity) => entity.kind === "item" && !entity.excludedFromDisplay);
    const graded = grades
      .filter((entity) => isGradedGrade(entity))
      .map((entity) => {
        return {
          at: entity.dates?.gradedAt,
          pct: gradePercent(entity.grade),
          score: gradeLabel(entity) || entity.grade?.displayed || "",
          title: entity.canonicalTitle
        };
      })
      .filter((point) => Number.isFinite(time(point.at)))
      .sort((a, b) => time(a.at) - time(b.at));
    const pctPoints = graded.filter((point) => Number.isFinite(point.pct)).slice(-8);
    const values = pctPoints.map((point) => point.pct);
    const min = values.length ? Math.max(0, Math.floor((Math.min(...values) - 8) / 10) * 10) : 0;
    const max = values.length ? Math.min(110, Math.max(100, Math.ceil((Math.max(...values) + 4) / 10) * 10)) : 100;
    const span = Math.max(1, max - min);
    const chart = pctPoints.length >= 2
      ? pctPoints.map((point, i) => ({
          x: Math.round((i / (pctPoints.length - 1)) * 1000) / 10,
          y: Math.round(((point.pct - min) / span) * 1000) / 10,
          label: `${fmtNumber(point.pct)}%`,
          title: point.title
        }))
      : [];
    const first = values[0];
    const last = values.at(-1);
    const delta = Number.isFinite(first) && Number.isFinite(last) && values.length > 1 ? Math.round((last - first) * 10) / 10 : null;
    const next = upcoming.find((item) => item.courseId === course.courseId && item.kind !== "task") || null;
    const final = courseGradeSummary(index, course);
    return {
      courseId: course.courseId,
      label: course.label,
      name: course.name,
      color: course.color,
      tint: course.tint,
      ink: course.ink,
      route: `#/grades?course=${encodeURIComponent(course.courseId)}`,
      courseRoute: `#/course/${encodeURIComponent(course.courseId)}`,
      grade: final,
      gradeText: final ? (final.detail ? `${final.value} (${final.detail})` : final.value) : "No final grade yet",
      letter: final?.letter || "",
      graded: graded.length,
      total: grades.length,
      chart,
      chartMin: min,
      chartMax: max,
      chartStart: pctPoints.length ? fmtShortDate(pctPoints[0].at, index.now) : "",
      chartEnd: pctPoints.length ? fmtShortDate(pctPoints.at(-1).at, index.now) : "",
      delta,
      trendText: delta == null ? "No trend yet" : `${delta >= 0 ? "Up" : "Down"} ${fmtNumber(Math.abs(delta))}%`,
      next: next ? { title: next.title, due: next.dueAt ? `${next.hasDueDate ? "due" : "closes"} ${fmtShortDate(next.dueAt, index.now)}` : "" } : null
    };
  }

  function courseHomeModel(index, courseId, hiddenWork = {}) {
    const course = index.courseById.get(courseId);
    if (!course) return null;
    const upcoming = upcomingWork(index, courseId, {}, hiddenWork);
    const seen = new Set();
    const allAnnouncements = index.list(courseId, "announcement")
      .slice()
      .sort((a, b) => time(b.dates?.publishedAt) - time(a.dates?.publishedAt))
      .filter((entity) => {
        const key = `${entity.canonicalTitle}|${entity.dates?.publishedAt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((entity) => ({ title: entity.canonicalTitle, route: routeFor(entity), at: entity.dates?.publishedAt, date: fmtShortDate(entity.dates?.publishedAt, index.now), ago: ago(entity.dates?.publishedAt, index.now) }));
    const announcements = allAnnouncements.filter((a) => !fromEarlierTerm(index, courseId, a.at));
    const earlierAnnouncements = allAnnouncements.filter((a) => fromEarlierTerm(index, courseId, a.at))
      .map((a) => ({ ...a, date: fmtDate(a.at, index.now) }));
    const modules = resourceModules(index, courseId);
    const syllabusRegex = /\b(?:syllabus|simple\s+syllabus|course\s+outline|course\s+information|course\s+info|policies\s*(?:&|and)\s*schedule)\b/i;
    let syllabus = modules.flatMap((module) => module.items).find((item) => syllabusRegex.test(item.title)) || null;
    if (!syllabus) {
      const overviewPolicies = index.list(courseId, "coursePolicy").filter((p) => p.policyType === "courseOverview");
      if (overviewPolicies.length) {
        syllabus = { id: overviewPolicies[0].entityId, title: overviewPolicies[0].canonicalTitle, from: "Overview" };
      }
    }
    if (!syllabus) {
      // Check for syllabus policies tagged from announcements or tools (e.g. Simple Syllabus or quickLink)
      const syllabusPolicies = index.list(courseId, "coursePolicy").filter((p) => syllabusRegex.test(p.canonicalTitle || ""));
      if (syllabusPolicies.length) {
        syllabus = { id: syllabusPolicies[0].entityId, title: syllabusPolicies[0].canonicalTitle, from: "Policy" };
      }
    }
    const listed = new Set(nextRows(upcoming, 6).map((item) => item.id));
    // Discussions already in Upcoming work aren't repeated in their own card.
    const discussions = allWork(index).filter((item) => item.courseId === courseId && item.kind === "discussion" && !listed.has(item.id)).sort(byDue);
    const grades = index.list(courseId, "gradeRecord").filter((entity) => entity.kind === "item");
    // Manual contact edits sit on top of whatever the archive detected. A
    // course without a detected instructor still gets one editable row.
    const contactOverrides = index.courseContactOverrides?.[courseId] || {};
    // A custom syllabus override (link, uploaded file, or raw text) replaces whatever syllabus the archive detected.
    const customSyllabus = contactOverrides.syllabus || null;
    const syllabusLink = dash.safeSyllabusUrl?.(customSyllabus?.url) || "";
    let effectiveSyllabus = null;
    let syllabusEditValue = "";
    if (customSyllabus?.type === "text" && customSyllabus.text) {
      effectiveSyllabus = {
        id: "",
        title: customSyllabus.title || "Custom syllabus",
        from: "Custom",
        type: "text",
        text: customSyllabus.text
      };
      syllabusEditValue = customSyllabus.text;
    } else if (customSyllabus?.type === "file" && customSyllabus.dataUrl) {
      effectiveSyllabus = {
        id: "",
        title: customSyllabus.title || customSyllabus.name || "Custom syllabus",
        from: "Custom",
        type: "file",
        name: customSyllabus.name || "Syllabus",
        mime: customSyllabus.mime || "application/pdf",
        dataUrl: customSyllabus.dataUrl
      };
      syllabusEditValue = customSyllabus.name || "Syllabus";
    } else if (syllabusLink) {
      effectiveSyllabus = {
        id: "",
        title: "Custom link",
        from: "Custom",
        url: syllabusLink
      };
      syllabusEditValue = syllabusLink;
    } else if (syllabus) {
      effectiveSyllabus = {
        id: syllabus.id,
        title: syllabus.title,
        from: syllabus.from || "Content"
      };
    }
    const contacts = (course.instructorContacts.length ? course.instructorContacts : [{}])
      .map((contact, index) => ({ name: "", email: "", officeHours: "", ...contact, ...(contactOverrides[index] || {}) }));
    // Manual textbook entries sit on top of whatever the syllabus text named.
    // A saved list is authoritative; a course without either still shows the
    // empty state with an Add item button.
    const textbooks = (dash.normalizeTextbookEntries(index.courseTextbooks?.[courseId]?.entries ?? course.textbooks) || []);
    return {
      course,
      contacts,
      textbooks,
      final: finalGradeLabel(course),
      gradedCount: grades.filter(isGradedGrade).length,
      gradeCount: grades.length,
      upcoming: nextRows(upcoming, 6).map((item) => ({ ...item, parts: dateParts(item.dueAt || item.opensAt), count: countdownFor(item, index.now), dueLine: dueLine(item, index.now), rel: relativeDay(item.dueAt || item.opensAt, index.now) })),
      upcomingShown: itemCount(nextRows(upcoming, 6)),
      upcomingTotal: upcoming.length,
      announcements: announcements.slice(0, 5),
      announcementTotal: announcements.length,
      earlierAnnouncements,
      syllabus: effectiveSyllabus,
      syllabusOverride: syllabusEditValue,
      modules: modules.map((module) => ({ title: module.title, topics: module.topics, completion: module.completion, route: `#/resources/${encodeURIComponent(courseId)}?module=${encodeURIComponent(module.id)}` })),
      discussions: discussions.slice(0, 6),
      discussionTotal: discussions.length,
      lastSynced: course.lastSyncedAt ? ago(course.lastSyncedAt, index.now) : ""
    };
  }


  Object.assign(dash, {
    coursesModel, finalGradeLabel, gradePercent, courseGradeSummary, dashboardGradeSnapshot, courseHomeModel
  });
})(globalThis);
