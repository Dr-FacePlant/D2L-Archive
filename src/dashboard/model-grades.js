// Grades screen, score timeline and grade detail.
(function initDashboardModelGrades(global) {
  const dash = global.D2LDashboard ||= {};
  const { D2L_ORIGIN, DAY_MS, KIND_LABELS, ROUTE_BY_TYPE, courseGradeSummary, dashboardGradeSnapshot, dayKey, evidenceOf, finalGradeLabel, fmtDate, fmtDateTime, fmtNumber, fmtPoints, fmtShortDate, fromApi, gradePercent, isGradedGrade, percent, plainText, plural, routeFor, startOfDay, step, time, toDate } = dash;
  // ---------------------------------------------------------------- grades

  // The Grade column holds D2L's percent and nothing else: when D2L's displayed
  // grade is points ("3 / 3"), the Points column already says it.
  function percentOnly(displayed) {
    return /%\s*$/.test(String(displayed || "").trim()) ? String(displayed).trim() : "";
  }

  // Category subtotal rows show what D2L shows there: weight achieved (or
  // "- / <category weight>" before anything counts) and the grade, no points.
  function categoryRow(entity) {
    const weight = entity.grade?.weightAchieved;
    const counted = weight && Number(weight.denominator) > 0;
    return {
      id: entity.entityId,
      title: entity.canonicalTitle,
      route: routeFor(entity),
      points: "",
      weight: counted ? fmtPoints(weight.numerator, weight.denominator) : entity.category?.weight != null ? `- / ${fmtNumber(entity.category.weight)}` : "",
      grade: counted ? percentOnly(entity.grade?.displayed) : "",
      graded: Boolean(counted),
      zero: false, dropped: false, bonus: false, excluded: false, hasFeedback: false, gradedAt: null
    };
  }

  function gradeRow(index, entity) {
    if (entity.kind === "category") return categoryRow(entity);
    const graded = isGradedGrade(entity);
    // An item D2L hasn't graded never looks like a zero, even in a course that
    // counts ungraded items as 0 in the final grade (that stays a note). Only a
    // 0 D2L recorded shows as 0.
    const zero = !graded && entity.ungradedCountsAsZero && entity.grade?.pointsPossible != null;
    const points = graded ? fmtPoints(entity.grade?.pointsEarned, entity.grade?.pointsPossible) : fmtPoints(null, entity.grade?.pointsPossible) || "-";
    const weight = entity.grade?.weightAchieved;
    return {
      id: entity.entityId,
      title: entity.canonicalTitle,
      route: routeFor(entity),
      points,
      weight: weight ? fmtPoints(weight.numerator, weight.denominator) || "- / -" : "",
      grade: graded ? percentOnly(entity.grade?.displayed) : "Not graded yet",
      graded,
      zero,
      dropped: entity.isDropped === true,
      bonus: entity.isBonus === true,
      excluded: entity.excludedFromFinal === true,
      hasFeedback: Boolean(entity.feedback),
      gradedAt: entity.dates?.gradedAt || null
    };
  }

  // One dot per graded item, on the day D2L graded it. Each value is that item's
  // own score as a percent of its points; no course grade is worked out here.
  // Scores over time (feedback item 9). view: "pct" plots D2L's displayed
  // percent, "points" plots D2L's points earned; neither works out a number
  // D2L didn't give. range: "2w" / "1m" (a window ending on `end`) or "term".
  const CHART_RANGES = [
    { key: "2w", days: 14, label: "Last 2 weeks" },
    { key: "1m", days: 30, label: "Last month" },
    { key: "term", days: 0, label: "Whole term" }
  ];

  function gradesHref(params) {
    const query = new URLSearchParams();
    if (params.course) query.set("course", params.course);
    if (params.view) query.set("view", params.view);
    if (params.range && params.range !== "term") query.set("range", params.range);
    if (params.end && params.range && params.range !== "term") query.set("end", params.end);
    return `#/grades?${query}`;
  }

  function niceStep(span, maxTicks) {
    for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]) if (span / step <= maxTicks) return step;
    return Math.ceil(span / maxTicks);
  }

  function scoreTimeline(index, items, final, params = {}, courseId = "") {
    const range = CHART_RANGES.find((entry) => entry.key === params.range) || CHART_RANGES.at(-1);
    const graded = items
      .filter((entity) => isGradedGrade(entity) && toDate(entity.dates?.gradedAt))
      .map((entity) => {
        const shown = String(entity.grade?.displayed || "").trim();
        const shownPct = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(shown);
        const earned = entity.grade?.pointsEarned;
        return {
          id: entity.entityId,
          title: entity.canonicalTitle,
          route: routeFor(entity),
          at: entity.dates.gradedAt,
          // D2L's percent, or earned / possible like the dashboard's grade cards.
          pct: gradePercent(entity.grade) ?? NaN,
          earned: earned == null || earned === "" ? NaN : Number(earned),
          possible: Number(entity.grade?.pointsPossible),
          score: fmtPoints(entity.grade?.pointsEarned, entity.grade?.pointsPossible) || shown,
          shown: shownPct ? shown : Number.isFinite(gradePercent(entity.grade)) ? `${fmtNumber(gradePercent(entity.grade))}%` : "",
          when: `Graded ${fmtDate(entity.dates.gradedAt, index.now)}`
        };
      })
      .sort((a, b) => time(a.at) - time(b.at));
    if (!graded.length) return null;
    // Opens on percent, like the dashboard's cards, when every graded item has one.
    const view = params.view === "points" || params.view === "pct" ? params.view
      : graded.every((point) => Number.isFinite(point.pct)) ? "pct" : "points";
    const valueOf = (point) => view === "pct" ? point.pct : point.earned;
    const usable = graded.filter((point) => Number.isFinite(valueOf(point)));

    // The time window.
    const today = startOfDay(index.now).getTime() + DAY_MS;
    let from;
    let to;
    let end = null;
    if (range.days) {
      const asked = params.end ? toDate(`${params.end}T00:00:00`) : null;
      end = Math.min(asked ? startOfDay(asked).getTime() + DAY_MS : today, today);
      to = end;
      from = end - range.days * DAY_MS;
    } else {
      const first = startOfDay((usable[0] || graded[0]).at).getTime();
      const last = Math.max(startOfDay((usable.at(-1) || graded.at(-1)).at).getTime() + DAY_MS, first + DAY_MS);
      const pad = Math.max(DAY_MS, (last - first) * 0.06);
      from = first - pad;
      to = last + pad;
    }
    const shownPoints = usable.filter((point) => time(point.at) >= from && time(point.at) < to);

    // The value axis.
    const finalPct = view === "pct" ? /^(-?\d+(?:\.\d+)?)\s*%$/.exec(String(final?.value || "").trim()) : null;
    let yMin;
    let yMax;
    let unit;
    if (view === "pct") {
      // The dashboard cards' scale: just below the lowest score to 100 (or 110).
      const values = shownPoints.map((point) => point.pct).concat(finalPct ? [Number(finalPct[1])] : []);
      yMin = values.length ? Math.max(0, Math.floor((Math.min(...values) - 8) / 10) * 10) : 0;
      yMax = values.length ? Math.min(110, Math.max(100, Math.ceil((Math.max(...values) + 4) / 10) * 10)) : 100;
      unit = "%";
    } else {
      const top = Math.max(1, ...shownPoints.map((point) => Math.max(point.earned, Number.isFinite(point.possible) ? point.possible : 0)));
      const step = niceStep(top, 5);
      yMin = 0;
      yMax = Math.ceil(top / step) * step;
      unit = " pts";
    }
    // Dots are evenly spaced in grading order, like the dashboard's cards.
    const slot = new Map(shownPoints.map((point, i) => [point, shownPoints.length > 1 ? Math.round(i / (shownPoints.length - 1) * 1000) / 10 : 50]));
    const y = (value) => Math.round((value - yMin) / (yMax - yMin) * 1000) / 10;
    const yStep = view === "pct" ? (yMax - yMin) / 2 : niceStep(yMax - yMin, 5);
    const yTicks = [];
    for (let value = yMin; value <= yMax; value += yStep) yTicks.push({ value, label: `${fmtNumber(value)}${unit}`, y: y(value) });

    // Date labels: the first and last grading day shown, like the dashboard's cards.
    const xTicks = shownPoints.length ? [...new Map([shownPoints[0], shownPoints.at(-1)].map((point) => [slot.get(point), { label: fmtShortDate(toDate(point.at), index.now), x: slot.get(point) }])).values()] : [];

    // Controls: each one is a link to the same page with other settings.
    const base = { course: courseId, view, range: range.key, end: end ? dayKey(new Date(end - DAY_MS)) : "" };
    const at = CHART_RANGES.indexOf(range);
    const zoomTo = (entry) => entry ? gradesHref({ ...base, range: entry.key, end: entry.days ? base.end : "" }) : null;
    const shift = (sign) => gradesHref({ ...base, end: dayKey(new Date(end - DAY_MS + sign * range.days * DAY_MS)) });
    const missing = graded.length - usable.length;
    return {
      view,
      range: range.key,
      rangeText: range.days ? `${fmtShortDate(new Date(from), index.now)} – ${fmtShortDate(new Date(end - DAY_MS), index.now)}` : "",
      viewOptions: [
        { label: "Score (%) per item", href: gradesHref({ ...base, view: "pct" }), selected: view === "pct" },
        { label: "Points earned per item", href: gradesHref({ ...base, view: "points" }), selected: view === "points" }
      ],
      rangeOptions: CHART_RANGES.map((entry) => ({ label: entry.label, href: zoomTo(entry), selected: entry === range })),
      zoomIn: zoomTo(CHART_RANGES[at - 1]),
      zoomOut: zoomTo(CHART_RANGES[at + 1]),
      back: range.days ? shift(-1) : null,
      forward: range.days && end < today ? shift(1) : null,
      note: missing ? `${plural(missing, "graded item")} ${missing === 1 ? "has" : "have"} no ${view === "pct" ? "percent" : "points"} from D2L, so ${missing === 1 ? "it isn't" : "they aren't"} shown here.` : "",
      empty: shownPoints.length ? "" : "No graded items in this time range.",
      points: shownPoints.map((point) => ({ ...point, x: slot.get(point), y: y(valueOf(point)) })),
      yTicks,
      xTicks,
      final: finalPct ? { label: `Final calculated grade ${final.value}`, y: y(Number(finalPct[1])) } : null
    };
  }


  function gradesModel(index, params = {}) {
    const cards = index.courses.map((course) => ({
      ...dashboardGradeSnapshot(index, course, []),
      code: course.code,
      term: course.term,
      final: finalGradeLabel(course)
    }));
    const courseId = index.courseById.has(params.course) && index.visible.has(params.course) ? params.course : cards[0]?.courseId || "";
    const course = index.courseById.get(courseId) || null;
    const records = courseId ? index.list(courseId, "gradeRecord") : [];
    const items = records.filter((entity) => entity.kind === "item" && !entity.excludedFromDisplay);
    const categoryTotals = new Map(records.filter((entity) => entity.kind === "category").map((entity) => [entity.category?.id || entity.entityId.split(":").at(-1), entity]));
    const weighted = records.some((entity) => /weight/i.test(entity.gradingSystem || ""));
    const groups = new Map();
    for (const entity of items) {
      const key = entity.category?.id || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entity);
    }
    const sections = [...groups.entries()].map(([categoryId, entities]) => {
      const total = categoryTotals.get(categoryId) || null;
      const name = entities[0]?.category?.name || total?.canonicalTitle || "";
      return {
        categoryId,
        name,
        weight: entities[0]?.category?.weight ?? null,
        dropRule: entities[0]?.category?.lowestToDrop ? `Lowest ${entities[0].category.lowestToDrop} dropped` : "",
        subtotal: total ? gradeRow(index, total) : null,
        rows: entities.map((entity) => gradeRow(index, entity))
      };
    }).sort((a, b) => (a.categoryId ? 1 : 0) - (b.categoryId ? 1 : 0));
    return {
      cards,
      courseId,
      course,
      final: course ? finalGradeLabel(course) : null,
      summary: course ? courseGradeSummary(index, course) : null,
      chart: course ? scoreTimeline(index, items, finalGradeLabel(course), params, courseId) : null,
      weighted,
      ungradedCountsAsZero: records.some((entity) => entity.ungradedCountsAsZero),
      sections,
      // D2L shows some courses' grades as points only; then there's no Grade column.
      showGrade: sections.some((section) => /%$/.test(section.subtotal?.grade || "") || section.rows.some((row) => /%$/.test(row.grade))),
      d2lUrl: courseId ? `${D2L_ORIGIN}/d2l/lms/grades/my_grades/main.d2l?ou=${courseId}` : ""
    };
  }

  function gradeDetailModel(index, entity, bundle) {
    const course = index.courseById.get(entity.courseId);
    const row = gradeRow(index, entity);
    const source = entity.sourceEntityId ? index.byId.get(entity.sourceEntityId) : null;
    const feedback = [entity.feedback, ...evidenceOf(bundle, "gradeFeedback").filter(fromApi).map((record) => record.fields?.columns?.feedbackText || record.description)]
      .map((text) => plainText(text))
      .filter(Boolean)
      .filter((text, i, list) => list.indexOf(text) === i);
    return {
      kind: "grade",
      course,
      title: entity.canonicalTitle,
      row,
      facts: [
        { k: "Points", v: row.points },
        row.weight ? { k: "Weight achieved", v: row.weight } : null,
        row.grade ? { k: "Grade", v: row.grade } : null,
        entity.category?.name ? { k: "Category", v: entity.category.name } : null,
        row.gradedAt ? { k: "Graded", v: fmtDateTime(row.gradedAt, index.now) } : null
      ].filter(Boolean),
      marks: [row.dropped ? "Dropped" : "", row.bonus ? "Bonus" : "", row.excluded ? "Not counted in final grade" : "", row.zero ? "Ungraded counts as 0 in this course" : ""].filter(Boolean),
      description: entity.description || "",
      feedback,
      rubric: entity.rubric || null,
      source: source ? { route: routeFor(source), title: source.canonicalTitle, kind: KIND_LABELS[ROUTE_BY_TYPE[source.entityType]] || "Item" } : null,
      links: [
        entity.urls?.quizAttempts ? { label: "View quiz attempts in D2L", url: entity.urls.quizAttempts, primary: true } : null,
        { label: "Open grades in D2L", url: entity.urls?.d2l || `${D2L_ORIGIN}/d2l/lms/grades/my_grades/main.d2l?ou=${entity.courseId}`, primary: !entity.urls?.quizAttempts }
      ].filter(Boolean)
    };
  }


  Object.assign(dash, {
    percentOnly, categoryRow, gradeRow, gradesHref, niceStep, scoreTimeline, gradesModel, gradeDetailModel, CHART_RANGES
  });
})(globalThis);
