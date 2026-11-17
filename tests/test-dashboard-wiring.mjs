// Wiring checks for the dashboard. The dashboard is plain scripts that share
// state through `dash.appModules`, so a name that is not destructured in a file
// is a runtime ReferenceError that no syntax check can see. The Oct/Nov 2026
// refactor split one file into many and lost names, handlers and attributes;
// these checks fail the build when that happens again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "dashboard");
const files = fs.readdirSync(dir).filter((file) => file.endsWith(".js")).sort();
const raw = Object.fromEntries(files.map((file) => [file, fs.readFileSync(path.join(dir, file), "utf8")]));

// Drop comments, string bodies, template bodies and regular-expression bodies so
// a call or name mentioned in prose, markup or a pattern is not mistaken for code.
const REGEX_START = /[=(,:;[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/;
function stripNoise(text) {
  let i = 0;
  let out = "";
  const skipQuoted = (quote) => {
    i++;
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\") i++;
      i++;
    }
    i++;
  };
  const skipLineComment = () => { while (i < text.length && text[i] !== "\n") i++; };
  const skipBlockComment = () => { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; };
  const skipRegex = () => {
    i++;
    let inClass = false;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\") { i += 2; continue; }
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) { i++; break; }
      else if (ch === "\n") break;
      i++;
    }
  };
  const skipTemplate = () => {
    i++;
    while (i < text.length && text[i] !== "`") {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === "$" && text[i + 1] === "{") { i += 2; skipBraced(); continue; }
      i++;
    }
    i++;
  };
  const skipBraced = () => {
    i++;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const c = text[i];
      const n = text[i + 1];
      if (c === "{") { depth++; i++; }
      else if (c === "}") { depth--; i++; }
      else if (c === '"' || c === "'") skipQuoted(c);
      else if (c === "`") skipTemplate();
      else if (c === "/" && n === "/") skipLineComment();
      else if (c === "/" && n === "*") skipBlockComment();
      else i++;
    }
  };
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") { skipLineComment(); out += "\n"; continue; }
    if (c === "/" && n === "*") { skipBlockComment(); out += " "; continue; }
    if (c === '"' || c === "'") { skipQuoted(c); out += " '' "; continue; }
    if (c === "`") { skipTemplate(); out += " `` "; continue; }
    if (c === "/" && REGEX_START.test(out.trimEnd().slice(-8))) { skipRegex(); out += " "; continue; }
    out += c;
    i++;
  }
  return out;
}

const code = Object.fromEntries(Object.entries(raw).map(([file, text]) => [file, stripNoise(text)]));
const allCode = Object.values(code).join("\n");
const allRaw = Object.values(raw).join("\n");

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const KEYWORD_CALLS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "function", "async",
  "await", "new", "delete", "void", "in", "of", "do", "else", "try", "throw", "yield",
  "import"
]);
const BUILTIN_CALLS = new Set([
  "Array", "Audio", "Blob", "Boolean", "CSS", "Date", "Error", "File", "FileReader",
  "FormData", "Image", "IntersectionObserver", "Map", "MutationObserver", "Number",
  "Object", "OffscreenCanvas", "Promise", "RegExp", "ResizeObserver", "Set", "String",
  "ArrayBuffer", "CustomEvent", "DOMParser", "DataView", "Event", "Int8Array",
  "TextDecoder", "TextEncoder", "Uint8Array", "Uint8ClampedArray", "URL",
  "URLSearchParams", "XMLHttpRequest", "XMLSerializer", "alert", "atob", "btoa",
  "clearInterval", "clearTimeout", "confirm", "createImageBitmap", "getComputedStyle",
  "decodeURIComponent", "encodeURIComponent", "fetch", "isFinite", "isNaN",
  "matchMedia", "parseFloat", "parseInt", "prompt", "queueMicrotask",
  "requestAnimationFrame", "requestIdleCallback", "setInterval", "setTimeout",
  "structuredClone"
]);

function parts(list) {
  return list.split(",").map((part) => part.trim()).filter(Boolean);
}

