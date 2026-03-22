/**
 * Unit tests for browserAutomation.ts
 *
 * Tests AppleScript generation, browser detection, System Events keystroke
 * sequences, and the auto-attach orchestration flow.
 *
 * All child_process calls are mocked — no actual AppleScript is executed.
 */

jest.mock('vscode');
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

import * as cp from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';

import {
  runAppleScript,
  detectBrowser,
  activateCopilotTab,
  executeJsInBrowser,
  uploadFileViaJS,
  autoAttachFiles,
} from '../../src/browserAutomation';

const execFileMock = cp.execFile as unknown as jest.Mock;
const writeFileSyncMock = fs.writeFileSync as unknown as jest.Mock;

/**
 * Extract the AppleScript that was written to the temp file for a given
 * execFile call.  Since runAppleScript writes the script via writeFileSync
 * before calling execFile, the Nth execFile call corresponds to the Nth
 * writeFileSync call (skipping any JS temp-file writes from executeJsInBrowser).
 */
function getScript(writeCallIndex: number): string {
  return writeFileSyncMock.mock.calls[writeCallIndex][1] as string;
}

/** Helper: make execFile call back with success and the given stdout. */
function mockExecFileSuccess(stdout = ''): void {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, stdout);
    },
  );
}

/** Helper: make execFile call back with an error. */
function mockExecFileError(message = 'script failed'): void {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
      cb(new Error(message));
    },
  );
}

/**
 * Helper: make sequential execFile calls return different stdout values.
 * Each call pops the next value from the array; remaining calls return ''.
 */
function mockExecFileSequence(results: string[]): void {
  let idx = 0;
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      const stdout = idx < results.length ? results[idx] : '';
      idx++;
      cb(null, stdout);
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  // Mock vscode.workspace.getConfiguration
  const mockConfig = {
    get: jest.fn((key: string, defaultVal: unknown) => defaultVal),
  };
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig);
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// runAppleScript
// ---------------------------------------------------------------------------

describe('runAppleScript', () => {
  it('should write script to temp file and call osascript with file path', async () => {
    mockExecFileSuccess('hello');

    const result = await runAppleScript('return "hello"');

    // Script should be written to a temp file
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('codeplanner_as_'),
      'return "hello"',
      'utf-8',
    );
    // osascript should be called with the temp file path (no -e flags)
    expect(execFileMock).toHaveBeenCalledWith(
      'osascript',
      [expect.stringContaining('codeplanner_as_')],
      expect.objectContaining({ timeout: 15_000 }),
      expect.any(Function),
    );
    expect(result).toBe('hello');
  });

  it('should reject when osascript fails', async () => {
    mockExecFileError('permission denied');

    await expect(runAppleScript('bad script')).rejects.toThrow('permission denied');
  });

  it('should use custom timeout', async () => {
    mockExecFileSuccess('ok');

    await runAppleScript('return "ok"', 5_000);

    expect(execFileMock).toHaveBeenCalledWith(
      'osascript',
      [expect.stringContaining('codeplanner_as_')],
      expect.objectContaining({ timeout: 5_000 }),
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// detectBrowser
// ---------------------------------------------------------------------------

describe('detectBrowser', () => {
  it('should return null when no browser has Copilot open', async () => {
    // All System Events checks return false (process not running)
    mockExecFileSuccess('false');

    const result = await detectBrowser();

    expect(result).toBeNull();
  });

  it('should return "Google Chrome" when Chrome has Copilot open', async () => {
    // Sequence: Chrome process check → true, Chrome tab check → yes
    mockExecFileSequence(['true', 'yes']);

    const result = await detectBrowser();

    expect(result).toBe('Google Chrome');
  });

  it('should skip to Edge if Chrome is not running', async () => {
    // Chrome not running, Edge running + has Copilot
    mockExecFileSequence(['false', 'true', 'yes']);

    const result = await detectBrowser();

    expect(result).toBe('Microsoft Edge');
  });
});

// ---------------------------------------------------------------------------
// activateCopilotTab
// ---------------------------------------------------------------------------

describe('activateCopilotTab', () => {
  it('should generate correct AppleScript for Chrome', async () => {
    mockExecFileSuccess();

    await activateCopilotTab('Google Chrome');

    // writeFileSync call index 0 = the AppleScript temp file
    const calledScript = writeFileSyncMock.mock.calls[0][1] as string;
    expect(calledScript).toContain('tell application "Google Chrome"');
    expect(calledScript).toContain('activate');
    expect(calledScript).toContain('m365.cloud.microsoft');
  });

  it('should generate correct AppleScript for Safari', async () => {
    mockExecFileSuccess();

    await activateCopilotTab('Safari');

    const calledScript = writeFileSyncMock.mock.calls[0][1] as string;
    expect(calledScript).toContain('tell application "Safari"');
    expect(calledScript).toContain('current tab');
  });
});

// ---------------------------------------------------------------------------
// uploadFileViaJS
// ---------------------------------------------------------------------------

describe('uploadFileViaJS', () => {
  it('should read file as base64 then inject JS with DataTransfer', async () => {
    // Sequence: base64 read → return b64 data, JS execution → 'attached_input'
    mockExecFileSequence(['SGVsbG8=', 'attached_input']);

    await uploadFileViaJS('Google Chrome', '/Users/test/document.txt');

    // First call: base64 read via runAppleScript
    const b64Script = writeFileSyncMock.mock.calls[0][1] as string;
    expect(b64Script).toContain('base64');
    expect(b64Script).toContain('/Users/test/document.txt');

    // Second call: JS file written with DataTransfer logic
    const jsContent = writeFileSyncMock.mock.calls[1][1] as string;
    expect(jsContent).toContain('DataTransfer');
    expect(jsContent).toContain('document.txt');
    expect(jsContent).toContain('text/plain');
  });

  it('should throw when no file input or drop zone is found', async () => {
    mockExecFileSequence(['SGVsbG8=', 'no_target']);

    await expect(uploadFileViaJS('Google Chrome', '/test/file.ts'))
      .rejects.toThrow('Could not find a file input or drop zone');
  });

  it('should detect MIME type from extension', async () => {
    mockExecFileSequence(['data', 'attached_input']);

    await uploadFileViaJS('Google Chrome', '/test/image.png');

    const jsContent = writeFileSyncMock.mock.calls[1][1] as string;
    expect(jsContent).toContain('image/png');
  });
});

// ---------------------------------------------------------------------------
// autoAttachFiles (orchestrator)
// ---------------------------------------------------------------------------

describe('autoAttachFiles', () => {
  it('should return error when no files provided', async () => {
    const result = await autoAttachFiles([]);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('No files to attach.');
  });

  it('should return error when browser detection fails (auto mode)', async () => {
    // All process checks return false
    mockExecFileSuccess('false');

    jest.useRealTimers();
    const result = await autoAttachFiles(['/test/file.ts']);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Could not find M365 Copilot Chat');
  });
});
