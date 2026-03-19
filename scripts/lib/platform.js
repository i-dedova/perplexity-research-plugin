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

  // Find the hash directory — pick the most recently modified one
  // (handles version upgrades that create new hash dirs)
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

  return join(baseDir, subdirs[0]);
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
      const script = `
        tell application "System Events"
          repeat with proc in every process whose visible is true
            repeat with win in every window of proc
              try
                if name of win contains "${titlePattern}" then
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

module.exports = {
  getPlatform,
  isWindows,
  getPlaywrightSessionDir,
  minimizeWindows
};
