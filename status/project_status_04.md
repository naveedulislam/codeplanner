# CodePlanner — Project Status 04

**Date:** 2026-03-21  
**Status:** Upload Files UX fixes + Agent Request template update — complete

---

## Session Summary (2026-03-21)

This session focused on fixing four UX issues in the **M365 Copilot Upload Files** panel and enhancing the **Agent Request** template with two new sections.

---

## 1. Changes by File

### `src/copilotBridge.ts` — Four fixes

#### Fix 1 — Clicking file name in Upload Files panel triggered re-copy

**Symptom:** Clicking anywhere on a staged file's label opened a Finder window and an M365 Copilot browser tab — users had to precisely click the small inline button to avoid this.

**Root cause:** `CopilotFileItem` had a `this.command` property that fired `codeplanner.copilotRecopyFile` on any click of the item row.

**Fix:** Removed `this.command` from `CopilotFileItem`. The "Re-Copy to Clipboard" inline button (registered via `view/item/context` in `package.json`) still works — it's the only way to trigger a re-copy now.

---

#### Fix 2 — Re-Copy to Clipboard opened Finder + browser tab every time

**Symptom:** Clicking the inline "Re-Copy to Clipboard" button for a single file opened a new Finder staging window and a new M365 Copilot browser tab — the same heavy flow used by "Copy All".

**Root cause:** `copyAndNotify()` delegated to `_copyAndNotify()`, which ran the full staging-folder + Finder + Simple Browser flow regardless of whether it was a single re-copy or a full send.

**Fix:** Rewrote `copyAndNotify()` as a lightweight standalone method that only copies the file to the OS clipboard (image pixel data for images via AppleScript `«class PNGf»`, POSIX file reference for other files) and shows a brief notification. No Finder window, no browser tab.

---

#### Fix 3 — "Copy All to Clipboard" opened a new Finder window every click

**Symptom:** Clicking "Copy All to Clipboard" multiple times stacked new Finder windows instead of replacing the previous one.

**Root cause:** The AppleScript that closed previous Finder windows matched by converting stored paths to Finder aliases. macOS resolves `/var/folders` symlinks differently than the path stored by Node.js, so the alias match silently failed and the old window was never closed.

**Fix:** Changed the close logic to match Finder windows by **name** (`name contains "codeplanner-upload"`) instead of by alias target. This reliably catches every previous staging window regardless of symlink resolution.

---

#### Fix 4 — "Copy All to Clipboard" opened a new M365 Copilot tab every click

**Symptom:** Each click on "Copy All to Clipboard" opened a new Simple Browser tab for M365 Copilot Chat, leading to 4+ duplicate tabs after a few clicks.

**Root cause:** `simpleBrowser.show` was called unconditionally on every invocation of `_copyAndNotify()`.

**Fix:** Added a `_browserOpened` flag to `CopilotFilesProvider`. The Simple Browser tab is only opened on the first "Copy All" click; subsequent clicks skip the `simpleBrowser.show` call and reuse the existing tab.

---

### `src/agentRequestBuilder.ts` — Template update

Added two new sections to the Agent Request template (`buildTemplate()`):

- **## Instructions** — inserted before "## Constraints & Notes", for step-by-step instructions or acceptance criteria the agent should follow
- **## Expected Output** — appended at the end, for describing the expected deliverable (diff, feature, document, tests, etc.)

The template now has seven named sections: Task, Files & References, Workspace Context, Errors & Diagnostics, Instructions, Constraints & Notes, Expected Output.

---

## 2. Current State

| Area                        | Status      | Notes                                                             |
| --------------------------- | ----------- | ----------------------------------------------------------------- |
| OCR engine (`ocrEngine.ts`) | Complete    | Unchanged from session 01                                         |
| Agent Request Builder       | Updated     | Two new template sections: Instructions, Expected Output          |
| Drop-to-insert              | Complete    | Unchanged from session 02                                         |
| Upload Files panel          | Fixed       | Four UX bugs fixed (click handling, Finder/browser deduplication) |
| Re-Copy to Clipboard        | Fixed       | Lightweight clipboard-only, no Finder/browser side-effects        |
| Copy All to Clipboard       | Fixed       | Closes previous Finder window, reuses existing browser tab        |
| LM Tool registration        | Complete    | `codeplanner_extract_text`                                        |
| VSIX packaging              | Complete    | `codeplanner-0.2.0.vsix`                                          |
| Marketplace publish         | Pending     | Not yet submitted                                                 |
| Tests                       | Not started | No unit or integration tests yet                                  |

---

## 3. Known Issues / TODOs

- [ ] Test Upload Files panel on Windows / Linux
- [ ] Verify drop works in Cursor IDE
- [ ] Consider a "Remove file" context menu action on individual Upload Files items
- [ ] Add unit tests for `agentRequestBuilder` and `copilotBridge` functions
- [ ] Publish VSIX to VS Code Marketplace
