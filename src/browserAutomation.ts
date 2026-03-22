/**
 * Browser Automation — Auto-Attach files to M365 Copilot Chat
 *
 * macOS-only module that automates file upload to M365 Copilot Chat
 * running in an external browser (Chrome, Edge, or Safari).
 *
 * How it works
 * ────────────
 *  1. Detect which browser has M365 Copilot open (or use the configured one)
 *  2. Activate the Copilot tab via AppleScript
 *  3. For each file, read it via `base64` in a shell command, then inject
 *     JavaScript that creates a File object via the DataTransfer API and
 *     dispatches it to the hidden file input — no native file dialog needed
 *  4. Optionally insert a planning prompt into the chat input via JS
 *
 * Note: This does NOT work with VS Code's built-in Simple Browser (which is
 * a WebView inside Electron with no AppleScript interface).  The existing
 * Finder-based flow in copilotBridge.ts remains the fallback for Simple Browser.
 */

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

let _outputChannel: vscode.OutputChannel | undefined;

/** Get (or lazily create) the output channel for diagnostics. */
function log(msg: string): void {
  if (!_outputChannel) {
    _outputChannel = vscode.window.createOutputChannel('CodePlanner Browser Automation');
  }
  _outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedBrowser = 'Google Chrome' | 'Microsoft Edge' | 'Safari';

export interface AutoAttachResult {
  success: boolean;
  filesAttached: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run an AppleScript snippet via osascript.  Returns stdout.
 *
 * The script is written to a temp file and executed with `osascript <file>`
 * rather than using `-e` flags.  This avoids all escaping / quoting issues
 * that arise when mixing top-level `set` statements with `tell` blocks
 * or embedding JavaScript strings through `-e`.
 */
export function runAppleScript(script: string, timeoutMs = 15_000): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `codeplanner_as_${process.pid}.applescript`);
  fs.writeFileSync(tmpFile, script, 'utf-8');
  return new Promise((resolve, reject) => {
    cp.execFile('osascript', [tmpFile], { timeout: timeoutMs }, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err) { reject(err); } else { resolve(stdout.trim()); }
    });
  });
}

/** Pause for `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Browser detection
// ---------------------------------------------------------------------------

/**
 * Check whether M365 Copilot Chat is open in a specific browser by querying
 * the browser's tab URLs via AppleScript.
 */
async function isCopilotOpenIn(browser: SupportedBrowser): Promise<boolean> {
  const script = browser === 'Safari'
    ? [
        `tell application "Safari"`,
        `  set tabURLs to URL of every tab of every window`,
        `  repeat with wTabs in tabURLs`,
        `    repeat with u in wTabs`,
        `      if u as text contains "m365.cloud.microsoft" then return "yes"`,
        `    end repeat`,
        `  end repeat`,
        `  return "no"`,
        `end tell`,
      ].join('\n')
    : [
        `tell application "${browser}"`,
        `  repeat with w in every window`,
        `    repeat with t in every tab of w`,
        `      if URL of t contains "m365.cloud.microsoft" then return "yes"`,
        `    end repeat`,
        `  end repeat`,
        `  return "no"`,
        `end tell`,
      ].join('\n');

  try {
    log(`isCopilotOpenIn(${browser}): querying tabs…`);
    const result = await runAppleScript(script, 8_000);
    log(`isCopilotOpenIn(${browser}): result = "${result}"`);
    return result === 'yes';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`isCopilotOpenIn(${browser}): ERROR — ${msg}`);
    // Surface permission errors so the user knows what to fix
    if (msg.includes('not permitted') || msg.includes('not allowed') || msg.includes('1002')) {
      throw new Error(
        `macOS blocked AppleScript access to ${browser}. ` +
        `Go to System Settings → Privacy & Security → Automation and allow ` +
        `"Visual Studio Code" (or "Code Helper") to control "${browser}".`,
      );
    }
    return false;
  }
}

/**
 * Detect which browser has M365 Copilot open.
 * Checks Chrome, Edge, then Safari — returns the first match.
 */
