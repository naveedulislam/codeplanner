# CodeVision — Project Status 02

**Date:** 2026-03-19  
**Status:** Agent Request Builder — complete

---

## Session Summary (2026-03-19)

This session replaced the wireframe generation subsystem entirely with a new **Agent Request Builder** and a **drag-and-drop file path insertion** mechanism. The goal shifted from visual analysis of screenshots to assembling precise, structured context documents for AI coding agents.

---

## 1. Changes by File

### `src/wireframeGenerator.ts` — DELETED

The file was removed entirely. All wireframe-specific types (`BoundingBox`, `TsvRow`, `LayoutBlock`, `BlockType`, `WireframeOptions`, `WireframeResult`) were also removed from `src/types.ts`. The wireframe generator was the largest source file in the project (~400 lines); its removal reduced total code by over 1 100 lines.

---

### `src/types.ts` — Simplified

Stripped down to only the two types still needed for OCR:

- `OcrResult` — plain text, TSV, confidence score, image dimensions
- `OcrOptions` — `imagePath`, `lang`, `tessDataPath`

All wireframe types removed.

---

### `src/agentRequestBuilder.ts` — NEW (~260 lines)

New file implementing:

#### `FileDropEditProvider`

Implements `vscode.DocumentDropEditProvider`. When a file or folder is dragged from the VS Code Explorer into any open document:

- Reads the dragged item's absolute path from `dataTransfer.get('text/plain').value`
- Computes the path relative to the workspace root
- Returns a `DocumentDropEdit` that inserts the relative path at the drop position

