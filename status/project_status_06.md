# CodePlanner — Project Status 06

**Date:** 2026-03-22  
**Status:** Auto-Attach files to M365 Copilot via browser automation — complete

---

## Session Summary (2026-03-22)

This session added a **browser automation feature** that automatically attaches staged files to M365 Copilot Chat running in Chrome, Edge, or Safari on macOS. The feature uses AppleScript to detect the browser, activate the Copilot tab, and inject JavaScript that uploads files via the DataTransfer API — no native file dialogs, System Events permissions, or Accessibility access required.

Five rounds of bug fixes were needed to resolve AppleScript quoting, Chrome JS injection syntax, and macOS permission issues before the feature worked end-to-end.

---

## 1. Changes by File

### `src/browserAutomation.ts` — NEW (465 lines)

macOS-only module that orchestrates the Auto-Attach workflow:

| Function               | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `log()`                | Diagnostic output channel (`CodePlanner: Browser Automation`)                                 |
| `runAppleScript()`     | Writes AppleScript to a temp file and runs `osascript <file>` (avoids `-e` flag parsing bugs) |
| `isCopilotOpenIn()`    | Checks whether a browser has an M365 Copilot tab open; surfaces permission errors clearly     |
| `detectBrowser()`      | Probes Chrome → Edge → Safari for a Copilot tab; returns first match                          |
| `activateCopilotTab()` | Brings the Copilot tab to the foreground via AppleScript                                      |
| `executeJsInBrowser()` | Writes JS to a temp file, AppleScript reads via `cat` and executes — avoids string escaping   |
| `uploadFileViaJS()`    | base64-encodes a file in shell, injects JS that decodes → File → DataTransfer → dispatches    |
| `pastePrompt()`        | Inserts a planning prompt into the chat input via pure JS (no keystrokes)                     |
| `autoAttachFiles()`    | Public orchestrator: detect → activate → upload each file → prompt                            |

**Key design decisions:**

- **Temp file execution:** Both AppleScript and JavaScript are written to temp files (`/tmp/codeplanner_as_<pid>.applescript`, `/tmp/codeplanner_js_<pid>.js`) instead of being passed inline. This avoids quoting/escaping issues that caused bugs 2 and 3.
- **Nested `tell` for Chrome/Edge:** `execute javascript jsCode` must be inside `tell active tab of front window` … `end tell`. The one-liner `execute javascript "code" in active tab of front window` fails (bug 4).
- **No System Events / Accessibility:** File upload uses DataTransfer + File API injection; prompt insertion uses DOM manipulation. Zero keystroke simulation.

---

### `src/copilotBridge.ts` — MODIFIED (+56 lines)

- Imported `autoAttachFiles` from `browserAutomation.ts`
- Added `getStagedFiles(): string[]` public getter for the staged file list
- Added `autoAttachToCopilot()` method:
  - Validates at least one file is staged
  - Shows a `vscode.window.withProgress` notification during upload
  - On failure, offers a **"Use Finder Instead"** button that falls back to the existing `copyAllAndNotify()` flow

---

### `src/extension.ts` — MODIFIED (+5 lines)

Registered the new command:

```typescript
vscode.commands.registerCommand("codeplanner.autoAttachToCopilot", () =>
  provider.autoAttachToCopilot(),
);
```

---

### `package.json` — MODIFIED (+22 lines)

- **New command:** `codeplanner.autoAttachToCopilot` — "Auto-Attach to M365 Copilot" with `$(cloud-upload)` icon
- **Menu entry:** Added to `view/title` at `navigation@0` with `when: "view == codeplanner.copilotFiles && isMac"` — appears only on macOS
- **New settings:**
  - `codeplanner.copilotBrowser` — enum: `auto`, `Google Chrome`, `Microsoft Edge`, `Safari` (default: `auto`)
  - `codeplanner.copilotInputSelector` — CSS selector for the chat input field (default: `textarea, div[contenteditable='true']`)
- **Removed:** `codeplanner.copilotAttachSelector` (no longer needed — upload is direct via DataTransfer)

---

### `test/__mocks__/vscode.ts` — MODIFIED (+8 lines)

Added `createOutputChannel` mock with `appendLine`, `append`, `clear`, `show`, `hide`, `dispose` methods.

---

### `test/unit/browserAutomation.test.ts` — NEW (262 lines, 13 tests)

