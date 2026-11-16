# AI Features & Background Intelligence Restoration Guide

## Archived Status & Purpose
The on-device AI features (Ask chat interface, Assignment Dossier, file text extractors, and passage search engine) are preserved in this `src/archive/` folder. They were archived to keep the primary extension lightweight, maintainable, and aligned with upstream GitHub, while keeping all code, tests, and models preserved for future re-integration in a better, purely ambient architecture.

---

## 1. Inventory of Archived AI Subsystems

### A. Assignment Dossier Engine (`src/archive/ai-engine/assignment-dossier/`)
- **What it does**: Silently inspects open assignments, matches them against course documents (syllabi, rubrics, guides), reads file text, and synthesizes a structured "Brief & Requirements" panel with interactive checkboxes and page-numbered source citations.
- **Key files**:
  - `assignment-dossier.js`: Core candidate matching, synthesis heuristic, and IndexedDB caching.
  - `assignment-dossier.css`: Component styles, badges, and dev modal styling.
- **Dev Preview Hook**: Built-in `Shift + D` shortcut or holding the profile button for 1.5s opens a dev modal with sample preview.

### B. File Text Extraction & Store (`src/archive/ai-engine/ask/`)
- **What it does**: Headless PDF and DOCX text extractor and IndexedDB store.
- **Key files**:
  - `file-text-reader.js`: Extracts text from course PDFs via bundled `pdf.js` and Word DOCX via ZIP reader.
  - `file-text-store.js`: IndexedDB persistence store (`askFileTexts`) per account.

### C. Ranked Passage Search Engine (`src/archive/ai-engine/model-passage-search.js`)
- **What it does**: Fast in-memory BM25 chunked passage search over course entities and extracted document text.

### D. On-Device Model Runtime & Tools (`src/archive/ai-engine/tools/`)
- **What it does**: Liquid AI LFM3-1.7B in-browser WebGPU runtime via Transformers.js.
- **Key files**:
  - `get-ask-model.mjs`: Download script for quantized ONNX model files (~1.4 GB into `models/`).
  - `build-ask-runtime.mjs`: Bundler for Transformers.js / ONNX Runtime Web.

### E. Chat UI & Voice Mode (`src/archive/chat-ui/` & `src/archive/speech/`)
- Interactive chat screen, message history, streaming Markdown renderer (`markdown-it`, `remend`), and speech recognition/synthesis.

---

## 2. How to Restore & Modernize

### Option 1: Restoring Assignment Dossier (Ambient Background Mode)
1. Move `src/archive/ai-engine/assignment-dossier/` back to `src/dashboard/assignment-dossier/`.
2. Move `src/archive/ai-engine/ask/file-text-*.js` back to `src/dashboard/ask/`.
3. In `dashboard.html`, re-add:
   ```html
   <link rel="stylesheet" href="src/dashboard/assignment-dossier/assignment-dossier.css">
   <script src="src/dashboard/ask/file-text-store.js"></script>
   <script src="src/dashboard/ask/file-text-reader.js"></script>
   <script src="src/dashboard/assignment-dossier/assignment-dossier.js"></script>
   ```
4. Move `src/archive/ai-engine/tests/test-assignment-dossier.mjs` back to `tests/`.

### Option 2: Modernizing with a Dedicated Background Worker
When restoring in a future update:
- Run document text extraction in a Web Worker to keep the main UI thread 100% smooth.
- Use a single headless inference call to summarize complex rubrics rather than multi-turn conversational agents.
- Store synthesized dossiers directly in the account-scoped archive database.
