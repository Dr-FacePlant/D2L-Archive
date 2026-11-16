import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { loadDashboard } from "./test-dashboard-loader.mjs";

// A spoken question: the model is told its answer will be heard, and voice mode does not read a table out
// or go on down a long list; it says once that the rest is on the screen.
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(new URL("../src/dashboard/voice/speakable-sentences.js", import.meta.url), "utf8"), context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const ON_SCREEN = "The rest is on your screen.";

// The sentences spoken for text written `step` characters at a time, then finished. The stand-in keeps each piece as written.
function spoken(text, step) {
  const stream = context.D2LDashboard.createSentenceStream({ speakable: (piece) => piece.trim() });
  const out = [];
  for (let at = step; at < text.length + step; at += step) out.push(...stream.push(text.slice(0, Math.min(at, text.length))));
  out.push(...stream.finish());
  return { out: plain(out), again: plain(stream.finish()) };
}
// Same words whether they arrive in one piece or a character at a time, so no half row or half item is ever spoken.
function expectSpoken(text, expected, why) {
  for (const step of [1, 7, text.length]) {
    const { out, again } = spoken(text, step);
    assert.deepEqual(out, expected, `${why} (written ${step} at a time)`);
    assert.deepEqual(again, [], `${why}: finish says it once`);
  }
}

// ---- a table is not read out ----
expectSpoken(
  "You have two things due.\n\n| Course | Item |\n|---|---|\n| Chem 101 | Lab 4 |\n| Writing 200 | Quiz 5 |\n\nAsk if you want details.",
  ["You have two things due.", "Ask if you want details.", ON_SCREEN],
  "table rows and the rule under the header are left out"
);
expectSpoken(
  "Two due.\n| Chem 101 | Lab 4 |\n| Writing 200 | Quiz 5 |",
  ["Two due.", ON_SCREEN],
  "a table that is the end of the answer, with no line end after it"
);
expectSpoken(
  "Intro sentence.\n| Chem 101 | Lab 4. Due Friday | Fri |\n| Writing 200 | Quiz 5 | Sun |",
  ["Intro sentence.", ON_SCREEN],
  "a row cut in two by a full stop inside a cell is still left out"
);
expectSpoken(
  "Chem 101 | Lab 4 | Fri\nWriting 200 | Quiz 5 | Sun",
  ["Chem 101 | Lab 4 | Fri", "Writing 200 | Quiz 5 | Sun"],
  "a bar inside a line is not a table: only a line that starts like a table row is left out"
);

// ---- a list is read to three items ----
expectSpoken(
  "Due this week:\n- Lab 4, Friday\n- Quiz 5, Sunday\n- Homework 6, Sunday\n- Essay draft, Monday\n- Reading log, Tuesday\nThat is all.",
  ["Due this week:", "- Lab 4, Friday", "- Quiz 5, Sunday", "- Homework 6, Sunday", "That is all.", ON_SCREEN],
  "5 items: 3 are spoken and the writing after the list still is"
);
expectSpoken(
  "Due this week:\n1. Lab four on Friday\n2. Quiz three on Sunday\n- Essay draft",
  ["Due this week:", "1. Lab four on Friday", "2. Quiz three on Sunday", "- Essay draft"],
  "3 items are all spoken, with nothing said about the screen"
);
expectSpoken(
  "- Lab 4 is due Friday. It is worth 10 points.\n- Quiz 5 is due Sunday.\n- Homework 6 is due Sunday.\n- Essay is due Monday.",
  ["- Lab 4 is due Friday.", "It is worth 10 points.", "- Quiz 5 is due Sunday.", "- Homework 6 is due Sunday.", ON_SCREEN],
  "an item with two sentences counts once"
);

