// Text exports must not pile up in the browser's download history (13k records
// froze Vivaldi after each launch). downloadText erases each record once the
// file lands; Save As downloads and the files themselves are left alone.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const erased = [];
let nextId = 1;
const listeners = new Set();
const chrome = {
  downloads: {
    download: async () => {
      const id = nextId++;
      setTimeout(() => listeners.forEach((fn) => fn({ id, state: { current: "complete" } })), 5);
      return id;
    },
    search: async ({ id }) => [{ id, state: listeners.size ? "in_progress" : "complete" }],
    erase: async ({ id }) => { erased.push(id); return [id]; },
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) }
  }
};

const context = {
  chrome,
  setTimeout,
  clearTimeout,
  D2LExtractorShared: { normalizeText: String, slug: String, createDataUrl: () => "data:text/plain,x", flattenItem: () => ({}), parseColumns: () => [] },
  D2LExtractorBackground: {}
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../src/background/downloads.js", import.meta.url), "utf8"), context);
const { downloadText } = context.D2LExtractorBackground;

await downloadText("D2L Export/x/a.md", "a", "text/markdown");
await downloadText("D2L Export/x/b.json", "b", "application/json");
await downloadText("D2L Export/x/c.md", "c", "text/markdown", true);
await new Promise((resolve) => setTimeout(resolve, 50));

assert.deepEqual(erased.sort(), [1, 2], "silent text exports are erased from history; Save As is kept");
assert.equal(listeners.size, 0, "no onChanged listeners left behind");
console.log("download history erase: ok");
