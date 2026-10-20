import { loadBackgroundHooks } from "./test-production-loader.mjs";

const { pageTextSnippetMap, apiExportSummary, apiCollectionFailurePages } = loadBackgroundHooks();
const pageUrl = "https://kennesaw.view.usg.edu/d2l/home/9900004";
const snippets = pageTextSnippetMap([{ page: { url: pageUrl, text: "  Visible course home text  " } }]);

if (snippets.get(pageUrl) !== "Visible course home text") {
  throw new Error("Export page helper did not resolve the shared page key");
}

const summary = apiExportSummary({
  requestedOrgUnitIds: ["1", "2"],
  collectionFailures: [{ orgUnitId: "2", error: "Course API collection failed." }]
});
if (summary.requestedOrgUnitIds.join(",") !== "1,2" || summary.failed.length !== 1 || summary.failed[0].orgUnitId !== "2") {
  throw new Error("API export summary did not preserve requested courses and collection failures");
}
const failurePages = apiCollectionFailurePages({ collectionFailures: summary.failed }, { "2": "Unavailable Course" });
if (failurePages.length !== 1 || failurePages[0].course.title !== "Unavailable Course" || failurePages[0].pageType !== "failed" || !failurePages[0].error) {
  throw new Error("API collection failures did not become auditable failed pages");
}

console.log("Export page helper production tests passed.");
