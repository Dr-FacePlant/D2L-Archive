// When the model is in memory: only after Start, and let go again on leaving Ask.
// Tested with a stand-in engine that counts what is loaded at any moment, so a model
// left behind (or two loaded at once) shows up as a number.
import { loadDashboard } from "./test-dashboard-loader.mjs";

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const dash = loadDashboard();

const later = () => { let open; const wait = new Promise((resolve) => { open = resolve; }); return { wait, open }; };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeEngine({ found = { state: "idle" }, failLoads = 0, loadGate = null, unloadGate = null } = {}) {
  const log = { checks: 0, loads: 0, unloads: 0, inMemory: 0, peak: 0, events: [] };
  let pending = null;
  const engine = {
    check: async () => { log.checks += 1; return found; },
    load: (onProgress) => {
      log.loads += 1;
      log.events.push("load");
      const attempt = log.loads;
      pending = (async () => {
        onProgress?.(0.5);
        if (loadGate) await loadGate.wait;
        if (attempt <= failLoads) throw new Error("no memory left");
        log.inMemory += 1;
        log.peak = Math.max(log.peak, log.inMemory);
        onProgress?.(1);
      })();
      return pending;
    },
    unload: async () => {
      if (pending) await pending.catch(() => {});
      pending = null;
      log.events.push("unload-begins");
      if (unloadGate) await unloadGate.wait;
      log.unloads += 1;
      log.inMemory = 0;
      log.events.push("unload-ends");
    }
  };
  return { engine, log };
}

function lifecycleOver(options) {
  const fake = fakeEngine(options);
  const changes = [];
  const life = dash.createModelLifecycle({ createEngine: () => fake.engine, onChange: (kind) => changes.push(kind) });
  return { life, changes, ...fake };
}

// Opening Ask only looks; nothing is loaded until Start.
const a = lifecycleOver();
check(a.life.state === "checking", "a new lifecycle starts by checking");
await a.life.check();
check(a.life.state === "idle" && a.log.loads === 0 && a.log.inMemory === 0, "opening Ask only checks; the model is not loaded");
await a.life.check();
check(a.log.loads === 0, "checking again still loads nothing");

// Start loads once, reports progress, and a second press joins it.
const first = a.life.start();
const second = a.life.start();
check(a.life.state === "loading", "Start shows loading at once");
await Promise.all([first, second]);
check(a.life.state === "ready" && a.life.percent === 100 && a.log.loads === 1 && a.log.inMemory === 1, "Start loads the model once, even if pressed twice");
check(a.changes.includes("progress") && a.changes.at(-1) === "state", "progress is reported while loading, and the end is announced");
await a.life.start();
check(a.log.loads === 1, "starting when already started loads nothing more");
await a.life.check();
check(a.life.state === "ready", "checking a started model leaves it started");

// Leaving Ask lets go.
a.life.leave({ busy: false });
check(a.life.state === "idle", "leaving Ask returns to the Start state");
await a.life.unloaded;
check(a.log.inMemory === 0 && a.log.unloads === 1, "leaving Ask frees the model's memory");
a.life.leave({ busy: false });
await a.life.unloaded;
check(a.log.unloads === 1, "leaving again frees nothing twice");

// Coming back loads afresh, only on Start.
await a.life.start();
check(a.life.state === "ready" && a.log.loads === 2 && a.log.inMemory === 1 && a.log.peak === 1, "Start after leaving loads a fresh copy, never two at once");

// Leaving while an answer is being written waits for it to finish.
a.life.leave({ busy: true });
check(a.life.state === "ready" && a.log.unloads === 1, "the model stays while an answer is being written");
a.life.settled({ busy: true });
check(a.life.state === "ready", "it is kept while still busy");
a.life.settled({ busy: false });
await a.life.unloaded;
check(a.life.state === "idle" && a.log.inMemory === 0, "once the answer is done the model is freed");
await a.life.start();
a.life.leave({ busy: true });
a.life.stay();
a.life.settled({ busy: false });
check(a.life.state === "ready" && a.log.inMemory === 1, "coming back to Ask before the answer ends keeps the model");
a.life.release();
await a.life.unloaded;

// Leaving while it is still loading must not leave the model behind.
const gate = later();
const b = lifecycleOver({ loadGate: gate });
await b.life.check();
const loadingNow = b.life.start();
await settle();
b.life.leave({ busy: false });
gate.open();
await loadingNow;
await b.life.unloaded;
check(b.life.state === "idle" && b.log.inMemory === 0, "leaving mid-load ends with nothing in memory and no 'ready'");

// Start right after leaving waits for the old copy to be gone, then loads.
const slowGate = later();
const c = lifecycleOver({ unloadGate: slowGate });
await c.life.check();
await c.life.start();
c.life.leave({ busy: false });
const again = c.life.start();
await settle();
check(c.log.loads === 1 && c.life.state === "loading", "a new Start waits while the old copy is still being freed");
slowGate.open();
await again;
check(c.log.events.join() === "load,unload-begins,unload-ends,load" && c.log.peak === 1 && c.life.state === "ready", "the old copy is freed before the new one loads");

// Leaving twice while the old copy is still being freed must not start a load afterwards.
const holdGate = later();
const d = lifecycleOver({ unloadGate: holdGate });
await d.life.check();
await d.life.start();
d.life.leave({ busy: false });
const abandoned = d.life.start();
await settle();
d.life.leave({ busy: false });
holdGate.open();
await abandoned;
await d.life.unloaded;
check(d.log.loads === 1 && d.life.state === "idle" && d.log.inMemory === 0, "a start that was left before it began never loads");
check(d.log.events.join() === "load,unload-begins,unload-ends,unload-begins,unload-ends", "freeing the model never overlaps an earlier freeing");

// A failed start says why, and Try again works.
const e = lifecycleOver({ failLoads: 1 });
await e.life.check();
await e.life.start();
check(e.life.state === "error" && /no memory left/.test(e.life.reason) && e.log.inMemory === 0, "a failed start shows the reason");
await e.life.start();
check(e.life.state === "ready" && e.log.loads === 2, "Try again loads the model");

// Missing files and no graphics card are reported, never loaded.
const f = lifecycleOver({ found: { state: "missing", reason: "Missing model files: tokenizer.json." } });
await f.life.check();
check(f.life.state === "missing" && /tokenizer\.json/.test(f.life.reason) && f.log.loads === 0, "missing model files are reported and nothing loads");
const g = lifecycleOver({ found: { state: "no-gpu", reason: "no WebGPU" } });
await g.life.check();
check(g.life.state === "no-gpu" && g.life.reason === "no WebGPU" && g.log.loads === 0, "no graphics card is reported and nothing loads");

if (failures.length) {
  console.error(failures.map((message) => `FAIL: ${message}`).join("\n"));
  process.exit(1);
}
console.log("Ask lifecycle tests passed.");
