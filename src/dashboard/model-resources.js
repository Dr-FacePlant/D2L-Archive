// Resource modules and the resources screen.
(function initDashboardModelResources(global) {
  const dash = global.D2LDashboard ||= {};
  const { D2L_ORIGIN, fmtDateTime, fmtShortDate, plural, time } = dash;
  // ------------------------------------------------------------- resources

  const TOPIC_ICONS = Object.freeze({ file: "file", link: "link", quiz: "doc", dropbox: "doc", discussion: "chat" });

  function resourceModules(index, courseId) {
    const resources = index.list(courseId, "learningResource");
    const completion = new Map(index.list(courseId, "studentProgress")
      .filter((entity) => entity.progressKind === "moduleCompletion")
      .map((entity) => [entity.contentObjectId, entity]));
    const modules = resources.filter((entity) => entity.isModule).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
    const topics = resources.filter((entity) => !entity.isModule).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.canonicalTitle.localeCompare(b.canonicalTitle));
    const moduleList = modules.length
      ? modules.map((module) => ({ id: module.moduleId || module.entityId.split(":").at(-1), title: module.canonicalTitle, startsAt: module.moduleStartsAt, entity: module }))
      : [...new Set(topics.map((topic) => topic.moduleTitle || topic.module || "Content"))].map((title) => ({ id: title, title, startsAt: null, entity: null }));
    const itemsOf = (module) => topics.filter((topic) => modules.length ? String(topic.moduleId) === String(module.id) : (topic.moduleTitle || topic.module || "Content") === module.title);
    const childrenOf = (module) => modules.filter((child) => child.parentModuleId && String(child.parentModuleId) === String(module.moduleId || module.entityId.split(":").at(-1)));
    // Topics inside sub-modules count toward their parent ("Modules" holds none
    // of its own).
    const nestedCount = (entity, depth = 0) => depth > 10 ? 0 : topics.filter((topic) => String(topic.moduleId) === String(entity.moduleId || entity.entityId.split(":").at(-1))).length
      + childrenOf(entity).reduce((sum, child) => sum + nestedCount(child, depth + 1), 0);
    return moduleList.map((module) => {
      const count = completion.get(String(module.id));
      const items = itemsOf(module);
      const subModules = module.entity ? childrenOf(module.entity).length : 0;
      const topicCount = module.entity ? nestedCount(module.entity) : items.length;
      return {
        id: String(module.id),
        title: module.title,
        topics: subModules ? `${plural(topicCount, "topic")} in ${plural(subModules, "sub-module")}` : plural(topicCount, "topic"),
        subModules,
        // A start date is news only while it's still ahead.
        startsAt: module.startsAt && time(module.startsAt) > index.now.getTime() ? `Begins ${fmtShortDate(module.startsAt, index.now)}` : "",
        // Every row says the same thing: D2L's own count, or that D2L doesn't track it.
        completion: count && count.requiredItems ? `${count.completedItems} of ${count.requiredItems} done` : "Completion not tracked",
        d2lUrl: module.entity?.urls?.d2l || "",
        items: items.map((topic) => resourceItem(index, topic))
      };
    }).filter((module) => module.items.length || module.subModules || module.d2lUrl);
  }

  function resourceItem(index, entity) {
    const type = String(entity.resourceType || "").toLowerCase();
    const external = entity.urls?.external || "";
    return {
      id: entity.entityId,
      title: entity.canonicalTitle,
      type: entity.resourceType || "Topic",
      icon: TOPIC_ICONS[type] || "doc",
      d2lUrl: entity.urls?.d2l || entity.urls?.item || "",
      external,
      download: external ? "" : entity.urls?.download || "",
      localPath: entity.localFilePath && !external ? entity.localFilePath : "",
      downloadUrl: entity.urls?.download || "",
      visited: entity.progress ? true : false,
      exempt: entity.isExempt === true,
      dates: entity.dates?.dueAt ? `Due ${fmtDateTime(entity.dates.dueAt, index.now)}` : ""
    };
  }

  function resourcesModel(index, params = {}) {
    const courseId = index.courseById.has(params.course) && index.visible.has(params.course) ? params.course : index.courses[0]?.courseId || "";
    const course = index.courseById.get(courseId) || null;
    const modules = courseId ? resourceModules(index, courseId) : [];
    const policies = courseId ? index.list(courseId, "coursePolicy") : [];
    const syllabusTopics = modules.flatMap((module) => module.items).filter((item) => /syllabus|course schedule|policies/i.test(item.title));
    const pinned = [
      ...syllabusTopics.map((item) => ({ ...item, from: "Content" })),
      ...policies.filter((policy) => policy.policyType === "courseOverview").map((policy) => ({ id: policy.entityId, title: policy.canonicalTitle, type: "Course overview", icon: "book", d2lUrl: `${D2L_ORIGIN}/d2l/le/content/${courseId}/Home`, external: "", localPath: "", from: "Overview" }))
    ];
    return {
      courseId,
      course,
      courseChips: index.courses.map((entry) => ({ key: entry.courseId, label: entry.label })),
      pinned,
      modules,
      highlight: params.item || "",
      openModule: params.module || "",
      completion: course?.completion || null,
      d2lUrl: courseId ? `${D2L_ORIGIN}/d2l/le/content/${courseId}/Home` : ""
    };
  }


  Object.assign(dash, {
    resourceModules, resourceItem, resourcesModel, TOPIC_ICONS
  });
})(globalThis);