| Test group           | Count | Coverage                                                |
| -------------------- | ----- | ------------------------------------------------------- |
| `runAppleScript`     | 3     | Success, error propagation, temp file cleanup           |
| `detectBrowser`      | 3     | Chrome detection, Edge fallback, no-browser error       |
| `activateCopilotTab` | 2     | Tab activation, AppleScript called with correct browser |
| `uploadFileViaJS`    | 3     | File encoding, JS injection, file-not-found error       |
| `autoAttachFiles`    | 2     | Full orchestration, empty file list error               |

---

## 2. Bug Fix History

### Bug 1 — Silent permission errors

**Symptom:** "Could not find M365 Copilot Chat in any browser" even though Copilot was open.

**Root cause:** `isCopilotOpenIn()` had a bare `catch {}` that silently swallowed permission-denied errors from macOS.

**Fix:** Added error logging and re-throw for permission-related errors with actionable guidance (grant Automation permission, enable Chrome's Allow JavaScript from Apple Events).

---

### Bug 2 — JSON.stringify corrupting JavaScript inside AppleScript

**Symptom:** `execute javascript` threw a syntax error in the browser.

**Root cause:** `JSON.stringify()` produces escape sequences (`\n`, `\\`) that AppleScript interprets as literal characters, corrupting the injected JavaScript.

**Fix:** Write JavaScript to a temp file; AppleScript reads it via `do shell script "cat /tmp/codeplanner_js_<pid>.js"`.

---

### Bug 3 — osascript `-e` flag multi-line parsing

**Symptom:** AppleScript threw syntax errors for scripts combining `set` and `tell` blocks.

**Root cause:** The `-e` flag doesn't reliably handle multi-line AppleScript, especially `set` + `tell` combinations.

**Fix:** Write the entire AppleScript to a temp file and run `osascript <file>` instead of `osascript -e '...'`.

---

### Bug 4 — Chrome `execute javascript` syntax

**Symptom:** "Can't make application into type specifier" error (-1700).

**Root cause:** `execute javascript "code" in active tab of front window` — the `in` keyword is parsed as a property accessor, not a scope qualifier.

**Fix:** Use a nested `tell` block:

```applescript
tell active tab of front window
    execute javascript jsCode
end tell
```

Also discovered Chrome requires **View → Developer → Allow JavaScript from Apple Events** to be enabled.

---

### Bug 5 — System Events keystroke permissions

**Symptom:** "osascript is not allowed to send keystrokes" (error 1002).

**Root cause:** The original design used `System Events` to send keystrokes for file dialog interaction and prompt pasting, requiring Accessibility permissions.

**Fix:** Eliminated System Events entirely. File upload uses base64 encoding + DataTransfer + File API via JS injection. Prompt insertion uses DOM manipulation. Zero Accessibility permissions needed.

---

## 3. Current State

| Area                         | Status   | Notes                                                           |
| ---------------------------- | -------- | --------------------------------------------------------------- |
| OCR engine (`ocrEngine.ts`)  | Complete | Unchanged from session 01                                       |
| Agent Request Builder        | Complete | Seven template sections (session 04)                            |
| Drop-to-insert               | Complete | Unchanged from session 02                                       |
| Upload Files panel           | Complete | UX fixes from session 04                                        |
| Screenshot capture (macOS)   | Complete | `screencapture -i` — unchanged                                  |
| Screenshot capture (Windows) | Complete | Automated Win+Shift+S → clipboard polling (session 05)          |
| Screenshot capture (Linux)   | Complete | gnome-screenshot / scrot fallback — unchanged                   |
| LM Tool registration         | Complete | `codeplanner_extract_text`                                      |
| Browser automation (macOS)   | **New**  | Auto-Attach via AppleScript + JS injection (Chrome/Edge/Safari) |
| Finder fallback              | Complete | Existing flow preserved as fallback on failure                  |
| Test suite                   | Complete | 91 tests (82 unit + 9 integration), Jest + ts-jest, all passing |
| VSIX packaging               | Complete | `codeplanner-0.2.0.vsix`                                        |
| Marketplace publish          | Pending  | Not yet submitted                                               |

---

## 4. Known Issues / TODOs

- [ ] Test Auto-Attach with Microsoft Edge and Safari
- [ ] Test Upload Files panel on Windows / Linux
- [ ] Verify drop works in Cursor IDE
- [ ] Consider a "Remove file" context menu action on individual Upload Files items
- [ ] Publish VSIX to VS Code Marketplace
- [ ] Add code coverage reporting (`--coverage` flag)
- [ ] Test the Windows screenshot flow end-to-end on Windows hardware
