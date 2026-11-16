// Voice mode on the Ask screen (src/dashboard/voice/voice-bar.js, voice-start.js, voice-screen.js): the
// microphone button, the bar, the "Start voice?" pop-up, starting Ask first, stopping, failures, leaving Ask.
// The microphone, listening model, voice and Ask are stand-ins the test drives by hand.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { const out = {}; out.promise = new Promise((resolve, reject) => Object.assign(out, { resolve, reject })); return out; };
const FILES = ["format.js", "ask/response/phonon-playback.js", "voice/speakable-sentences.js", "voice/listen/heard-text.js", "voice/filler-lines.js", "voice/voice-mode.js", "voice/voice-bar.js", "voice/voice-start.js", "voice/voice-screen.js"];

function build({ embedded = false, lifeState = "idle", startTo = "ready", settings = {}, micWorks = true } = {}) {
  const listeners = {};
  const document = { activeElement: null, addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) };
  const context = vm.createContext({ D2LDashboard: {}, document, AbortController, Float32Array, console, setTimeout, clearTimeout });
  context.D2LDashboard.icon = (name) => `<svg data-icon="${name}"></svg>`;
  for (const file of FILES) vm.runInContext(fs.readFileSync(new URL(`../src/dashboard/${file}`, import.meta.url), "utf8"), context, { filename: file });
  const dash = context.D2LDashboard;

  const page = { bar: { innerHTML: "" }, button: { innerHTML: "", querySelector: () => null }, popup: { innerHTML: "", querySelector: () => ({ focus() { page.popFocused = true; } }) }, again: { checked: false } };
  const $ = (selector) => ({ "#ask-voice-slot": page.bar, "#ask-voice-button-slot": page.button, "#ask-voice-start-slot": page.popup, "#ask-voice-again": page.popup.innerHTML ? page.again : null })[selector] ?? null;

  const log = { saved: [], tabs: 0, ended: [], asked: [] };
  const finishStart = [];
  const life = { state: lifeState, starts: 0, start() { life.starts += 1; life.state = "loading"; const d = deferred(); finishStart.push(() => { life.state = startTo; d.resolve(); }); return d.promise; } };
  const stand = { mic: null, listener: null, speaker: null, onPiece: null };
  const asks = [];
  const screen = dash.createVoiceScreen({
    $, life, embedded, settings: () => settings, saveSettings: (patch) => { log.saved.push(patch); Object.assign(settings, patch); },
    send: (question, { onText }) => { const d = deferred(); asks.push({ question, write: onText, ...d }); log.asked.push(question); return d.promise; },
    openTab: () => { log.tabs += 1; },
    createMic: ({ onPiece }) => (stand.onPiece = onPiece, stand.mic = { starts: 0, stops: 0, message: "", start() { this.starts += 1; if (!micWorks) this.message = "The microphone is blocked."; return Promise.resolve(micWorks); }, stop() { this.stops += 1; } }),
    createListener: () => (stand.listener = { loads: 0, disposed: 0, waiting: [], load() { this.loads += 1; return Promise.resolve(); }, reset() {}, feed() { const d = deferred(); this.waiting.push(d); return d.promise; }, dispose() { this.disposed += 1; } }),
    createSpeaker: () => (stand.speaker = { disposed: 0, stops: 0, prepare: () => Promise.resolve(true), stop() { this.stops += 1; }, dispose() { this.disposed += 1; }, begin: () => ({ say() {}, end: () => Promise.resolve(true), stop() {} }) })
  });
  // matches: the selectors the pressed element answers to. attr: the data attribute it carries.
  const fire = (type, { attr = "", matches = [], key = "" } = {}) => {
    const all = [...matches, ...(attr ? [`[${attr}]`] : [])];
    const event = { key, stopped: false, prevented: false, target: { closest: (selector) => (selector.split(",").some((part) => all.includes(part.trim())) ? { hasAttribute: (name) => name === attr } : null) }, preventDefault() { event.prevented = true; }, stopImmediatePropagation() { event.stopped = true; } };
    for (const fn of listeners[type] || []) fn(event);
    return event;
  };
  const press = (attr) => fire("click", { attr });
  const ready = async () => { while (finishStart.length) finishStart.shift()(); await tick(); await tick(); };
  return { dash, screen, life, page, log, stand, asks, fire, press, ready, settings, document };
}

