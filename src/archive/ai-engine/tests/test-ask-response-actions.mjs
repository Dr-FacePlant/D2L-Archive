import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const handlers = {};
const document = { addEventListener: (name, handler) => { handlers[name] = handler; } };
const context = vm.createContext({ document });
vm.runInContext(fs.readFileSync(new URL("../src/dashboard/ask/response/response-actions.js", import.meta.url), "utf8"), context);
const messages = [{ role: "user", text: "Question" }, { role: "assistant", text: "Answer" }];
const state = { busy: false, editingIndex: null, chat: { messages } };
let saves = 0, refreshes = 0, retried = null;
context.D2LDashboard.bindAskResponseActions({ getState: () => state, getMessages: () => messages, keep: () => saves++, refresh: () => refreshes++, retry: (index) => { retried = index; } });

function click(attribute, dataset, disabled = false) {
  const target = { dataset, disabled, closest() { return this; }, hasAttribute(name) { return name === attribute; } };
  handlers.click({ target });
}

click("data-ask-rate", { askRate: "1", rating: "up" });
assert.equal(messages[1].rating, "up");
assert.equal(saves, 1); assert.equal(refreshes, 1);
click("data-ask-rate", { askRate: "1", rating: "up" });
assert.equal(messages[1].rating, null);
state.busy = true;
click("data-ask-rate", { askRate: "1", rating: "down" });
assert.equal(messages[1].rating, null);
state.busy = false;
const beforeArchivedAction = { saves, refreshes, rating: messages[1].rating };
click("data-ask-speak", { askSpeak: "1" });
assert.deepEqual({ saves, refreshes, rating: messages[1].rating }, beforeArchivedAction, "an archived speech action is ignored");
click("data-ask-retry", { askRetry: "1" });
assert.equal(retried, 1);
retried = null; click("data-ask-retry", { askRetry: "1" }, true);
assert.equal(retried, null);

console.log("Ask response actions: local rating and retry dispatch passed; speech is archived.");
