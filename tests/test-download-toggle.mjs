import assert from "node:assert/strict";
import { loadBackgroundHooks } from "./test-production-loader.mjs";

// Course-file downloads are opt-in: a missing setting means off, and the
// explicit override exists only for callers that already decided for the run.
let settings;
let plantedArchive = "";
const downloads = [];
const completedFilename = "/Users/x/Downloads/D2L Export/d2l-export-test/courses/900001-synthetic/files/reading.pdf";

const hooks = loadBackgroundHooks({
  chrome: {
    runtime: { getURL: (file = "") => `chrome-extension://testid/${file}` },
    storage: {
      local: {
        get: async (key) => (key === "dashboardSettings" && settings !== undefined ? { dashboardSettings: settings } : {})
      }
    },
    downloads: {
      download: async ({ filename }) => { downloads.push(filename); return downloads.length; },
      search: async (query = {}) => {
        if (query.id !== undefined) return [{ id: query.id, state: "complete", filename: completedFilename }];
        return plantedArchive ? [{ state: "complete", filename: plantedArchive }] : [];
      },
      erase: async () => [],
      onChanged: { addListener() {}, removeListener() {} }
    }
  }
});

const repository = { recordActivity: async () => {} };
const row = () => ({
  courseOrgUnitId: "900001",
  courseTitle: "Synthetic Art Course",
  title: "Reading",
  downloadUrl: "https://d2l.test/file/reading.pdf",
  evidenceId: "reading"
});
const setSetting = (value) => { settings = value; };

// 1. No stored setting at all: off.
settings = undefined;
let current = row();
assert.equal(await hooks.downloadCourseFiles([current], "D2L Export/d2l-export-test", { repository }), 0);
assert.equal(downloads.length, 0, "a missing setting must not download files");
assert.equal(current.localPath, "", "a skipped row keeps an empty local path");

// 2. Explicitly off.
setSetting({ downloadCourseFiles: false });
current = row();
assert.equal(await hooks.downloadCourseFiles([current], "D2L Export/d2l-export-test", { repository }), 0);
assert.equal(downloads.length, 0);

// 3. On: the existing download behaviour is unchanged.
setSetting({ downloadCourseFiles: true });
current = row();
assert.equal(await hooks.downloadCourseFiles([current], "D2L Export/d2l-export-test", { repository }), 1);
assert.equal(downloads.length, 1);
assert.match(downloads[0], /^D2L Export\/d2l-export-test\/courses\/900001-Synthetic-Art-Course\/files\/Reading\.html$/);
assert.ok(current.localPath, "a downloaded row records where it landed");

// 4. An explicit override wins in both directions.
setSetting({ downloadCourseFiles: true });
assert.equal(await hooks.downloadCourseFiles([row()], "D2L Export/d2l-export-test", { repository, downloadFiles: false }), 0);
setSetting({ downloadCourseFiles: false });
assert.equal(await hooks.downloadCourseFiles([row()], "D2L Export/d2l-export-test", { repository, downloadFiles: true }), 1);
assert.equal(downloads.length, 2);

// 5. Files already on disk stay linked even with downloads off.
setSetting({ downloadCourseFiles: false });
plantedArchive = "/Users/x/Downloads/D2L Export/d2l-export-test/courses/900001-synthetic/files/reading.pdf";
current = row();
const before = downloads.length;
assert.equal(await hooks.downloadCourseFiles([current], "D2L Export/d2l-export-test", { repository, reuseArchivedFiles: true }), 0);
assert.equal(downloads.length, before, "reusing an archived copy is not a new download");
assert.equal(current.localPath, "D2L Export/d2l-export-test/courses/900001-synthetic/files/reading.pdf", "the archived copy is still linked when downloads are off");

console.log("Course-file downloads follow the opt-in setting and explicit overrides.");
