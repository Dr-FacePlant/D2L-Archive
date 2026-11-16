// Local Phonon speech: load the bundled model on demand, stream audio, and stop cleanly.
(function initAskPhononPlayback(global) {
  const dash = global.D2LDashboard ||= {};
  const RUNTIME = "vendor/phonon-tts/index.js";
  const MODEL = "models/phonon-31m-en/";
  // Maeve speaks. The model's own voice is the way out if her file is not there.
  const VOICES = ["maeve-voice.safetensors", "default-voice.safetensors"];

  function speechText(text) {
    let spoken = String(text || "");
    if (global.document && dash.askAnswerMarkdownHtml) {
      const container = global.document.createElement("div");
      container.innerHTML = dash.askAnswerMarkdownHtml(spoken);
      container.querySelectorAll("br").forEach((item) => item.replaceWith("\n"));
      container.querySelectorAll("td, th").forEach((item) => item.append(". "));
      container.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, tr, pre, blockquote").forEach((item) => item.append("\n"));
      spoken = container.textContent || "";
    }
    return spoken.replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/```[^\n]*\n?/g, "").replace(/[`*_~#>|]/g, " ")
      .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function createPhononPlayback({
    onChange = () => {},
    fileUrl = (path) => global.chrome.runtime.getURL(path),
    importRuntime = (url) => import(url),
    createAudioContext = () => new (global.AudioContext || global.webkitAudioContext)()
  } = {}) {
    let state = "idle", model = null, loading = null, context = null, controller = null, active = false, generation = 0, wakeTalk = () => {};
    const sources = new Set();
    // Short lines that come back (voice mode's "One moment.") are made once and replayed. Kept in memory only, for as long as this speaker lives.
    const kept = new Map();
    const notify = (next, error = "") => { state = next; onChange({ state, error }); };

    function releaseWhenUnused() {
      if (loading) loading.then((engine) => { if (!active && model === engine) { model = null; engine.dispose(); } }).catch(() => {});
    }

    function load() {
      if (model) return Promise.resolve(model);
      if (!loading) {
        loading = (async () => {
          const { PhononTTS } = await importRuntime(fileUrl(RUNTIME));
          let engine;
          for (const [index, voice] of VOICES.entries()) {
            try {
              engine = await PhononTTS.load({
                lang: "en", quant: "f32", device: "cpu", threads: 1, cache: false,
                model: {
                  weights: { f32: fileUrl(`${MODEL}model.safetensors`) },
                  tokenizer: fileUrl(`${MODEL}tokenizer.json`), config: fileUrl(`${MODEL}config.json`),
                  voices: { default: fileUrl(`${MODEL}${voice}`) }, defaultVoice: "default"
                }
              });
              break;
            } catch (error) { if (index === VOICES.length - 1) throw error; }
          }
          model = engine;
          return engine;
        })().finally(() => { loading = null; });
      }
      return loading;
    }

    function stop({ silent = false } = {}) {
      generation += 1; active = false; controller?.abort(); controller = null; wakeTalk();
      for (const source of sources) { try { source.stop(); } catch {} }
      sources.clear();
      if (context) { const old = context; context = null; try { Promise.resolve(old.close()).catch(() => {}); } catch {} }
      // A worker already loading cannot be aborted. Release it when it finishes unless a new request needs it.
      releaseWhenUnused();
      if (silent) state = "idle"; else notify("idle");
    }

    // A talk: sentences are handed in with say() while the model is still writing them, and each is
    // spoken as soon as the one before is made. end() says there are no more and settles when the
    // last sound has played (true) or the talk was stopped or failed (false). say(text, { keep: true }) marks a
    // line that is not the answer: it is remembered once made, and speaking it is not the answer starting.
    function begin({ onPlaying = () => {} } = {}) {
      stop({ silent: true });
      const mine = generation;
      active = true;
      controller = new AbortController();
      const signal = controller.signal;
      const queue = [];
      let closed = false, announced = false, wake = () => {};
      wakeTalk = () => wake();
      const finished = (async () => {
        let audio;
        try {
          // Start the audio context during the click, before loading the model can outlive the gesture.
          audio = createAudioContext(); context = audio;
          const resumed = audio.resume ? audio.resume() : Promise.resolve();
          notify("loading");
          const [engine] = await Promise.all([load(), resumed]);
          const endings = [];
          let next = audio.currentTime;
          for (;;) {
            while (mine === generation && !queue.length && !closed) await new Promise((resolve) => { wake = resolve; });
            if (mine !== generation) return false;
            if (!queue.length) break;
            const line = queue.shift();
            const again = line.keep && kept.get(line.text);
            const made = [];
            for await (const chunk of again || engine.stream(line.text, { signal })) {
              if (mine !== generation) break;
              if (!chunk.length) continue;
              if (line.keep && !again) made.push(chunk.slice());
              const buffer = audio.createBuffer(1, chunk.length, engine.sampleRate);
              buffer.getChannelData(0).set(chunk);
              const source = audio.createBufferSource(); source.buffer = buffer; source.connect(audio.destination);
              sources.add(source);
              endings.push(new Promise((resolve) => { source.onended = () => { sources.delete(source); resolve(); }; }));
              next = Math.max(next, audio.currentTime); source.start(next); next += buffer.duration;
              if (state !== "playing") notify("playing");
              if (!announced && !line.keep) { announced = true; onPlaying(); }
            }
            if (line.keep && !again && mine === generation) kept.set(line.text, made);
          }
          if (mine !== generation) return false;
          await Promise.all(endings);
          if (mine !== generation) return false;
          active = false; controller = null; context = null;
          await audio.close();
          if (mine !== generation) return false;
          notify("idle"); return true;
        } catch (error) {
          if (mine !== generation) return false;
          active = false; controller = null;
          releaseWhenUnused();
          if (context === audio) context = null;
          if (audio) await Promise.resolve(audio.close()).catch(() => {});
          notify("error", error?.message || String(error));
          return false;
        }
      })();
      return {
        say(text, { keep = false } = {}) { if (!closed && mine === generation && text) { queue.push({ text, keep }); wake(); } },
        end() { closed = true; wake(); return finished; },
        stop() { if (mine === generation) stop(); }
      };
    }

    function play(text) {
      const spoken = speechText(text);
      if (!spoken) { stop({ silent: true }); return Promise.resolve(false); }
      const talk = begin();
      talk.say(spoken);
      return talk.end();
    }

    // Loads the voice ahead of time, so the first words of an answer are not waiting for it.
    function prepare() { return load().then(() => true); }

    function dispose() { stop(); kept.clear(); if (model) { model.dispose(); model = null; } }
    return { play, begin, prepare, stop, dispose, get state() { return state; } };
  }

  Object.assign(dash, { createPhononPlayback, askSpeechText: speechText });
})(globalThis);