function localNames(list) {
  return parts(list)
    .map((part) => part.replace(/^\.\.\./, "").split(":").pop())
    .map((part) => part.replace(/\s*=.*$/, "").trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

function sourceNames(list) {
  return parts(list)
    .map((part) => part.replace(/^\.\.\./, "").split(":")[0])
    .map((part) => part.replace(/\s*=.*$/, "").trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

function declaredIn(text) {
  const names = new Set();
  for (const m of text.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) localNames(m[1]).forEach((n) => names.add(n));
  for (const m of text.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) localNames(m[1]).forEach((n) => names.add(n));
  for (const m of text.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) localNames(m[1]).forEach((n) => names.add(n));
  for (const m of text.matchAll(/\(([^()]*)\)\s*=>/g)) localNames(m[1]).forEach((n) => names.add(n));
  for (const m of text.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of text.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/(?:dash|mod|globalThis\.D2LDashboard)\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  for (const m of text.matchAll(/(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function|\()/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) names.add(m[1]);
  return names;
}

// Everything a module publishes: keys of `Object.assign(mod|dash, { … })` and
// namespace objects created with `dash.name ||= {}`.
const exported = new Set();
function exportBlocks(text) {
  const blocks = [];
  for (const m of text.matchAll(/Object\.assign\(\s*(?:dash|mod)\s*,\s*\{/g)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    blocks.push(text.slice(start + 1, i));
  }
  return blocks;
}
for (const text of Object.values(code)) {
  for (const block of exportBlocks(text)) {
    for (const part of parts(block)) {
      const key = part.split(":").shift().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(key)) exported.add(key);
    }
  }
  for (const m of text.matchAll(/(?:dash|globalThis\.D2LDashboard)\.([A-Za-z_$][\w$]*)\s*(?:\|\|=|=)/g)) exported.add(m[1]);
}

for (const [file, text] of Object.entries(code)) {
  for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:mod|dash\.appModules|dash)\s*;/g)) {
    for (const name of sourceNames(m[1])) check(exported.has(name), `${file}: takes ${name} from the shared module, but no file exports it`);
  }
  for (const m of text.matchAll(/(?:dash|mod)\.([A-Za-z_$][\w$]*)/g)) {
    if (m[1] === "appModules") continue;
    check(exported.has(m[1]), `${file}: reads ${m[1]} from the shared module, but no file exports it`);
  }
}

for (const [file, text] of Object.entries(code)) {
  const declared = declaredIn(text);
  const called = new Set();
  for (const m of text.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/gm)) called.add(m[1]);
  for (const name of called) {
    if (declared.has(name) || BUILTIN_CALLS.has(name) || KEYWORD_CALLS.has(name)) continue;
    check(false, `${file}: calls ${name}(), which is not declared or destructured in that file`);
  }
}

const markup = Object.entries(raw)
  .filter(([file]) => /^(?:app-render|render-|model-)/.test(file))
  .map(([, text]) => text)
  .join("\n");
const handlers = Object.entries(raw)
  .filter(([file]) => /^app-(?:events|preview|palette|selfcheck|appearance|archive)/.test(file))
  .map(([, text]) => text)
  .join("\n");

for (const m of markup.matchAll(/data-action="([a-z0-9-]+)"/g)) {
  const wired = new RegExp(`["\x27]${m[1]}["\x27]|data-action=${m[1]}(?![\\w-])`).test(handlers);
  check(wired, `markup emits data-action="${m[1]}" but no handler file mentions it`);
}

for (const m of allCode.matchAll(/dataset\.([A-Za-z_$][\w$]*)/g)) {
  const kebab = m[1].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const written = new RegExp(`data-${kebab}(?![\\w-])`).test(allRaw) || new RegExp(`dataset\\.${m[1]}\\s*=`).test(allRaw);
  check(written, `code reads dataset.${m[1]} but no data-${kebab} attribute is written`);
}

const events = code["app-events.js"] || "";
const eventsRaw = raw["app-events.js"] || "";
check(/target\.dataset\.taskId/.test(events), "the checklist change handler must read dataset.taskId, which is the attribute the markup writes");
check(/await setChecklistDone\([^)]*\);\s*\n\s*render\(location\.hash\);/.test(events), "ticking a checklist item must save and then redraw the page");
check(/\[data-action=set-reminder\]/.test(eventsRaw), "the sync reminder select needs its change handler back");
check(/\{[\s\S]*\bdetailRoot\b[\s\S]*\}\s*=\s*mod;/.test(events), "app-events.js must take detailRoot from the shared module");
check(/\{[\s\S]*\brenderSyncStatus\b[\s\S]*\}\s*=\s*mod;/.test(events), "app-events.js must take renderSyncStatus from the shared module");
check(/epub-prev/.test(raw["app-events-actions.js"] || ""), "the EPUB page buttons need their click handler back");

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Dashboard modules, handlers and data attributes stay wired together.");
