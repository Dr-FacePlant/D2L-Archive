# Chrome Web Store Review Notes

Checked against Google's Chrome Web Store Program Policies and Quality
Guidelines on September 29, 2026, and updated for the 0.9.0 read-only build:

- Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Quality Guidelines: https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines

## Release-candidate status

This source tree is a local unpacked release candidate at version `0.9.0`. The
public Chrome Web Store submission is waiting on store screenshots and the
manual smoke test in `docs/store-listing.md`; no code or policy blocker remains.

## Main findings

- **Single purpose:** the core purpose is narrow and understandable: create a
  local student archive/dashboard for Kennesaw State University's D2L and provide
  exact D2L handoffs. It never performs a D2L write.
- **Scope:** the manifest requests host access only for
  `https://kennesaw.view.usg.edu/d2l/*`, and the store listing says the extension
  is for Kennesaw State University. Do not market it as a generic D2L extension
  until other institutions are deliberately supported.
- **Permissions:** the manifest requests D2L host access, storage, downloads,
  tabs, alarms, and scripting. These match current features: D2L extraction and
  probes, local archive downloads/file opening, same-tab sync, embedded overlay,
  and extension toolbar behavior.
- **Exposed resources:** only `dashboard.html` is web-accessible, and only for
  `https://kennesaw.view.usg.edu/*`.
- **Read-only boundary:** no production module sends a D2L mutation request.
  Static tests reject `POST`, `PUT`, `PATCH`, and `DELETE` across `src/`.
  Submitting, posting, and quiz attempts happen only after the user opens the
  item on D2L itself.
- **User data/privacy:** the extension handles education records, course files,
  grades, feedback, discussion text, and local archives. The published privacy
  policy explains that this data stays local, what is stored, and how to delete
  it. There is no account, server, analytics, or telemetry.
- **Ads/sponsorship:** the sponsor/ad system has been removed. No sponsor feed,
  injected ad, or promotional network request ships in this build.
- **Package:** `node tools/package.mjs --dry-run` confirms the store ZIP contains
  only runtime files (no docs, tests, tools, fixtures, or scratch JSON).

## Recommendation before public release

1. Run the manual smoke test and capture five screenshots per
   `docs/store-listing.md`.
2. Fill in the Chrome Web Store privacy practices form using the answers in that
   document, including the published policy URL.
3. Keep the listing copy specific to Kennesaw State University.