// ---- the page builders ----
{
  const t = build();
  const quiet = t.dash.askVoiceButtonHtml();
  assert.match(quiet, /data-ask-voice /);
  assert.match(quiet, /aria-pressed="false"/);
  assert.equal(t.dash.askVoiceBarHtml(), "");
  const on = t.dash.askVoiceBarHtml({ state: "listening", heard: "what is <b>due</b> & when", message: "" });
  assert.match(on, /Listening/);
  assert.ok(on.includes("what is &lt;b&gt;due&lt;/b&gt; &amp; when") && !on.includes("<b>due"), "heard words are shown as text, never as HTML");
  assert.match(t.dash.askVoiceBarHtml({ state: "listening", heard: "", message: "" }), /Say your question/);
  assert.ok(t.dash.askVoiceBarHtml({ state: "thinking", question: "A <i>q</i>" }).includes("A &lt;i&gt;q&lt;/i&gt;"), "the question is shown as text");
  assert.match(t.dash.askVoiceBarHtml({ state: "speaking", question: "q" }), /Speaking/);
  assert.match(t.dash.askVoiceBarHtml({ preparing: true, state: "off" }), /Starting Ask/);
  assert.match(t.dash.askVoiceBarHtml({ state: "off", message: "No microphone was found." }), /Voice stopped[\s\S]*No microphone was found[\s\S]*data-ask-voice-dismiss/);
  assert.match(t.dash.askVoiceBarHtml({ state: "listening" }), /data-ask-voice-stop/);
  assert.match(t.dash.askVoiceButtonHtml({ state: "listening" }), /is-on[\s\S]*aria-pressed="true"[\s\S]*Stop voice/);
  assert.match(t.dash.askVoiceButtonHtml({ state: "off", blocked: true }), /disabled/);
  const pop = t.dash.askVoiceStartHtml();
  assert.ok(pop.includes("Start voice?") && pop.includes("190 MB") && pop.includes("100 MB") && pop.includes("Don't ask again") && pop.includes("Not now"), "the pop-up says what voice loads and offers Don't ask again");
}

// ---- inside a D2L page: the button opens the dashboard in a tab ----
{
  const t = build({ embedded: true });
  assert.match(t.dash.askVoiceButtonHtml(t.screen.view()), /data-ask-voice-tab[\s\S]*open in a tab/);
  t.press("data-ask-voice-tab");
  assert.equal(t.log.tabs, 1);
  assert.equal(t.stand.mic, null, "nothing is set up for the microphone there");
  assert.equal(t.life.starts, 0);
}

// ---- the first start asks; Not now, Esc and a press elsewhere close it ----
{
  const t = build();
  t.press("data-ask-voice");
  assert.ok(t.page.popup.innerHTML.includes("Start voice?") && t.page.popFocused, "the first press opens the pop-up and focuses it");
  assert.equal(t.life.starts, 0);
  t.fire("click", { attr: "data-ask-voice-cancel" });
  assert.equal(t.page.popup.innerHTML, "");
  assert.equal(t.stand.mic, null, "Not now starts nothing");
  t.press("data-ask-voice");
  const esc = t.fire("keydown", { key: "Escape" });
  assert.ok(esc.stopped && esc.prevented && t.page.popup.innerHTML === "", "Esc closes only the pop-up");
  t.press("data-ask-voice");
  t.fire("pointerdown", { matches: ["#ask-voice-pop"] });
  assert.ok(t.page.popup.innerHTML.includes("Start voice?"), "a press inside the pop-up leaves it open");
  t.fire("pointerdown", { attr: "data-ask-voice" });
  assert.ok(t.page.popup.innerHTML.includes("Start voice?"), "the press that begins a click on the microphone button does not close it by itself");
  t.press("data-ask-voice");
  assert.equal(t.page.popup.innerHTML, "", "pressing the microphone button again closes it");
  t.press("data-ask-voice");
  t.fire("pointerdown");
  assert.equal(t.page.popup.innerHTML, "", "a press anywhere else closes it");
}

// ---- Start voice: Ask starts first, then the microphone ----
{
  const t = build();
  t.press("data-ask-voice");
  t.fire("click", { attr: "data-ask-voice-go" });
  assert.equal(t.life.starts, 1);
  assert.match(t.page.bar.innerHTML, /Starting Ask/);
  assert.match(t.page.button.innerHTML, /is-on/);
  assert.equal(t.stand.mic, null, "the voice parts wait for Ask");
  await t.ready();
  assert.equal(t.stand.mic.starts, 1);
  assert.equal(t.stand.listener.loads, 1);
  assert.match(t.page.bar.innerHTML, /Listening/);
  assert.equal(t.settings.voiceStartWithoutAsking, undefined, "without Don't ask again nothing is saved");
  // hearing words shows them
  t.stand.onPiece(new Float32Array(2560));
  t.stand.listener.waiting.shift().resolve({ words: ["▁what", "▁is", "▁due"], ended: false });
  await tick();
  assert.match(t.page.bar.innerHTML, /what is due/);
  // Stop
  t.press("data-ask-voice-stop");
  assert.equal(t.stand.mic.stops >= 1, true);
  assert.equal(t.page.bar.innerHTML, "", "Stop takes the bar away");
  assert.doesNotMatch(t.page.button.innerHTML, /is-on/);
  assert.equal(t.screen.active, false);
}

