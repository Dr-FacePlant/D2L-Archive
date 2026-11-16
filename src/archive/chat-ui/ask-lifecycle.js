// When the model is in memory. It is loaded only when you press Start (about 1.4 GB
// of memory and graphics memory) and let go again when you leave Ask, so it never
// sits in memory unseen. States: checking → idle → loading → ready → (leave) → idle,
// or missing / no-gpu / error. No screen code here; the screen listens through onChange.
(function initDashboardAskLifecycle(global) {
  const dash = global.D2LDashboard ||= {};

  const IN_MEMORY = ["ready", "loading"];

  // onChange("state") after any change of state, onChange("progress") while loading.
  function createModelLifecycle({ createEngine = () => dash.createLocalEngine(), onChange = () => {} } = {}) {
    let engine = null;
    let state = "checking";
    let reason = "";
    let percent = 0;
    let epoch = 0;
    let starting = null;
    let unloading = Promise.resolve();
    let releaseWhenDone = false;

    const make = () => (engine ||= createEngine());
    const set = (next, why = "", done = 0) => {
      state = next; reason = why; percent = done;
      onChange("state");
    };

    // Looks at the graphics card and the model files. Loads nothing, so it is cheap.
    async function check() {
      if (starting || IN_MEMORY.includes(state)) return;
      const mine = make();
      set("checking");
      const found = await mine.check();
      if (starting || IN_MEMORY.includes(state)) return;
      set(found.state, found.reason || "");
    }

    // Loads the model. Asking again while it loads joins that start.
    function start() {
      if (state === "ready") return Promise.resolve();
      if (starting) return starting;
      const mine = make();
      const here = epoch += 1;
      set("loading");
      const run = (async () => {
        await unloading;
        if (here !== epoch) return;
        await mine.load((fraction) => {
          const next = Math.round(fraction * 100);
          if (here !== epoch || next === percent) return;
          percent = next;
          onChange("progress");
        });
        if (here === epoch) set("ready", "", 100);
      })().catch((error) => {
        if (here === epoch) set("error", error.message);
      }).finally(() => {
        if (starting === run) starting = null;
      });
      starting = run;
      return run;
    }

    // Lets the model's memory go. A start still under way is stopped and undone.
    function release() {
      epoch += 1;
      releaseWhenDone = false;
      starting = null;
      if (!engine || !IN_MEMORY.includes(state)) return;
      set("idle");
      const mine = engine;
      const before = unloading;
      unloading = (async () => {
        await before;
        await mine.unload().catch(() => {});
      })();
    }

    // Leaving Ask: let go now, or once the answer being written is done.
    function leave({ busy = false } = {}) {
      if (busy) releaseWhenDone = true;
      else release();
    }

    // An answer has finished; carry out a leave that was waiting for it.
    function settled({ busy = false } = {}) {
      if (releaseWhenDone && !busy) release();
    }

    // Back on Ask before the waiting leave happened: keep the model.
    function stay() {
      releaseWhenDone = false;
    }

    return {
      check, start, release, leave, settled, stay,
      get state() { return state; },
      get reason() { return reason; },
      get percent() { return percent; },
      get engine() { return make(); },
      get unloaded() { return unloading; }
    };
  }

  Object.assign(dash, { createModelLifecycle });
})(globalThis);
