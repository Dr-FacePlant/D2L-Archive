import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ AbortController, Float32Array, console });
for (const file of ["src/dashboard/ask/response/phonon-playback.js", "src/dashboard/voice/speakable-sentences.js", "src/dashboard/voice/listen/heard-text.js"]) {
  vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
}
const dash = context.D2LDashboard;
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- an answer being written: each sentence comes out once it is whole ----
const answer = "Lab 4 is due **Friday** at 11:59 PM. Quiz 3 is due Sunday! Is that all?\nYes, that is all.";
const stream = dash.createSentenceStream();
const spoken = [];
for (let at = 1; at <= answer.length; at += 1) spoken.push(...stream.push(answer.slice(0, at)));
assert.deepEqual(plain(spoken), ["Lab 4 is due Friday at 11:59 PM.", "Quiz 3 is due Sunday!", "Is that all?"], "a sentence waits for the next word, so the last one is not out yet");
assert.deepEqual(plain(stream.finish()), ["Yes, that is all."]);
assert.deepEqual(plain(stream.finish()), [], "finish says it only once");

// the same answer in one piece comes out the same
const whole = dash.createSentenceStream();
assert.deepEqual(plain([...whole.push(answer), ...whole.finish()]), ["Lab 4 is due Friday at 11:59 PM.", "Quiz 3 is due Sunday!", "Is that all?", "Yes, that is all."]);

// ---- dots that do not end a sentence ----
const dots = dash.createSentenceStream();
const text = "Dr. Lee holds office hours at 3.5 hours a week, e.g. on Tuesday. Then Nov. 7 is the exam.";
assert.deepEqual(plain([...dots.push(text), ...dots.finish()]), ["Dr. Lee holds office hours at 3.5 hours a week, e.g. on Tuesday.", "Then Nov. 7 is the exam."]);

// ---- lists: one line each, and the list number is not a sentence (the page drops the "1." when it
// renders the Markdown; this test has no page, so the marks stay) ----
const list = dash.createSentenceStream();
const lines = "Due this week:\n1. Lab four on Friday\n2. Quiz three on Sunday\n- Essay draft";
assert.deepEqual(plain([...list.push(lines), ...list.finish()]), ["Due this week:", "1. Lab four on Friday", "2. Quiz three on Sunday", "- Essay draft"]);

// ---- marks with nothing to say are dropped ----
const marks = dash.createSentenceStream();
assert.deepEqual(plain([...marks.push("**\n> \nDone here. "), ...marks.finish()]), ["Done here."]);

// ---- Ask starts the answer over after a lookup: the new answer is spoken from its start ----
const rounds = dash.createSentenceStream();
assert.deepEqual(plain(rounds.push("Let me check. One mo")), ["Let me check."]);
assert.deepEqual(plain(rounds.push("")), []);
assert.deepEqual(plain([...rounds.push("Lab four is due Friday. Done."), ...rounds.finish()]), ["Lab four is due Friday.", "Done."]);

// ---- a closing mark after the dot ----
const quoted = dash.createSentenceStream();
assert.deepEqual(plain([...quoted.push('It says "ask early." Then go.'), ...quoted.finish()]), ['It says "ask early."', "Then go."]);

// ---- what is heard: pieces back into words, then a question ----
assert.equal(dash.heardWords(["▁what", "▁is", "▁due", "▁to", "mor", "row"]), "what is due tomorrow");
assert.equal(dash.heardWords([]), "");
assert.equal(dash.heardWords(["mor", "▁i"]), "mor i", "a piece with no ▁ joins the one before");
assert.equal(dash.tidyHeardQuestion("what is due tomorrow"), "What is due tomorrow?");
assert.equal(dash.tidyHeardQuestion("show me what i have due"), "Show me what I have due");
assert.equal(dash.tidyHeardQuestion("when is the lab due at nine p m"), "When is the lab due at nine p m?");
assert.equal(dash.tidyHeardQuestion("  i'm   lost "), "I'm lost");
assert.equal(dash.tidyHeardQuestion(""), "");
assert.equal(dash.tidyHeardQuestion("is it due?"), "Is it due?");
// "due" heard as "do" is put right only where "do" can't be the verb
assert.equal(dash.tidyHeardQuestion("what is do this week"), "What is due this week?");
assert.equal(dash.tidyHeardQuestion("what's do tomorrow"), "What's due tomorrow?");
assert.equal(dash.tidyHeardQuestion("what assignments are do on friday"), "What assignments are due on friday?");
assert.equal(dash.tidyHeardQuestion("what is the do date for lab four"), "What is the due date for lab four?");
assert.equal(dash.tidyHeardQuestion("what do i have due"), "What do I have due?", "a real do stays");
assert.equal(dash.tidyHeardQuestion("what do you do this week"), "What do you do this week?", "a real do stays");
assert.equal(dash.tidyHeardQuestion("do i have class tomorrow"), "Do I have class tomorrow?", "a real do stays");

console.log("Voice sentences: whole sentences, dots, lists, restarts and heard words passed.");
