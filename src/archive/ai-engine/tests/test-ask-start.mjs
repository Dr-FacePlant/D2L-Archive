// The "Start Ask?" pop-up (src/dashboard/ask/start-prompt.js): a question sent before the
// model is loaded asks first, waits while it loads, and is sent once; Not now, Esc or a
// press elsewhere puts it back in the box; Don't ask again is saved and then honoured.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const source = fs.readFileSync(path.join(root, "src/dashboard/ask/start-prompt.js"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve));

// A stand-in page: the pop-up's slot, its checkbox, and document events.
function setup({ state = "idle", settings = {}, startTo = "ready" } = {}) {
  const listeners = {};
  const context = vm.createContext({ D2LDashboard: {}, document: { addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) } });
  vm.runInContext(source, context);
  const page = { slot: { innerHTML: "", focused: false, querySelector() { return { focus: () => { page.slot.focused = true; } }; } }, again: { checked: false } };
  const $ = (selector) => selector === "#ask-start-slot" ? page.slot : selector === "#ask-start-again" && page.slot.innerHTML ? page.again : null;
  let finish = () => {};
  const life = { state, starts: 0, start() { life.starts += 1; life.state = "loading"; return new Promise((resolve) => { finish = () => { life.state = startTo; resolve(); }; }); } };
  const log = { sent: [], back: [], saved: [], changes: 0 };
  const starter = context.D2LDashboard.createAskStart({
    life, $, settings: () => settings, saveSettings: (patch) => { log.saved.push(patch); Object.assign(settings, patch); },
    send: (question) => log.sent.push(question), putBack: (question) => log.back.push(question), onChange: () => { log.changes += 1; }
  });
  // inside: the press lands inside the pop-up; hit: the selector the pressed element matches.
  const fire = (type, { hit = "", inside = false, key = "" } = {}) => {
    const event = { key, stopped: false, target: { closest: (selector) => (selector === hit || (inside && selector === "#ask-start-pop") ? {} : null) }, preventDefault() {}, stopImmediatePropagation() { event.stopped = true; } };
    for (const fn of listeners[type] || []) fn(event);
    return event;
  };
  return { starter, life, page, log, fire, finish: async () => { finish(); await tick(); }, context };
}

// ---- the first send asks first ------------------------------------------------------------
{
  const { starter, life, page, log } = setup();
  starter.request("What is due?");
  check(page.slot.innerHTML.includes("Start Ask?") && page.slot.innerHTML.includes("1.4 GB") && page.slot.innerHTML.includes("Don't ask again") && page.slot.innerHTML.includes("Start and send") && page.slot.innerHTML.includes("Not now"), "a question sent before Start opens the pop-up, which says what starting does");
  check(page.slot.focused && starter.asking === "What is due?" && life.starts === 0 && !log.sent.length, "the pop-up takes the focus, and nothing is loaded or sent yet");
  starter.request("Another?");
  check(log.back.includes("Another?") && starter.asking === "What is due?", "a second question sent while it is open goes back in the box");
}

// ---- Start and send: loads, waits, sends once ------------------------------------------------
{
  const { starter, life, page, log, fire, finish } = setup();
  starter.request("What is due?");
  fire("click", { hit: "[data-ask-start-go]" });
  check(life.starts === 1 && page.slot.innerHTML === "" && starter.waiting === "What is due?" && log.changes > 0 && !log.sent.length, "Start and send closes the pop-up and starts the model; the question waits in the chat");
  check(!log.saved.length, "without Don't ask again nothing is saved");
  await finish();
  check(log.sent.length === 1 && log.sent[0] === "What is due?" && starter.waiting === "", "once the model is ready the question is sent, once");
}

// ---- Don't ask again --------------------------------------------------------------------------
{
  const settings = {};
  const { starter, life, page, fire } = setup({ settings });
  starter.request("Q1");
  page.again.checked = true;
  fire("click", { hit: "[data-ask-start-go]" });
  check(settings.askStartWithoutAsking === true && life.starts === 1, "Don't ask again is saved with the settings");
  const next = setup({ settings: { askStartWithoutAsking: true } });
  next.starter.request("Q2");
  check(next.page.slot.innerHTML === "" && next.life.starts === 1 && next.starter.waiting === "Q2", "after Don't ask again, a send starts the model with no pop-up");
}

// ---- Not now, Esc, or a press elsewhere puts the question back ------------------------------------
{
  const { starter, life, page, log, fire } = setup();
  starter.request("Q1");
  fire("click", { hit: "[data-ask-start-cancel]" });
  check(page.slot.innerHTML === "" && log.back.at(-1) === "Q1" && life.starts === 0, "Not now closes the pop-up and puts the question back in the box");
  starter.request("Q2");
  const esc = fire("keydown", { key: "Escape" });
  check(page.slot.innerHTML === "" && log.back.at(-1) === "Q2" && esc.stopped, "Esc closes only the pop-up (not the archive window) and puts the question back");
  check(!fire("keydown", { key: "Escape" }).stopped, "with the pop-up closed, Esc is left to the rest of the page");
  starter.request("Q3");
  fire("pointerdown", { inside: true });
  check(starter.asking === "Q3", "pressing inside the pop-up keeps it open");
  fire("pointerdown", {});
  check(page.slot.innerHTML === "" && log.back.at(-1) === "Q3" && life.starts === 0, "a press anywhere else is Not now");
}

// ---- when the model can't start ------------------------------------------------------------------
{
  for (const state of ["missing", "no-gpu", "checking"]) {
    const { starter, life, page, log } = setup({ state });
    starter.request("Q");
    check(page.slot.innerHTML === "" && life.starts === 0 && log.back.at(-1) === "Q", `while the model is ${state}, a question goes back in the box and nothing starts`);
  }
  const failed = setup({ startTo: "error" });
  failed.starter.request("Q");
  failed.fire("click", { hit: "[data-ask-start-go]" });
  await failed.finish();
  check(!failed.log.sent.length && failed.log.back.at(-1) === "Q" && failed.starter.waiting === "", "a start that fails sends nothing and puts the question back");
  const retry = setup({ state: "error" });
  retry.starter.request("Q");
  check(retry.page.slot.innerHTML.includes("Start Ask?"), "after a failed start, sending asks again");
}

// ---- a start already under way, a new chat, leaving Ask ------------------------------------------
{
  const joined = setup({ state: "loading" });
  joined.starter.request("Q");
  check(joined.page.slot.innerHTML === "" && joined.life.starts === 1 && joined.starter.waiting === "Q", "a question sent while the model loads (after Try again) waits for that start, with no pop-up");
  const left = setup();
  left.starter.request("Q");
  left.fire("click", { hit: "[data-ask-start-go]" });
  left.starter.reset();
  await left.finish();
  check(!left.log.sent.length && left.starter.waiting === "", "after a new chat or leaving Ask, the waiting question is not sent");
  const open = setup();
  open.starter.request("Q");
  open.starter.reset();
  check(open.page.slot.innerHTML === "" && !open.log.back.length && open.starter.asking === "", "reset closes an open pop-up");
}

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Ask start pop-up tests passed.");
