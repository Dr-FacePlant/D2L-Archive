import { loadBackgroundHooks } from "./test-production-loader.mjs";

const listeners = [];
let reloads = 0;
loadBackgroundHooks({
  chrome: {
    runtime: {
      onMessage: { addListener(listener) { listeners.push(listener); } },
      reload() { reloads += 1; }
    }
  }
});
if (listeners.length !== 1) throw new Error("Production background listener was not installed");

let acceptedResponse = null;
const keepAlive = listeners[0]({
  type: "D2L_DEV_RELOAD_EXTENSION",
  token: "d2l-local-dev-8f6c2a1e"
}, {
  tab: { url: "https://kennesaw.view.usg.edu/d2l/home" }
}, (response) => { acceptedResponse = response; });
if (keepAlive !== false || !acceptedResponse?.ok) throw new Error("Valid unpacked development reload was rejected");
await new Promise((resolve) => setTimeout(resolve, 80));
if (reloads !== 1) throw new Error("Valid development reload did not call chrome.runtime.reload");

let rejectedResponse = null;
listeners[0]({ type: "D2L_DEV_RELOAD_EXTENSION", token: "wrong" }, {
  tab: { url: "https://kennesaw.view.usg.edu/d2l/home" }
}, (response) => { rejectedResponse = response; });
if (rejectedResponse?.ok || reloads !== 1) throw new Error("Invalid development reload was accepted");

console.log("Development reload is restricted to the exact token, D2L origin, and unpacked build.");
