// Click action dispatchers and feature-specific action routers.
(function initDashboardAppEventsActions(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const {
    adoptLegacyArchive, backFromDetail, blobFromDataUrl, closeDetailToBase,
    closeLinkConfirm, closeMenu, closeOverlay, closePeek, closePreview,
    exportActivity, fileScope, main, moveGradeCarousel, navigateToDetail,
    openArchivedFile, openConfirmedLink, openPeek, previewFile, redrawAdoptNotice,
    render, saveLook, saveSettings, setChecklistDone, setDetailMore, setWorkMark,
    showAccountView, showLinkConfirm, showPreview, startSync, state, stepPeek,
    syncModulesButton, toast, turnEpub
  } = mod;

  function handleCustomSyllabusClick(actionNode) {
    const courseId = actionNode.dataset.courseId;
    const syllabus = state.courseContactOverrides?.[courseId]?.syllabus;
    if (!syllabus) return;
    if (syllabus.type === "text") {
      showPreview({ name: syllabus.title || "Custom syllabus", state: "ready", kind: "page", text: syllabus.text });
    } else if (syllabus.type === "file" && syllabus.dataUrl) {
      const src = syllabus.dataUrl;
      const mime = syllabus.mime || "application/pdf";
      const isEpub = /\.epub$/i.test(syllabus.name || "") || mime === "application/epub+zip";
      if (isEpub) {
        blobFromDataUrl(src).then((blob) => {
          showPreview({ name: syllabus.name || "Syllabus.epub", state: "ready", kind: "epub", file: blob, turn: turnEpub, src, mime });
        });
      } else {
        showPreview({
          name: syllabus.name || syllabus.title || "Syllabus",
          state: "ready",
          kind: mime === "application/pdf" ? "pdf" : mime.startsWith("image/") ? "image" : "unsupported",
          src,
          pdf: mime === "application/pdf" ? src : undefined,
          mime
        });
      }
    }
  }

  async function handleCopyInstructorClick(actionNode) {
    const value = actionNode.dataset.copyValue || "";
    const label = actionNode.dataset.copyLabel || "instructor information";
    if (!value) return;
    clearTimeout(actionNode.copyFeedbackTimer);
    const copied = await mod.copyToClipboard(value).then(() => true, () => false);
    const status = actionNode.parentElement?.querySelector("[data-copy-status]");
    const message = copied ? `Copied ${label}` : `Couldn't copy ${label}`;
    actionNode.innerHTML = dash.icon(copied ? "check" : "close", 15);
    actionNode.classList.toggle("is-copied", copied);
    actionNode.classList.toggle("is-failed", !copied);
    actionNode.setAttribute("aria-label", message);
    actionNode.title = message;
    if (status) status.textContent = message;
    actionNode.copyFeedbackTimer = setTimeout(() => {
      if (!actionNode.isConnected) return;
      actionNode.innerHTML = dash.icon("copy", 15);
      actionNode.classList.remove("is-copied", "is-failed");
      actionNode.setAttribute("aria-label", `Copy ${label}`);
      actionNode.title = `Copy ${label}`;
      if (status) status.textContent = "";
    }, 1400);
  }

  function handleCourseToggle(actionNode) {
    const id = actionNode.dataset.course;
    const hidden = new Set(state.settings.hiddenCourseIds);
    const shown = new Set(state.settings.shownCourseIds || []);
    const visible = state.index.visible.has(id);
    if (visible) { hidden.add(id); shown.delete(id); } else { hidden.delete(id); shown.add(id); }
    saveSettings({ hiddenCourseIds: [...hidden], shownCourseIds: [...shown] }).then(() => {
      state.index = dash.buildIndex({ ...state.index.raw, settings: state.settings });
      if (state.detail) state.baseStale = true;
      render.keepScroll = true;
      render();
    });
  }

  function handleShowMoreRows(actionNode) {
    const step = Number(actionNode.dataset.step) || 20;
    let revealed = 0;
    for (const node of main().querySelectorAll("[data-more][hidden]")) {
      if (revealed === step) break;
      node.hidden = false;
      if (node.matches("[data-update]")) revealed += 1;
    }
    const left = main().querySelectorAll("[data-update][data-more][hidden]").length;
    if (left) actionNode.textContent = `Show ${Math.min(step, left)} more`;
    else actionNode.remove();
  }

  async function handleWorkMark(actionNode, action) {
    actionNode.disabled = true;
    const reason = action === "mark-done" ? "done" : action === "skip-work" ? "skip" : null;
    if (await setWorkMark(actionNode.dataset.entityId, reason)) render(location.hash);
    else actionNode.disabled = false;
  }

  async function handleTextbookActions(actionNode, action) {
    if (action === "add-textbook" || action === "edit-textbook") {
      mod.beginTextbookEdit(actionNode.dataset.courseId || "", action === "edit-textbook" ? Number(actionNode.dataset.entryIndex) : -1);
      return true;
    }
    if (action === "cancel-textbook-edit") {
      mod.closeTextbookEdit();
      return true;
    }
    if (action === "remove-textbook") {
      const form = document.getElementById("textbook-editor-form");
      const courseId = form?.dataset.courseId || "";
      const view = Number(form?.dataset.entryIndex) >= 0 ? Number(form.dataset.entryIndex) : -1;
      const base = mod.textbookEntriesFor(courseId);
      if (view >= 0 && view < base.length) {
        base.splice(view, 1);
        if (await mod.persistTextbookEntries(courseId, base)) {
          mod.closeTextbookEdit();
          render.keepScroll = true;
          await render();
          toast("Shelf item removed.");
        }
      }
      return true;
    }
    if (action === "open-textbook-file") {
      const courseId = actionNode.dataset.courseId;
      const index = Number(actionNode.dataset.entryIndex);
      const entry = mod.textbookEntriesFor(courseId)?.[index];
      if (entry?.file) {
        const isEpub = /\.epub$/i.test(entry.file.name || "") || entry.file.mime === "application/epub+zip";
        if (isEpub) {
          blobFromDataUrl(entry.file.dataUrl).then((blob) => {
            showPreview({ name: entry.file.name || "Textbook.epub", state: "ready", kind: "epub", file: blob, turn: turnEpub, src: entry.file.dataUrl, mime: entry.file.mime });
          });
        } else {
          showPreview({ name: entry.file.name, state: "ready", kind: "pdf", src: entry.file.dataUrl, pdf: entry.file.dataUrl, mime: entry.file.mime || "application/pdf" });
        }
      }
      return true;
    }
    return false;
  }

  async function handleDetailAndPeekActions(actionNode, action, event) {
    if (action === "detail-back") { backFromDetail(); return true; }
    if (action === "close-detail") {
      if (!actionNode.dataset.backdrop || event.target === actionNode) closeDetailToBase();
      return true;
    }
    if (action === "grade-prev" || action === "grade-next") { moveGradeCarousel(action === "grade-next" ? 1 : -1); return true; }
    if (action === "detail-more") {
      const layout = actionNode.closest(".detail-layout");
      setDetailMore(layout, !layout?.classList.contains("is-open"));
      actionNode.scrollIntoView({ block: "nearest" });
      return true;
    }
    if (action === "peek-item") { openPeek(actionNode); return true; }
    if (action === "peek-step") { stepPeek(Number(actionNode.dataset.step)); return true; }
    if (action === "close-peek") { closePeek(); return true; }
    return false;
  }

  async function handleActionClick(actionNode, action, event) {
    if (await handleTextbookActions(actionNode, action)) return;
    if (await handleDetailAndPeekActions(actionNode, action, event)) return;
    if (action === "account-help" || action === "account-back") showAccountView(action === "account-help", true);
    else if (action === "edit-instructor") mod.beginContactEdit(actionNode.closest("[data-contact-row]"));
    else if (action === "cancel-instructor-edit") mod.cancelContactEdit(actionNode.closest("[data-contact-row]"));
    else if (action === "view-custom-syllabus") handleCustomSyllabusClick(actionNode);
    else if (action === "copy-instructor") await handleCopyInstructorClick(actionNode);
    else if (action === "nav") {
      const href = actionNode.dataset.href;
      if (dash.isLayerRoute(href)) navigateToDetail(href, actionNode);
      else location.hash = href;
    } else if (action === "export-activity") await exportActivity(actionNode.dataset.format || "json").catch((err) => toast(`Activity export failed: ${err.message}`));
    else if (action === "export-contact-edits") await mod.exportContactEdits();
    else if (action === "import-contact-edits") await mod.importContactEdits();
    else if (action === "filter-menu-toggle") {
      const open = state.filterMenu === actionNode.getAttribute("aria-controls");
      closeMenu();
      if (open) mod.closeFilterMenu();
      else mod.openFilterMenu(actionNode);
    } else if (action === "filter-menu-option") {
      mod.closeFilterMenu();
      location.hash = actionNode.dataset.href;
    } else if (action === "show-more") handleShowMoreRows(actionNode);
    else if (action === "sync") { closeMenu(); startSync().catch((err) => toast(`Couldn't start sync: ${err.message}`)); }
    else if (action === "adopt-legacy" || action === "adopt-legacy-cancel") { state.adopt = { confirming: action === "adopt-legacy", pending: false, error: "" }; redrawAdoptNotice(); }
    else if (action === "adopt-legacy-confirm") adoptLegacyArchive();
    else if (action === "mark-done" || action === "skip-work" || action === "unmark-work") await handleWorkMark(actionNode, action);
    else if (action === "dismiss-recreated") {
      state.recreatedSeen = state.archiveRecreatedAt;
      dash.accountBinding.saveScoped(chrome.storage.local, mod.RECREATED_SEEN_KEY, state.account.id, state.recreatedSeen);
      main()?.querySelector("[data-archive-recreated]")?.remove();
    } else if (action === "select-day") {
      render.keepScroll = true;
      const params = new URLSearchParams(location.hash.split("?")[1] || "");
      params.set("month", actionNode.dataset.month || actionNode.dataset.day.slice(0, 7));
      params.set("day", actionNode.dataset.day);
      location.hash = ;
    else if (action === "read-update" || action === "toggle-read" || action === "mark-all-read") handleReadUpdates(actionNode, action);
    else if (action === "open-file") openArchivedFile(actionNode.dataset.path);
    else if (action === "preview-file") previewFile(actionNode);
    else if (action === "confirm-link") openConfirmedLink();
    else if (action === "close-link-confirm") {
      if (!actionNode.dataset.backdrop || event.target === actionNode) closeLinkConfirm();
    } else if (action === "reload-page") location.reload();
    else if (action === "close-preview") {
      if (!actionNode.dataset.backdrop || event.target === actionNode) closePreview();
    } else if (action === "modules") {
      for (const node of main().querySelectorAll("details.module:not(.pinned)")) node.open = actionNode.dataset.open === "true";
      syncModulesButton();
    } else if (action === "toggle-course") handleCourseToggle(actionNode);
    else if (action === "toggle-download-files") {
      await saveSettings({ downloadCourseFiles: state.settings.downloadCourseFiles !== true });
      render.keepScroll = true;
      render();
    } else if (action === "set-look") {
      await saveLook({ [actionNode.dataset.key]: actionNode.dataset.value });
      render();
    } else if (action === "clear-previews") {
      await dash.fileCache?.clear(fileScope()).catch(() => {});
      toast("Saved previews cleared.");
      render();
    }
  }

  function handleReadUpdates(actionNode, action) {
    if (action === "read-update") {
      mod.markRead([actionNode.dataset.updateId]);
    } else if (action === "toggle-read") {
      mod.markRead([actionNode.dataset.updateId], !state.read[actionNode.dataset.updateId]);
      render.keepScroll = true;
      render();
    } else if (action === "mark-all-read") {
      mod.markRead(dash.updateRows(state.index, state.read).map((row) => row.id));
      render.keepScroll = true;
      render();
    }
  }

  Object.assign(mod, { handleCustomSyllabusClick, handleCopyInstructorClick, handleActionClick });
})(typeof window !== "undefined" ? window : globalThis);
