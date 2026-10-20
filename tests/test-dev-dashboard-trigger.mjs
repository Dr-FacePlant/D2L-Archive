// The development-only "open dashboard next to this D2L tab" trigger must
// require the dev token and a D2L sender, and keep the new tab in the sender's
// tab group.
import { loadBackgroundHooks } from "./test-production-loader.mjs";

const listeners = [];
const created = [];
const grouped = [];
loadBackgroundHooks({
  chrome: {
    runtime: {
      onMessage: { addListener(listener) { listeners.push(listener); } },
      getURL: (path) => `chrome-extension://test-id/${path}`
    },
    tabs: {
      create: async (options) => { created.push(options); return { id: 99 }; },
      group: async (options) => { grouped.push(options); return options.groupId; }
    }
  }
});
const send = (message, sender) => new Promise((resolve) => {
  const keepAlive = listeners[0](message, sender, resolve);
  if (keepAlive === false) setTimeout(() => resolve(null), 10);
});
const d2lTab = { tab: { id: 7, index: 2, groupId: 55, url: "https://kennesaw.view.usg.edu/d2l/home" } };

const ok = await send({ type: "D2L_DEV_OPEN_DASHBOARD", token: "d2l-local-dev-8f6c2a1e", route: "#/grades?course=9900001" }, d2lTab);
if (!ok?.ok || created[0]?.url !== "chrome-extension://test-id/dashboard.html#/grades?course=9900001" || created[0].openerTabId !== 7) throw new Error("dev dashboard trigger did not open the dashboard route");
if (grouped[0]?.groupId !== 55 || grouped[0].tabIds[0] !== 99) throw new Error("dev dashboard tab was not kept in the sender's tab group");

const wrongToken = await send({ type: "D2L_DEV_OPEN_DASHBOARD", token: "nope" }, d2lTab);
const wrongSite = await send({ type: "D2L_DEV_OPEN_DASHBOARD", token: "d2l-local-dev-8f6c2a1e" }, { tab: { id: 8, index: 0, groupId: -1, url: "https://example.com/" } });
if (wrongToken?.ok || wrongSite?.ok || created.length !== 1) throw new Error("dev dashboard trigger accepted a bad token or a non-D2L sender");

const badRoute = await send({ type: "D2L_DEV_OPEN_DASHBOARD", token: "d2l-local-dev-8f6c2a1e", route: "javascript:alert(1)" }, d2lTab);
if (!badRoute?.ok || created[1]?.url !== "chrome-extension://test-id/dashboard.html") throw new Error("dev dashboard trigger passed through an unsafe route");
const selfcheck = await send({ type: "D2L_DEV_OPEN_DASHBOARD", token: "d2l-local-dev-8f6c2a1e", route: "", selfcheck: true }, d2lTab);
if (!selfcheck?.ok || created[2]?.url !== "chrome-extension://test-id/dashboard.html?selfcheck=1") throw new Error("dev dashboard self-check did not open the self-check page");
console.log("Development dashboard trigger is token-gated and grouped.");