export async function detectBrowser(): Promise<SupportedBrowser | null> {
  const browsers: SupportedBrowser[] = ['Google Chrome', 'Microsoft Edge', 'Safari'];
  const permissionErrors: string[] = [];

  for (const browser of browsers) {
    // Only check browsers that are actually running
    try {
      log(`detectBrowser: checking if ${browser} is running…`);
      const running = await runAppleScript(
        `tell application "System Events" to return (name of every process) contains "${browser}"`,
        5_000,
      );
      log(`detectBrowser: ${browser} running = "${running}"`);
      if (running !== 'true') { continue; }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`detectBrowser: error checking ${browser} process — ${msg}`);
      continue;
    }

    try {
      if (await isCopilotOpenIn(browser)) {
        log(`detectBrowser: found M365 Copilot in ${browser}`);
        return browser;
      }
    } catch (err) {
      // Permission errors from isCopilotOpenIn are re-thrown
      if (err instanceof Error) { permissionErrors.push(err.message); }
    }
  }

  // If we collected permission errors, throw them so the user gets guidance
  if (permissionErrors.length > 0) {
    throw new Error(permissionErrors.join(' '));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tab activation
// ---------------------------------------------------------------------------

/**
 * Bring the M365 Copilot tab to the front in the specified browser.
 */
export async function activateCopilotTab(browser: SupportedBrowser): Promise<void> {
  const script = browser === 'Safari'
    ? [
        `tell application "Safari"`,
        `  activate`,
        `  repeat with w in every window`,
        `    set tabIdx to 0`,
        `    repeat with t in every tab of w`,
        `      set tabIdx to tabIdx + 1`,
        `      if URL of t contains "m365.cloud.microsoft" then`,
        `        set current tab of w to t`,
        `        set index of w to 1`,
        `        return`,
        `      end if`,
        `    end repeat`,
        `  end repeat`,
        `end tell`,
      ].join('\n')
    : [
        `tell application "${browser}"`,
        `  activate`,
        `  repeat with w in every window`,
        `    set tabIdx to 0`,
        `    repeat with t in every tab of w`,
        `      set tabIdx to tabIdx + 1`,
        `      if URL of t contains "m365.cloud.microsoft" then`,
        `        set active tab index of w to tabIdx`,
        `        set index of w to 1`,
        `        return`,
        `      end if`,
        `    end repeat`,
        `  end repeat`,
        `end tell`,
      ].join('\n');

  await runAppleScript(script, 10_000);
}

// ---------------------------------------------------------------------------
// Execute JavaScript in a browser via AppleScript
// ---------------------------------------------------------------------------

/**
 * Execute JavaScript in the browser via AppleScript.
 *
 * To avoid AppleScript string-escaping pitfalls (AppleScript only recognises
 * \"  as an escape — \n, \\, etc. are treated as literal characters, which
 * corrupts embedded JS), we write the JavaScript to a temp file and have
 * AppleScript read it with `do shell script "cat …"`.
 */
export async function executeJsInBrowser(
  browser: SupportedBrowser,
  js: string,
  timeoutMs = 10_000,
): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `codeplanner_js_${process.pid}.js`);
  fs.writeFileSync(tmpFile, js, 'utf-8');
  try {
    const catCmd = `cat ${tmpFile.replace(/'/g, "'\\''")}`;
    const script = browser === 'Safari'
      ? [
          `set jsCode to do shell script "${catCmd}"`,
          `tell application "Safari"`,
          `  do JavaScript jsCode in current tab of front window`,
          `end tell`,
        ].join('\n')
      : [
          `set jsCode to do shell script "${catCmd}"`,
          `tell application "${browser}"`,
          `  tell active tab of front window`,
          `    execute javascript jsCode`,
          `  end tell`,
          `end tell`,
        ].join('\n');
    return await runAppleScript(script, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('JavaScript through AppleScript is turned off') || msg.includes('Allow JavaScript from Apple Events')) {
      throw new Error(
        `${browser} requires "Allow JavaScript from Apple Events" to be enabled. ` +
        `In ${browser}, go to View → Developer → Allow JavaScript from Apple Events.`,
      );
    }
    throw err;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Upload a file via JavaScript injection (DataTransfer + File API)
// ---------------------------------------------------------------------------

/**
 * Upload a file to M365 Copilot by injecting JavaScript that:
 *  1. Reads base64-encoded file content (passed inline)
 *  2. Creates a File object via the DataTransfer API
 *  3. Finds the hidden <input type="file"> and sets its files
 *  4. Dispatches a 'change' event so the app picks it up
 *
 * This avoids the native file dialog entirely — no System Events or
 * Accessibility permissions required.
 */
export async function uploadFileViaJS(
  browser: SupportedBrowser,
  filePath: string,
): Promise<void> {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Determine MIME type from extension
  const mimeMap: Record<string, string> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.ts': 'text/typescript', '.js': 'text/javascript', '.html': 'text/html',
    '.css': 'text/css', '.xml': 'text/xml', '.csv': 'text/csv',
    '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  // Read file as base64 via shell (AppleScript do shell script)
  const b64 = await runAppleScript(
    `do shell script "base64 -i ${filePath.replace(/"/g, '\\"')}"`,
    15_000,
  );

  // Build JavaScript that decodes + dispatches the file
  const js = [
    '(function(){',
    `  var b64 = ${JSON.stringify(b64)};`,
    '  var binary = atob(b64);',
    '  var bytes = new Uint8Array(binary.length);',
    '  for(var i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);',
    `  var file = new File([bytes], ${JSON.stringify(fileName)}, {type:${JSON.stringify(mimeType)}});`,
    '  var dt = new DataTransfer();',
    '  dt.items.add(file);',
    // Try to find a file input (hidden or visible)
    '  var input = document.querySelector("input[type=file]");',
    '  if(input){',
    '    input.files = dt.files;',
    '    input.dispatchEvent(new Event("change",{bubbles:true}));',
    "    return 'attached_input';",
    '  }',
    // Fallback: dispatch a drop event on the chat area
    '  var dropZone = document.querySelector("[class*=chat], [class*=Chat], [role=main], main, #app");',
    '  if(dropZone){',
    '    var dropEvt = new DragEvent("drop",{bubbles:true,dataTransfer:dt});',
    '    dropZone.dispatchEvent(dropEvt);',
    "    return 'attached_drop';",
    '  }',
    "  return 'no_target';",
    '})()',
  ].join('\n');

  const result = await executeJsInBrowser(browser, js, 20_000);
  log(`uploadFileViaJS(${fileName}): result = "${result}"`);
  if (result === 'no_target') {
    throw new Error(
      `Could not find a file input or drop zone in ${browser}. ` +
      `The M365 Copilot page structure may have changed.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Paste a prompt into the chat input
// ---------------------------------------------------------------------------

/**
 * Focus the M365 Copilot chat input and insert prompt text via JavaScript.
 * No System Events / keystroke permissions required.
 */
export async function pastePrompt(browser: SupportedBrowser, text: string): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codeplanner');
  const selector = cfg.get<string>(
    'copilotInputSelector',
    "textarea, div[contenteditable='true']",
  );

  const js = [
    '(function(){',
    `  var el = document.querySelector(${JSON.stringify(selector)});`,
    '  if(!el) return "not_found";',
    '  el.focus();',
    // Handle both textarea and contenteditable
    '  if(el.tagName==="TEXTAREA"||el.tagName==="INPUT"){',
    `    el.value = ${JSON.stringify(text)};`,
    '    el.dispatchEvent(new Event("input",{bubbles:true}));',
    '  } else {',
    `    el.textContent = ${JSON.stringify(text)};`,
    '    el.dispatchEvent(new Event("input",{bubbles:true}));',
    '  }',
    '  return "inserted";',
    '})()',
  ].join('\n');

  await executeJsInBrowser(browser, js, 10_000);
}

// ---------------------------------------------------------------------------
// Orchestrator — auto-attach all files
// ---------------------------------------------------------------------------

/**
 * Orchestrate the full auto-attach flow:
 *  1. Detect (or use configured) browser
 *  2. Activate the M365 Copilot tab
 *  3. For each file: upload via JavaScript (DataTransfer + File API)
 *  4. Optionally insert a prompt via JavaScript
 */
export async function autoAttachFiles(
  filePaths: string[],
  prompt?: string,
): Promise<AutoAttachResult> {
  const result: AutoAttachResult = { success: false, filesAttached: 0, errors: [] };

  if (filePaths.length === 0) {
    result.errors.push('No files to attach.');
    return result;
  }

  // ── Resolve browser ──────────────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('codeplanner');
  const browserSetting = cfg.get<string>('copilotBrowser', 'auto');

  let browser: SupportedBrowser | null;
  if (browserSetting === 'auto') {
    try {
      browser = await detectBrowser();
    } catch (err) {
      // Permission error — propagate the helpful message
      result.errors.push(err instanceof Error ? err.message : String(err));
      return result;
    }
    if (!browser) {
      result.errors.push(
        'Could not find M365 Copilot Chat in any browser. ' +
        'Open https://m365.cloud.microsoft/chat/ in Chrome, Edge, or Safari first. ' +
        'Check the "CodePlanner Browser Automation" output panel for details.',
      );
      return result;
    }
  } else {
    browser = browserSetting as SupportedBrowser;
  }

  // ── Activate tab ─────────────────────────────────────────────────────────
  try {
    await activateCopilotTab(browser);
  } catch (err) {
    result.errors.push(`Failed to activate ${browser}: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  await delay(1000);

  // ── Attach each file ─────────────────────────────────────────────────────
  for (const fp of filePaths) {
    try {
      await uploadFileViaJS(browser, fp);
      result.filesAttached++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to attach "${fp}": ${msg}`);
      // Continue with remaining files
    }
    // Delay between files to let the UI settle
    await delay(1500);
  }

  // ── Paste prompt ─────────────────────────────────────────────────────────
  if (prompt) {
    try {
      await pastePrompt(browser, prompt);
    } catch (err) {
      result.errors.push(`Failed to paste prompt: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  result.success = result.filesAttached > 0;
  return result;
}
