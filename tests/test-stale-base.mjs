import { appSource } from "./app-source.mjs";
// Changing a checklist tick or read state while a detail layer is open must
// mark the page underneath stale, so closing the layer shows the new list
// instead of the old one (reported Oct 11, 2026).
import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(root, "..");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const app = appSource();
const body = (name) => app.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n`))?.[0] || "";

check(/if \(state\.detail\) state\.baseStale = true;/.test(body("setChecklistDone")), "ticking a checklist item should mark the base page stale");
check(/if \(state\.detail\) state\.baseStale = true;/.test(body("markRead")), "changing read state should mark the base page stale");
check(/if \(state\.detail\) state\.baseStale = true;/.test(body("setWorkMark")), "marking work done should still mark the base page stale");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Checklist and read changes refresh the page under an open detail layer.");
