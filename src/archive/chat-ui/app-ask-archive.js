// Ask's reading of the archive: every saved evidence record becomes a searchable passage index,
// and the text inside course files is read once the model has started. The Ask controller
// (app-ask.js) owns the state it keeps in `ask` and the redraws; this only fills them in.
// Read-only: nothing here changes the archive or D2L, and nothing goes online.
(function initDashboardAppAskArchive(global) {
  const dash = global.D2LDashboard ||= {};

  const EVIDENCE_PAGE = 500;

  // What Ask keeps of a record: its text and due date, and for an attached file where it is and whose it is.
  function trimEvidence(record) {
    const ids = record.platformIds || {};
    return {
      evidenceId: record.evidenceId, courseId: record.courseId, source: record.source, title: record.title, description: record.description, dates: { dueAt: record.dates?.dueAt || "" },
      urls: { download: record.urls?.download || "" }, size: record.fields?.columns?.size || 0,
      platformIds: { dropboxFolderId: ids.dropboxFolderId || "", newsItemId: ids.newsItemId || "", contentObjectId: ids.contentObjectId || "" }
    };
  }

  // The search index over the archive and the text read from its files so far.
  function passagesFor({ forIndex, entities, evidence, courses, files, texts }) {
    const read = dash.askFilePassages(files, texts).map((file) => ({ ...file, route: dash.routeFor?.(forIndex.byId.get(file.ownerId)) || "" }));
    return dash.buildPassageIndex({ entities, evidence, courses, files: read });
  }

  // ask is the controller's state; refresh and paintFiles redraw the screen.
  function createAskArchive({ ask, state, api, refresh, paintFiles }) {
    // Reads every saved evidence record for the courses you can see (500 per call), then builds the index.
    function loadArchive(index) {
      if (ask.archive?.forIndex === index) return Promise.resolve(ask.archive);
      if (ask.loadingFor === index) return ask.loading;
      ask.loadingFor = index;
      ask.reading = { state: "reading", done: 0, total: 0 };
      refresh();
      ask.loading = (async () => {
        const evidence = [];
        let total = Infinity;
        for (let offset = 0; offset < total; offset += EVIDENCE_PAGE) {
          const page = await api("evidence.list", { limit: EVIDENCE_PAGE, offset });
          total = page.total;
          for (const record of page.items) if (index.visible.has(String(record.courseId))) evidence.push(trimEvidence(record));
          if (ask.loadingFor === index) { ask.reading = { state: "reading", done: Math.min(offset + EVIDENCE_PAGE, total), total }; refresh(); }
          if (!page.items.length) break;
        }
        await new Promise((resolve) => setTimeout(resolve));
        const entities = index.entities.filter((entity) => index.visible.has(String(entity.courseId)));
        const courses = index.courses.map((course) => ({ courseId: course.courseId, label: course.label }));
        const texts = await dash.askFileTexts.all(state.account.id).catch(() => new Map());
        const files = dash.askCourseFiles(entities, evidence, index.byId);
        const archive = { forIndex: index, entities, evidence, courses, files, texts };
        archive.passageIndex = passagesFor(archive);
        if (ask.loadingFor !== index || state.index !== index) throw new Error("The archive changed while it was being read.");
        ask.archive = archive;
        ask.reading = { state: "ready", passages: archive.passageIndex.passages.length, courses: courses.length };
        refresh();
        return ask.archive;
      })().catch((error) => {
        if (ask.loadingFor === index) { ask.reading = { state: "error", message: error.message }; ask.loadingFor = null; refresh(); }
        throw error;
      });
      return ask.loading;
    }

    // Reads the files not read before, then searches them too. Stop, leaving Ask or another
    // account ends it; what was read so far is kept and searched.
    async function readFiles() {
      if (ask.filesRun || !state.index) return;
      const run = ask.filesRun = new AbortController();
      const accountId = state.account.id;
      const mine = () => ask.filesRun === run;
      try {
        const archive = await loadArchive(state.index);
        const total = archive.files.filter((file) => !archive.texts.has(file.url)).length;
        if (!total || run.signal.aborted) return;
        ask.files = { state: "reading", done: 0, total };
        paintFiles();
        const outcome = await dash.askReadCourseFiles({
          files: archive.files,
          known: archive.texts,
          keep: (url, record) => dash.askFileTexts.keep(accountId, url, record).catch(() => {}),
          signal: run.signal,
          onProgress: ({ done }) => { if (mine()) { ask.files = { state: "reading", done, total }; paintFiles(); } }
        });
        if (outcome.done && ask.archive === archive) {
          archive.passageIndex = passagesFor(archive);
          ask.reading = { ...ask.reading, passages: archive.passageIndex.passages.length };
        }
        if (mine()) ask.files = outcome;
      } catch (error) {
        if (mine()) ask.files = { state: "error", message: error.message };
      } finally {
        if (mine()) { ask.filesRun = null; refresh(); }
      }
    }

    return { loadArchive, readFiles };
  }

  dash.createAskArchive = createAskArchive;
})(globalThis);