Key findings from studying the working extension [ElecTreeFrying/drag-import-relative-path](https://github.com/ElecTreeFrying/drag-import-relative-path):

- Use `'text/plain'` MIME (not `'text/uri-list'`) — the Explorer puts the raw filesystem path here
- Do NOT pass `{ dropMimeTypes: [...] }` as the 3rd argument to `registerDocumentDropEditProvider` — that option filters the provider out when the specified MIME is absent
- Register against explicit `{ language, scheme }` selectors (not the bare string `'*'`)

#### `cmdNewAgentRequest()`

Opens a new untitled Markdown document with a six-section template:

1. Header — workspace name, date, platform/Node version
2. Task
3. Files & References — with drag-and-drop instructions
4. Workspace Context
5. Errors & Diagnostics
6. Constraints & Notes

Cursor is positioned at the Task section on open.

#### `cmdInsertWorkspaceContext()`

Builds a file tree of the workspace root (via recursive `fs.readdirSync`; skips `node_modules`, `.git`, `dist`, `build`, `out`) and appends `git branch` + `git status --short`. Inserts the result at the cursor in the active editor.

#### `cmdInsertErrors()`

Reads `vscode.languages.getDiagnostics()` for all files, formats errors and warnings as a Markdown table, and inserts at cursor.

---

### `src/commands.ts` — Cleaned up

- Removed `cmdGenerateWireframe`, `cmdAnalyzeImage`, `cmdAnalyzeActiveImage`
- `runCaptureAction()` previously showed a QuickPick menu (OCR / Wireframe / Full Analysis); now calls `cmdExtractText` directly
- `cmdExtractTextFromClipboard` and `saveClipboardImageToFile` helper retained (re-added after accidentally being dropped during refactor)
- `getConfig()` no longer includes `wireframeFormat`

---

### `src/extension.ts` — Reorganised

- Removed wireframe imports and all wireframe command registrations
- Added imports: `FileDropEditProvider`, `cmdNewAgentRequest`, `cmdInsertWorkspaceContext`, `cmdInsertErrors`
- Registered `codevision.newAgentRequest`, `codevision.insertWorkspaceContext`, `codevision.insertErrors`
- Registered `FileDropEditProvider` against language-specific selectors (`markdown`, `plaintext`, `javascript`, `typescript`, `html`, `css`, `json`, `yaml`, `python`, `swift`) with no `dropMimeTypes` filter
- `activationEvents` changed from `[]` to `["onStartupFinished"]` so the drop provider is active immediately on startup — without this the drop provider was never registered until a command was manually run
- Removed `wireframeTool` LM registration; only `extractTool` remains

---

### `cli/codevision.js` — Stripped to OCR only

Removed ~280 lines of wireframe code:

- `BLOCK_STYLES`, `parseTsv`, `classifyBlock`, `buildBlocks`, `escapeXml`, `truncate`, `buildSvg`, `buildAscii`, `buildHtml`
- Updated `printHelp()` and valid-command check to `ocr` only
- Removed `wireframe` and `analyze` dispatch branches

Result: 237 lines (down from ~550).

---

### `package.json` — Updated manifest

Commands removed:

- `codevision.generateWireframe`
- `codevision.analyzeImage`
- `codevision.analyzeActiveImage`

Commands added:

- `codevision.newAgentRequest` — New Agent Request
- `codevision.insertWorkspaceContext` — Insert Workspace Context
- `codevision.insertErrors` — Insert Errors & Diagnostics

Setting removed: `codevision.wireframeFormat`

`activationEvents` updated: `["onStartupFinished"]`

Explorer context menu: only `extractTextFromUri` (for image files) remains.

---

### `README.md` — Rewritten

Full rewrite removing all wireframe documentation. Sections added/updated:

- Agent Request Builder overview
- Drop-to-insert instructions
- New commands table
- Updated project structure tree
- Project status table with link to both status files

---

### `tsconfig.json` — Cleaned up

Removed stale `src/wireframeGenerator.ts` exclusion (file was deleted).

---

### `.gitignore` — Minor additions

Added entries for `*.profraw` and `debug_tsv.js`.

---

## 2. Commands — Before vs After

| Before (Session 01)               | After (Session 02)                           |
| --------------------------------- | -------------------------------------------- |
| Extract Text from Image File      | Extract Text from Image File _(kept)_        |
| Extract Text from Clipboard Image | Extract Text from Clipboard Image _(kept)_   |
| Capture Screenshot & Extract Text | Capture Screenshot & Extract Text _(kept)_   |
| Generate Wireframe                | _removed_                                    |
| Analyze Image (OCR + Wireframe)   | _removed_                                    |
| Analyze Active Image              | _removed_                                    |
| _(none)_                          | **New Agent Request** _(added)_              |
| _(none)_                          | **Insert Workspace Context** _(added)_       |
| _(none)_                          | **Insert Errors & Diagnostics** _(added)_    |
| _(none)_                          | **Drop-to-insert** (drag-and-drop) _(added)_ |

---

## 3. Drop-to-Insert — Technical Notes

The drag-and-drop provider was the most complex part of this session. Key discoveries:

| Issue                                  | Root Cause                                                                                                     | Fix                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Provider never called                  | `activationEvents: []` means extension only activates on manual command, so drop provider was never registered | Set `activationEvents: ["onStartupFinished"]`                        |
| Drop opening file instead of inserting | Wrong MIME type (`text/uri-list`) and `dropMimeTypes` filter excluded the provider                             | Switch to `text/plain`; remove `dropMimeTypes` option                |
| Provider not matching documents        | Bare string `'*'` selector matches literal language ID `'*'`, not all documents                                | Use explicit `[{ language: 'markdown', scheme: 'file' }, ...]` array |

Works for both **files and folders** — the Explorer puts the absolute path of both in `text/plain`.

---

## 4. Current State

| Area                        | Status      | Notes                                                  |
| --------------------------- | ----------- | ------------------------------------------------------ |
| OCR engine (`ocrEngine.ts`) | Complete    | Unchanged from session 01                              |
| Agent Request Builder       | Complete    | Drop-to-insert + 3 commands                            |
| Drop-to-insert              | Complete    | Uses `text/plain` DataTransfer; files and folders      |
| `wireframeGenerator.ts`     | Deleted     | Replaced by agent request builder                      |
| CLI (`cli/codevision.js`)   | OCR only    | Wireframe commands removed                             |
| LM Tool registration        | Partial     | Only `codevision_extract_text`; wireframe tool removed |
| VSIX packaging              | Complete    | `codevision-0.1.0.vsix` (12.81 MB, 268 files)          |
| Marketplace publish         | Pending     | Not yet submitted                                      |
| Tests                       | Not started | No unit or integration tests yet                       |

---

## 5. Known Issues / TODOs

- [ ] Test drag-and-drop on Windows (path separator handling)
- [ ] Verify drop works in Cursor IDE (different Electron version)
- [ ] Add unit tests for `agentRequestBuilder` functions
- [ ] Publish VSIX to VS Code Marketplace
- [ ] Add extension icon to `package.json` (`"icon": "assets/icon.png"`)
