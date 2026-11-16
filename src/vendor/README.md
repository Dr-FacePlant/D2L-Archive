# Bundled libraries

Loaded by `src/dashboard/preview-formats.js` (and the EPUB viewer in `src/dashboard/app-preview.js`) only when a preview needs them.
pdf.js is loaded by Ask's file reader (`src/dashboard/ask/file-text-reader.js`) only to read the text inside course PDFs; it is the legacy build, which runs in older browsers and in Node for the tests.
markdown-it shows Ask's answers as Markdown (`src/dashboard/ask/answer-markdown.js`); remend closes half-written marks in an answer still coming. Both load the first time Ask opens, not with the dashboard.
Copied unchanged from the npm packages' `dist` folders (pdf.js: `legacy/build`; markdown-it: `dist/browser`).

| File | Package | License | SHA-256 |
| --- | --- | --- | --- |
| `jszip.min.js` | jszip 3.10.2 | MIT (dual MIT/GPL-3.0; used under MIT), see `LICENSE-jszip.md` | `7f839b2d4688b845c105ebf5d2f9803075f91ea0fe72bdaac176c3a04dd3d2c1` |
| `pdfjs/pdf.min.mjs` | pdfjs-dist 6.5.438 (Mozilla pdf.js) | Apache-2.0, see `pdfjs/LICENSE` | `522ad2c83bc8a0010e7f0cc60d0892b77c8d2bf2c9702dc12288311d94270f42` |
| `pdfjs/pdf.worker.min.mjs` | pdfjs-dist 6.5.438 (Mozilla pdf.js) | Apache-2.0, see `pdfjs/LICENSE` | `b4c8353ded0d88d2e2009574a29eb4e0c3ff7e942ecdf51ef5f71566a9667f31` |
| `docx-preview.min.js` | docx-preview 0.4.1 | Apache-2.0, see `LICENSE-docx-preview.txt` | `c4a133c65a112799e35b143c572dfff9e923a3bf39b5fd3b07a06aa0f8f530c2` |
| `foliate-js/view.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `e0093af921feb03bb58fb51aeedc321fa108a4158d215f6913ecf7925415c945` |
| `foliate-js/epub.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `dfe347495039e9b5991478986ec6b7713cf9efbcd8f475a77ef7b967c5176298` |
| `foliate-js/epubcfi.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `e1a688ad5c84bf31f33cef467f92c7a6d060a0f17ec37c1d3c048e9c7b1cf645` |
| `foliate-js/progress.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `544f5e90babc0cb31c5caf971a5f06dd6249ec06600cb62f672fa7179811fde1` |
| `foliate-js/overlayer.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `d3d3396e3083277ccbd4f17c407621159b22a407107e43ce75ca3014578094fb` |
| `foliate-js/text-walker.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `4ad740ab6142b5be428700ef4d270253cef6649cf6e047ae7d2698a7aec65e92` |
| `foliate-js/paginator.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `51cec81572d5d182e231fe68ce9c3b5489a0976b36172060516336ba893565ea` |
| `foliate-js/fixed-layout.js` | foliate-js (see `foliate-js/VERSION.txt`) | MIT, see `foliate-js/LICENSE` | `7aee1d15d8e0479b8a6c59a20304b250dafc4c7dc158147a2b2c6bed9e180b4c` |
| `foliate-js/vendor/zip.js` | foliate-js (see `foliate-js/VERSION.txt`) | BSD-3-Clause (zip.js) | `2a0d43157e4a447c6e43351225758795b75a33e8dfec10c6767248df2182949a` |
| `markdown-it/markdown-it.umd.min.js` | markdown-it 15.0.3 | MIT, see `markdown-it/LICENSE` | `391f2aa638e75e6c7859d0a5c5650ef0956722a45998f17e05b83bc655778e1e` |
| `remend/index.js` | remend 1.4.0 (Vercel) | Apache-2.0, see `remend/LICENSE` | `d773979aecb01675c21860964cb2e9bedb2593bbd221c219caae15c3465642c0` |

Voice mode's listening runtime (`vendor/voice-ort/`) and model (`models/parakeet-eou/`) are not here: each has its own `NOTICE.md` or `README.md` with the license, source, size and SHA-256.