// ---- a plain answer comes out as it always did ----
expectSpoken(
  "Lab 4 is due **Friday** at 11:59 PM. Quiz 3 is due Sunday! Is that all?\nYes, that is all.",
  ["Lab 4 is due **Friday** at 11:59 PM.", "Quiz 3 is due Sunday!", "Is that all?", "Yes, that is all."],
  "no table and no list: nothing is left out and nothing is added"
);

// ---- Ask starts the answer over after a lookup: what was left out of the first draft does not count ----
{
  const stream = context.D2LDashboard.createSentenceStream({ speakable: (piece) => piece.trim() });
  assert.deepEqual(plain(stream.push("Let me look.\n| a | b |\n| c | d |\nstill")), ["Let me look."]);
  assert.deepEqual(plain(stream.push("Lab four is due Friday.")), []);
  assert.deepEqual(plain(stream.finish()), ["Lab four is due Friday."], "no line about the screen when the final answer has no table");
}

// ---- the model is told when the answer will be heard ----
const dash = loadDashboard();
const now = new Date(2026, 10, 4, 9, 0);
const asBefore = [
  "You are LFM3-1.7B, a small language model made by Liquid AI. You run inside the student's D2L Archive, a browser extension, entirely on this computer with no internet access. The student talks to you on its Ask screen.",
  `It is ${dash.askNow(now)}.`,
  "The student's courses: CS 1301.",
  "Your tools read the student's saved courses, their files, and your earlier messages with the student. You can't open websites or change anything in D2L.",
  "This is the start of a new chat. Earlier chats are saved: search_past_messages and chat_log find them.",
  "Greetings, thanks, and questions about you: answer briefly, without tools.",
  "Course questions: look it up first, answer only from what you find, and name the course and item. If nothing useful turns up, say: Not found in your course materials. Don't guess where else to look.",
  "For upcoming_due, set days from the time asked: today 1, tomorrow 2, this week 7, 2 weeks 14, a month 30, 2 months 60, 3 months 90.",
  "Give the answer first, without describing your search. Give each time with the word the lookup puts before it: due, opens or at. Keep answers short."
].join("\n");
const facts = { now, courseLabels: ["CS 1301"] };
assert.equal(dash.askSystemPrompt(facts), asBefore, "without spoken the prompt is the one it always was, letter for letter");
assert.equal(dash.askSystemPrompt({ ...facts, spoken: false }), asBefore);
const heard = dash.askSystemPrompt({ ...facts, spoken: true });
assert.ok(heard.startsWith(`${asBefore}\n`), "a spoken question keeps everything it had and adds to the end");
const added = heard.slice(asBefore.length + 1).split("\n");
assert.equal(added.length, 5, "five lines are added");
for (const part of ["hearing this, not reading it", "one to three short sentences", "No tables, lists, links or symbols", "at most three items", "Example answer:"]) {
  assert.ok(added.join("\n").includes(part), `the added lines say: ${part}`);
}

// ...and it gets there through askArchive, for a spoken question only
async function systemFor(extra) {
  const seen = [];
  const engine = { chat: async ({ messages }) => { seen.push(messages[0].content); return { content: "Two things are due Friday.", toolCalls: [], tokensPerSecond: 40 }; } };
  await dash.askArchive({ engine, ctx: { now, passageIndex: { courses: [{ label: "CS 1301" }] } }, question: "What is due?", ...extra });
  return seen[0];
}
assert.equal(await systemFor({}), asBefore, "a typed question sends the prompt it always did");
assert.equal(await systemFor({ spoken: true }), heard, "a spoken question sends the added lines");

// ...and the Ask screen passes the flag from voice mode on to askArchive (the screen itself needs the model to run)
const screen = fs.readFileSync(new URL("../src/dashboard/app-ask.js", import.meta.url), "utf8");
assert.match(screen, /dash\.askArchive\(\{[\s\S]*?spoken: Boolean\(watch\.spoken\)[\s\S]*?\}\);/, "submit hands watch.spoken to askArchive");

console.log("Spoken answers: prompt for a heard answer, tables and long lists left to the screen passed.");
