/**
 * platform.js - Cross-platform utilities for Perplexity Research Plugin
 *
 * Handles:
 * - Platform detection
 * - Playwright session directory location
 * - Window minimize (cross-platform)
 */

const { execSync, execFileSync } = require('child_process');
const { existsSync, readdirSync, statSync } = require('fs');
const { join } = require('path');
const { homedir, platform } = require('os');

//region Platform Detection

/**
 * Get normalized platform name
 * @returns {'windows'|'macos'|'linux'}
 */
function getPlatform() {
  const p = platform();
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  return 'linux';
}

/**
 * Check if running on Windows
 * @returns {boolean}
 */
function isWindows() {
  return platform() === 'win32';
}

//endregion

//region Playwright Session Directory

/**
 * Get Playwright session directory path (cross-platform)
 * @returns {string|null} - Path to session directory or null if not found
 */
function getPlaywrightSessionDir() {
  const currentPlatform = getPlatform();
  let baseDir;

  if (currentPlatform === 'windows') {
    baseDir = join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      'ms-playwright',
      'daemon'
    );
  } else if (currentPlatform === 'macos') {
    baseDir = join(homedir(), 'Library', 'Application Support', 'ms-playwright', 'daemon');
  } else {
    baseDir = join(homedir(), '.local', 'share', 'ms-playwright', 'daemon');
  }

  if (!existsSync(baseDir)) {
    return null;
  }

  // Find hash directories sorted by modification time (newest first).
  // CLI version upgrades create new hash dirs, orphaning sessions in old ones.
  const subdirs = readdirSync(baseDir)
    .filter(f => {
      try { return statSync(join(baseDir, f)).isDirectory(); }
      catch { return false; }
    })
    .sort((a, b) => {
      try {
        return statSync(join(baseDir, b)).mtimeMs - statSync(join(baseDir, a)).mtimeMs;
      } catch { return 0; }
    });

  if (subdirs.length === 0) {
    return null;
  }

  const newestDir = join(baseDir, subdirs[0]);

  // Auto-migrate: CLI upgrades create new daemon hash dirs, leaving sessions in old ones.
  // Copy session dirs from old to new so users don't lose their authenticated sessions.
  // Cookies and login state survive the copy — no re-login needed.
  if (subdirs.length > 1) {
    const hasSessions = (dir) => {
      try { return readdirSync(dir).some(f => f.startsWith('ud-perplexity-')); }
      catch { return false; }
    };

    if (!hasSessions(newestDir)) {
      for (let i = 1; i < subdirs.length; i++) {
        const oldDir = join(baseDir, subdirs[i]);
        if (hasSessions(oldDir)) {
          const sessions = readdirSync(oldDir).filter(f => f.startsWith('ud-perplexity-'));
          for (const session of sessions) {
            try {
              const dest = join(newestDir, session);
              if (!existsSync(dest)) {
                require('fs').cpSync(join(oldDir, session), dest, { recursive: true });
              }
            } catch { /* skip failed copies */ }
          }
          break;
        }
      }
    }
  }

  return newestDir;
}

//endregion

//region Window Management

/**
 * Minimize windows matching a title pattern (cross-platform)
 * @param {string} titlePattern - Pattern to match window titles
 */
function minimizeWindows(titlePattern) {
  const currentPlatform = getPlatform();

  try {
    if (currentPlatform === 'windows') {
      // Windows: Use PowerShell with Win32 API
      const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public const int SW_MINIMIZE = 6;
}
"@
[Win32]::EnumWindows({
    param([IntPtr]$hwnd, [IntPtr]$lParam)
    if ([Win32]::IsWindowVisible($hwnd)) {
        $sb = New-Object System.Text.StringBuilder 256
        [Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null
        $title = $sb.ToString()
        if ($title -like "*${titlePattern}*" -and $title -notlike "*Visual Studio Code*") {
            [Win32]::ShowWindow($hwnd, [Win32]::SW_MINIMIZE) | Out-Null
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
`;
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10000
      });

    } else if (currentPlatform === 'macos') {
      // macOS: Use AppleScript via execFileSync (no shell escaping issues)
      const escaped = titlePattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `
        tell application "System Events"
          repeat with proc in every process whose visible is true
            repeat with win in every window of proc
              try
                if name of win contains "${escaped}" then
                  set miniaturized of win to true
                end if
              end try
            end repeat
          end repeat
        end tell
      `;
      execFileSync('osascript', ['-e', script], {
        encoding: 'utf8',
        timeout: 10000
      });

    } else {
      // Linux: Try xdotool via execFileSync (no shell injection)
      try {
        const windowIds = execFileSync('xdotool', ['search', '--name', titlePattern], {
          encoding: 'utf8'
        }).trim().split('\n').filter(Boolean);
        for (const id of windowIds) {
          execFileSync('xdotool', ['windowminimize', id], { encoding: 'utf8' });
        }
      } catch {
        // xdotool not available - silently continue
      }
    }
  } catch {
    // Minimize failed - not critical
  }
}

//endregion

//region String Utilities

/**
 * Clear browser session restore files from a persistent profile.
 * Prevents the browser from restoring previous tabs (including ghost about:blank tabs)
 * when launched with --persistent. Works for Edge and Chrome.
 * @param {string} userDataDir - Path to the browser's user-data-dir
 */
function clearSessionRestore(userDataDir) {
  if (!userDataDir) return;
  const sessionsDir = join(userDataDir, 'Default', 'Sessions');
  if (!existsSync(sessionsDir)) return;

  try {
    const files = readdirSync(sessionsDir);
    for (const file of files) {
      try {
        const filePath = join(sessionsDir, file);
        if (statSync(filePath).isFile()) {
          require('fs').unlinkSync(filePath);
        }
      } catch { /* skip locked files */ }
    }
  } catch { /* Sessions dir may not exist or be inaccessible */ }
}

/**
 * Strip PowerShell CLIXML progress/error blocks from captured output.
 * Windows-only issue: when Node's execFileSync captures stderr from a process
 * that triggers PowerShell, the progress stream leaks XML blocks like:
 *   #< CLIXML\n<Objs Version="1.1.0.1" ...>...</Objs>
 * These pollute error messages and break JSON parsing.
 * No-op on non-Windows or strings without CLIXML.
 * @param {string} str - String to clean
 * @returns {string} Cleaned string
 */
function stripCliXml(str) {
  if (!str || !str.includes('CLIXML')) return str;
  return str
    .replace(/#< CLIXML\r?\n<Objs[\s\S]*?<\/Objs>/g, '')
    .replace(/\r?\n{2,}/g, '\n')
    .trim();
}

//endregion

module.exports = {
  getPlatform,
  isWindows,
  getPlaywrightSessionDir,
  minimizeWindows,
  clearSessionRestore,
  stripCliXml
};
