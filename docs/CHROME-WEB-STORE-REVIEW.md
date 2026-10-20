# Chrome Web Store Review Notes

Checked against Google's Chrome Web Store Program Policies and Quality
Guidelines on September 29, 2026:

- Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Quality Guidelines: https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines

## Release-candidate status

This source tree is suitable as a local unpacked release candidate. It is not
yet a public Chrome Web Store submission candidate.

## Main findings

- **Single purpose:** the core purpose is narrow and understandable: create a
  local student archive/dashboard for Kennesaw D2L and provide exact D2L
  handoffs. It never performs a D2L write.
- **Permissions:** the manifest requests D2L host access, storage, downloads,
  tabs and scripting. These match current features: D2L extraction/probes,
  local archive downloads/file opening, same-tab sync, embedded overlay, and
  extension toolbar behavior.
- **Exposed resources:** only `dashboard.html` is web-accessible, and only for
  `https://kennesaw.view.usg.edu/*`.
- **Read-only boundary:** no production module sends a D2L mutation request.
  Static tests reject `POST`, `PUT`, `PATCH`, and `DELETE` across `src/`.
  Submitting, posting, and quiz attempts happen only after the user opens the
  item on D2L itself.
- **User data/privacy:** the extension handles education records, course files,
  grades, feedback, discussion text, and local archives. A public listing needs
  a privacy policy that clearly says what is collected, where it is stored, that
  archives are local unless the user moves/shares them, and whether any sponsor
  feed or external link receives network requests.
- **Ads/sponsorship:** the sponsor slideshow is the main public-release risk.
  Chrome treats ads as part of the product and requires ads shown alongside a
  third-party site to be disclosed, attributed, removable, non-interfering, and
  not disguised as site content. Chrome's quality rules also call out
  extensions that combine product ratings/reviews with injected ads as a
  single-purpose violation example, so combining a student D2L dashboard with a
  sponsor/ad slot may draw review scrutiny.

## Recommendation before public release

For a Chrome Web Store submission, remove the sponsor/ad slideshow or make a
separate, opt-in and clearly removable sponsorship channel with prominent store
listing disclosure and privacy-policy coverage. The safest public build is an
ad-free student archive/dashboard.
