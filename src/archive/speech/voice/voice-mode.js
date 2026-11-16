// Voice mode: listen to a question, let Ask answer it, speak the answer, then listen again.
// It listens only while nothing is being said back: the microphone is off while Ask writes and speaks,
// so the answer is never heard as a question. Everything it works with is passed in:
//   mic       { start(): Promise<boolean>, stop(), message }  gives pieces to voice.piece()
//   listener  { load(), feed(piece): Promise<{ words, ended }>, reset() }
//   speaker   { prepare(), begin({ onPlaying }) → { say(text, { keep }), end(): Promise<boolean>, stop() }, stop() }
//             say(text, { keep: true }) is a short line that is not the answer (it may be kept and replayed, and is not onPlaying)
//   ask       { send(question, { spoken: true, onText(answerSoFar), onLookup(toolName, round) }): Promise<{ answer, failed } | undefined> }
//             spoken: true tells Ask the answer will be heard, so it answers short, with no table or list
//   filler    (optional, dash.createFiller) picks the short spoken lines for while Ask works: see filler-lines.js
// states: off, starting, listening, thinking (Ask is working), speaking. onChange gets
// { state, message, heard, question, answer }: the words heard so far, the question sent, the answer so far.
(function initVoiceMode(global) {
  const dash = global.D2LDashboard ||= {};

  // How long after the listener hears the speaker finish before the question is sent. The listener itself
  // decides when a question is over (a pause inside one is waited out); a word in this time carries on.
  const QUIET_MS = 250;
  // If the listener never hears a finish, the question is sent this long after the last word.
  const FALLBACK_MS = 2500;
  // If Ask has said nothing for this long while working, a short line is spoken so the quiet is not mistaken for a hang.
  const NUDGE_MS = 6000;

  function createVoiceMode({
    mic, listener, speaker, ask, onChange = () => {}, quietMs = QUIET_MS, fallbackMs = FALLBACK_MS, nudgeMs = NUDGE_MS,
    setTimer = (run, ms) => setTimeout(run, ms), clearTimer = (id) => clearTimeout(id),
    newSentences = () => dash.createSentenceStream(), newFiller = () => dash.createFiller?.() || null
  }) {
    let state = "off", message = "", question = "", answer = "", heard = [], epoch = 0, open = false, timer = null;

    const snapshot = () => ({ state, message, heard: dash.heardWords(heard), question, answer });
    const tell = (next, text = "") => { state = next; message = text; onChange(snapshot()); };
    const disarm = () => { if (timer !== null) clearTimer(timer); timer = null; };
    const arm = (ms, mine) => { disarm(); timer = setTimer(() => { timer = null; finishQuestion(mine); }, ms); };

    // Everything stops: no more listening, no more speaking. The reason, if any, is the message.
    function end(reason = "") {
      epoch += 1; open = false; heard = [];
      disarm(); mic.stop(); speaker.stop();
      tell("off", reason);
    }

    // `mine` is the stretch of time this belongs to. A stop, or the next stretch, makes it stale.
    // The first time the microphone can take a while to open (the browser may be asking), so that is said.
    async function listen(mine, note = "", first = false) {
      heard = []; disarm(); listener.reset();
      open = true;
      if (first) tell("starting", "Opening the microphone…"); else tell("listening", note);
      if (!(await mic.start())) { if (mine === epoch) end(mic.message || "The microphone could not be started."); return false; }
      if (mine !== epoch) return false;
      if (first) tell("listening", note);
      return true;
    }
    const listenAgain = (note) => { epoch += 1; return listen(epoch, note); };

    async function start() {
      if (state !== "off") return true;
      epoch += 1;
      const mine = epoch;
      question = answer = ""; heard = [];
      tell("starting", "Getting the voice ready…");
      try { await Promise.all([listener.load(), speaker.prepare()]); }
      catch (error) { if (mine === epoch) end(`Voice could not start: ${error?.message || error}`); return false; }
      if (mine !== epoch) return false;
      return listen(mine, "", true);
    }

    // A 160 ms piece from the microphone.
    function piece(samples) {
      if (!open) return;
      const mine = epoch;
      listener.feed(samples).then(
        (heardNow) => { if (mine === epoch && open) heardPiece(heardNow, mine); },
        (error) => { if (mine === epoch) end(`Listening stopped: ${error?.message || error}`); }
      );
    }

    function heardPiece({ words, ended }, mine) {
      if (words.length) { heard.push(...words); arm(fallbackMs, mine); onChange(snapshot()); }
      if (ended && heard.length) arm(quietMs, mine);
    }

    function finishQuestion(mine) {
      if (mine !== epoch || !open) return;
      const text = dash.tidyHeardQuestion(dash.heardWords(heard));
      if (!text) { heard = []; return; }
      epoch += 1; open = false; heard = [];
      mic.stop();
      question = text; answer = "";
      tell("thinking");
      reply(epoch, text);
    }

    // Ask writes the answer; each sentence is spoken as soon as it is whole. While it works before that, a short line
    // says what it is doing: at a lookup, and after nudgeMs of quiet. Lines queue behind nothing and ahead of the answer,
    // and none is spoken once the answer's first sentence is on its way.
    async function reply(turn, text) {
      const talk = speaker.begin({ onPlaying: () => { if (turn === epoch) tell("speaking"); } });
      const cut = newSentences();
      const filler = newFiller();
      let answering = false, nudge = null;
      const quiet = () => { if (nudge !== null) clearTimer(nudge); nudge = null; };
      const fill = (line) => { if (line && turn === epoch && !answering) { talk.say(line, { keep: true }); wait(); } };
      const wait = () => { quiet(); if (filler && !answering) nudge = setTimer(() => { nudge = null; if (turn === epoch && !answering) fill(filler.forWait()); }, nudgeMs); };
      const say = (sentences) => { if (sentences.length) { answering = true; quiet(); } for (const sentence of sentences) talk.say(sentence); };
      filler?.startQuestion(); wait();
      let outcome;
      try {
        outcome = await ask.send(text, {
          spoken: true,
          onText: (written) => { if (turn !== epoch) return; answer = written; say(cut.push(written)); onChange(snapshot()); },
          onLookup: (tool, round) => { if (filler) fill(filler.forLookup(tool, round)); }
        });
      } catch { outcome = { failed: true }; }
      finally { quiet(); }
      if (turn !== epoch) return;
      if (!outcome) { talk.stop(); listenAgain("Ask is busy. Say it again in a moment."); return; }
      if (outcome.failed) say(["Sorry, something went wrong."]); else say(cut.finish());
      const spoke = await talk.end();
      if (turn === epoch) listenAgain(spoke ? "" : "The voice could not speak that. The answer is in the chat.");
    }

    return { start, stop: () => { if (state !== "off") end(); }, piece, get state() { return state; }, snapshot };
  }

  dash.createVoiceMode = createVoiceMode;
})(globalThis);