// ---- a question goes to Ask, and the bar follows it ----
{
  const t = build({ lifeState: "ready", settings: { voiceStartWithoutAsking: true } });
  t.press("data-ask-voice");
  assert.equal(t.page.popup.innerHTML, "", "with Don't ask again voice starts at once");
  await t.ready();
  assert.equal(t.life.starts, 0, "Ask was already running");
  t.stand.onPiece(new Float32Array(2560));
  t.stand.listener.waiting.shift().resolve({ words: ["▁when", "▁is", "▁my", "▁exam"], ended: true });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok(t.log.asked.length === 1 && /when is my exam/i.test(t.log.asked[0]), "one question was sent to Ask");
  assert.match(t.page.bar.innerHTML, /Thinking/);
  assert.match(t.page.bar.innerHTML, /exam/);
  t.asks[0].resolve({ answer: "Tuesday.", failed: false });
  await tick(); await tick();
  assert.match(t.page.bar.innerHTML, /Listening/, "after the answer it listens again");
  t.screen.dispose();
}

// ---- Don't ask again is saved ----
{
  const t = build({ lifeState: "ready" });
  t.press("data-ask-voice");
  t.page.again.checked = true;
  t.fire("click", { attr: "data-ask-voice-go" });
  assert.equal(JSON.stringify(t.log.saved), JSON.stringify([{ voiceStartWithoutAsking: true }]));
  await t.ready();
  t.screen.dispose();
}

// ---- things that go wrong ----
{
  const t = build({ startTo: "error" });
  t.press("data-ask-voice");
  t.fire("click", { attr: "data-ask-voice-go" });
  await t.ready();
  assert.match(t.page.bar.innerHTML, /Voice stopped[\s\S]*Ask could not start/);
  assert.equal(t.stand.mic, null, "no microphone when Ask could not start");
  t.press("data-ask-voice-dismiss");
  assert.equal(t.page.bar.innerHTML, "", "Close clears the message");
}
{
  const t = build({ lifeState: "ready", micWorks: false, settings: { voiceStartWithoutAsking: true } });
  t.press("data-ask-voice");
  await t.ready();
  assert.match(t.page.bar.innerHTML, /Voice stopped[\s\S]*The microphone is blocked/);
  assert.doesNotMatch(t.page.button.innerHTML, /is-on/);
  t.press("data-ask-voice");
  assert.match(t.page.bar.innerHTML, /Listening|Getting the voice ready|Starting Ask/, "pressing the button again tries again");
  await t.ready();
}
{
  const t = build({ lifeState: "idle", settings: { voiceStartWithoutAsking: true } });
  t.press("data-ask-voice");
  assert.match(t.page.bar.innerHTML, /Starting Ask/);
  t.press("data-ask-voice-stop");
  assert.equal(t.page.bar.innerHTML, "", "stopping while Ask starts takes the bar away");
  await t.ready();
  assert.equal(t.stand.mic, null, "voice does not start after being stopped");
  assert.equal(t.screen.active, false);
}
{
  const t = build({ lifeState: "missing" });
  assert.match(t.dash.askVoiceButtonHtml(t.screen.view()), /disabled/, "the button is off while Ask cannot run here");
}

// ---- leaving Ask lets everything go ----
{
  const t = build({ lifeState: "ready", settings: { voiceStartWithoutAsking: true } });
  t.press("data-ask-voice");
  await t.ready();
  const { mic, listener, speaker } = t.stand;
  t.screen.dispose();
  assert.ok(mic.stops >= 1 && listener.disposed === 1 && speaker.disposed === 1, "the microphone, the listening model and the voice are let go");
  assert.equal(t.screen.active, false);
  t.press("data-ask-voice");
  await t.ready();
  assert.notEqual(t.stand.listener, listener, "the next start makes new parts");
  t.screen.dispose();
}

console.log("voice screen: ok");
