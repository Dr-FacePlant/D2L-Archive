// Opening archived files.
(function initDashboardAppFiles(global) {
  const dash = global.D2LDashboard ||= {};
  const mod = dash.appModules ||= {};
  const { state, toast } = dash.appModules;
  // -------------------------------------------------------------- files

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function openArchivedFile(localPath) {
    try {
      const matches = await chrome.downloads.search({ filenameRegex: `${escapeRegex(localPath)}$`, exists: true, state: "complete", limit: 1 });
      if (!matches.length) {
        toast("That file isn't on this computer anymore. Sync to save it again.");
        return;
      }
      try {
        await chrome.downloads.open(matches[0].id);
      } catch {
        chrome.downloads.show(matches[0].id);
      }
    } catch (error) {
      toast(`Couldn't open the file: ${error.message}`);
    }
  }

  Object.assign(mod, { escapeRegex, openArchivedFile });
})(globalThis);
