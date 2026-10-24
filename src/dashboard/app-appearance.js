// Appearance, wallpaper, storage usage and settings rendering.
(function initDashboardAppAppearance(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { api, blobFromDataUrl, fileScope, look, recordActivity, rememberScreen, state, toast } = dash.appModules;
  // --------------------------------------------------------- appearance

  function applyLook() {
    const applied = look.apply(state.settings.appearance);
    look.mirror(applied);
    return applied;
  }

  async function saveLook(patch) {
    await dash.appModules.saveSettings({ appearance: look.normalize({ ...state.settings.appearance, ...patch }) });
    applyLook();
  }

  function showWallpaper(saved) {
    if (state.wallpaper && saved?.savedAt === state.wallpaper.savedAt) return;
    for (const url of [state.wallpaper?.image, state.wallpaper?.soft]) if (url) URL.revokeObjectURL(url);
    state.wallpaper = null;
    const root = document.documentElement;
    if (typeof saved?.image !== "string" || typeof saved?.soft !== "string") {
      root.style.removeProperty("--wall-image");
      root.style.removeProperty("--wall-soft");
      return;
    }
    state.wallpaper = { image: URL.createObjectURL(blobFromDataUrl(saved.image, "image/jpeg")), soft: URL.createObjectURL(blobFromDataUrl(saved.soft, "image/jpeg")), savedAt: saved.savedAt };
    root.style.setProperty("--wall-image", `url("${state.wallpaper.image}")`);
    root.style.setProperty("--wall-soft", `url("${state.wallpaper.soft}")`);
  }

  // How solid cards must be over this picture in each theme, worked out from
  // the blurred copy they show.
  function minGlassFor(soft) {
    const scale = Math.min(1, 96 / soft.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(soft.width * scale));
    canvas.height = Math.max(1, Math.round(soft.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(soft, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]]);
    return { light: look.glassFor(pixels, "light"), dark: look.glassFor(pixels, "dark") };
  }

  // A picture saved by an earlier version gets its numbers once, on load.
  async function measureSavedWallpaper(saved) {
    const current = look.normalize(state.settings.appearance);
    if (!current.wallpaper || current.wallpaper.minGlass || typeof saved?.soft !== "string") return;
    try {
      const bitmap = await createImageBitmap(blobFromDataUrl(saved.soft, "image/jpeg"));
      const minGlass = minGlassFor(bitmap);
      bitmap.close?.();
      await saveLook({ wallpaper: { ...current.wallpaper, minGlass } });
    } catch {
      // Cards stay solid over this picture until it's chosen again.
    }
  }

  // A picked image is shrunk to screen size and saved with a blurred copy for
  // the see-through cards. The blurred copy decides how solid cards must be
  // so text stays readable in both themes.
  async function prepareWallpaper(file) {
    if (!/^image\//.test(file.type)) throw new Error("Choose an image file (JPG, PNG, WebP or GIF).");
    if (file.size > 40 * 1024 * 1024) throw new Error("This image is larger than 40 MB. Choose a smaller one.");
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error("This image couldn't be opened. Try a JPG or PNG.");
    }
    const draw = (width, blur = 0) => {
      const scale = Math.min(1, width / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (blur) {
        context.filter = `blur(${blur}px)`;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      }
      return { canvas, context };
    };
    const sharp = draw(2560).canvas;
    const soft = draw(480, 14).canvas;
    bitmap.close?.();
    return {
      saved: { image: sharp.toDataURL("image/jpeg", 0.86), soft: soft.toDataURL("image/jpeg", 0.8), savedAt: new Date().toISOString() },
      minGlass: minGlassFor(soft)
    };
  }

  async function useWallpaper(file) {
    try {
      const { saved, minGlass } = await prepareWallpaper(file);
      await chrome.storage.local.set({ [WALLPAPER_KEY]: saved });
      showWallpaper(saved);
      await saveLook({ background: "image", wallpaper: { minGlass, savedAt: saved.savedAt, bytes: saved.image.length + saved.soft.length } });
      dash.appModules.render();
    } catch (error) {
      toast(error.message || "This image couldn't be used.");
    }
  }

  async function removeWallpaper() {
    await chrome.storage.local.remove(WALLPAPER_KEY).catch(() => {});
    showWallpaper(null);
    const current = look.normalize(state.settings.appearance);
    await saveLook({ wallpaper: null, background: current.background === "image" ? "default" : current.background });
  }

  async function storageUsage() {
    const previews = await dash.fileCache?.usage(fileScope()).catch(() => null);
    return { previews };
  }

  async function exportActivity(format) {
    const result = await api("activity.list", { limit: 500 });
    const items = result.items || [];
    let body;
    let mime;
    if (format === "csv") {
      const columns = ["activityId", "timestamp", "operation", "category", "status", "courseId", "itemId", "source", "correlationId", "details", "error"];
      const cell = (value) => `"${String(typeof value === "object" ? JSON.stringify(value) : value ?? "").replaceAll('"', '""')}"`;
      body = `${columns.join(",")}\n${items.map((item) => columns.map((key) => cell(item[key])).join(",")).join("\n")}`;
      mime = "text/csv";
    } else {
      body = JSON.stringify({ exportedAt: new Date().toISOString(), events: items }, null, 2);
      mime = "application/json";
    }
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    await chrome.downloads.download({ url, filename: `D2L Export/activity-log-${new Date().toISOString().replace(/[:.]/g, "-")}.${format === "csv" ? "csv" : "json"}`, saveAs: false, conflictAction: "uniquify" });
    await recordActivity({ operation: "activity.export", category: "export", status: "completed", source: "activity-history", details: { format, events: items.length } });
    toast(`Activity log exported as ${format.toUpperCase()}.`);
  }

  // Settings opens over the current page; each section has its own address
  // (#/settings/sync), so Back steps through sections and Esc closes it.
  async function renderSettings(route, token) {
    const section = dash.settingsSectionName(route.id);
    const model = {
      section,
      look: look.normalize(state.settings.appearance),
      choices: look,
      settings: state.settings,
      sync: dash.syncModel(state.index, state.settings),
      courses: state.index?.allCourses || [],
      visible: state.index?.visible || new Set()
    };
    if (section === "storage") {
      model.storage = await storageUsage();
      model.contactEdits = dash.contactEditCount(state.courseContactOverrides || {});
    }
    if (section === "activity") {
      model.activity = await api("activity.list", { limit: 100 }).catch(() => ({ items: [] }));
      model.activitySummary = await api("activity.getSummary", {}).catch(() => ({ total: 0, byStatus: {}, byCategory: {} }));
    }
    if (token !== state.detailRenderToken) return;
    const root = dash.appModules.detailRoot();
    const nav = root?.querySelector(".settings-nav");
    const body = root?.querySelector("[data-detail-body]");
    if (!nav || !body) return;
    const focused = body.contains(document.activeElement) || nav.contains(document.activeElement) ? document.activeElement : null;
    const keep = body.dataset.section === section ? body.scrollTop : 0;
    nav.innerHTML = dash.settingsNav(section);
    body.innerHTML = dash.settingsSection(model);
    body.dataset.section = section;
    body.scrollTop = keep;
    refocus(root, focused);
    rememberScreen();
  }

  // After a redraw, focus returns to the same control (or section tab).
  function refocus(root, previous) {
    if (!previous) return;
    const data = previous.dataset || {};
    const selector = previous.id ? `#${CSS.escape(previous.id)}`
      : previous.matches?.(".settings-tab") ? `.settings-tab[href="${CSS.escape(previous.getAttribute("href"))}"]`
        : data.action ? `[data-action="${CSS.escape(data.action)}"]${data.value ? `[data-value="${CSS.escape(data.value)}"]` : ""}${data.course ? `[data-course="${CSS.escape(data.course)}"]` : ""}` : "";
    const target = selector ? root.querySelector(selector) : null;
    (target || root.querySelector(".detail-panel"))?.focus({ preventScroll: true });
  }

  Object.assign(mod, { applyLook, saveLook, showWallpaper, minGlassFor, measureSavedWallpaper, prepareWallpaper, useWallpaper, removeWallpaper, storageUsage, exportActivity, renderSettings, refocus });
})(globalThis);
