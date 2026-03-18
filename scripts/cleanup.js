#!/usr/bin/env node
/**
 * cleanup.js - Clean up .playwright-cli/ directories across all tracked project dirs
 *
 * Cleans:
 * - .playwright-cli/ in every directory registered in tracked-dirs.json
 *   (logs, snapshots, downloads, session state)
 *
 * Usage:
 *   node cleanup.js              - Clean if due (based on config interval)
 *   node cleanup.js --force      - Clean now regardless of schedule
 *   node cleanup.js --dry-run    - Show what would be cleaned
 *   node cleanup.js --status     - Show cleanup status
 */

const { existsSync, readdirSync, statSync, unlinkSync, rmdirSync } = require('fs');
const { join } = require('path');

// Import shared lib
const { config, logger, PATHS, DEFAULTS } = require('./lib');

// Self-logging
const date = new Date().toISOString().slice(0, 10);
const log = logger.create(`cleanup-${date}`);

//region Cleanup Functions

function getFilesInDir(dirPath) {
  if (!existsSync(dirPath)) return [];

  const files = [];
  try {
    for (const entry of readdirSync(dirPath)) {
      const fullPath = join(dirPath, entry);
      try {
        const stat = statSync(fullPath);
        files.push({
          path: fullPath,
          name: entry,
          size: stat.size,
          mtime: stat.mtime,
          isDirectory: stat.isDirectory()
        });
      } catch {}
    }
  } catch {}

  return files;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function cleanDirectory(dirPath, dryRun = false) {
  const files = getFilesInDir(dirPath);
  let totalSize = 0;
  let fileCount = 0;

  for (const file of files) {
    try {
      if (file.isDirectory) {
        const subResult = cleanDirectory(file.path, dryRun);
        totalSize += subResult.totalSize;
        fileCount += subResult.fileCount;

        if (!dryRun) {
          try { rmdirSync(file.path); } catch {}
        }
      } else {
        totalSize += file.size;
        fileCount++;
        if (!dryRun) unlinkSync(file.path);
      }
    } catch (e) {
      console.log(`  Warning: Could not remove ${file.name}: ${e.message}`);
    }
  }

  return { totalSize, fileCount };
}

function cleanOldLogs(dryRun = false) {
  const logsDir = PATHS.logsDir;
  if (!existsSync(logsDir)) return { fileCount: 0, totalSize: 0 };

  const retentionDays = config.getLogRetentionDays();
  const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

  const files = getFilesInDir(logsDir);
  let fileCount = 0, totalSize = 0;
  for (const file of files) {
    if (file.name.endsWith('.log') && file.mtime.getTime() < cutoff) {
      totalSize += file.size;
      fileCount++;
      if (!dryRun) unlinkSync(file.path);
    }
  }
  return { fileCount, totalSize };
}

//endregion

//region Commands

function cmdStatus() {
  const cfg = config.getConfig();
  const cleanupDays = cfg.cleanupDays || DEFAULTS.cleanupDays;
  const logRetentionDays = cfg.logRetentionDays || DEFAULTS.logRetentionDays;
  const lastCleanup = cfg.lastCleanup ? new Date(cfg.lastCleanup) : null;

  console.log('=== Perplexity Research Cleanup Status ===\n');

  console.log(`Cleanup interval: ${cleanupDays} days`);
  console.log(`Log retention: ${logRetentionDays} days`);
  if (lastCleanup) {
    const daysSince = Math.floor((Date.now() - lastCleanup.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`Last cleanup: ${lastCleanup.toISOString()} (${daysSince} days ago)`);
    console.log(`Status: ${daysSince >= cleanupDays ? 'CLEANUP DUE' : `Next in ${cleanupDays - daysSince} days`}`);
  } else {
    console.log('Last cleanup: Never');
    console.log('Status: CLEANUP DUE');
  }

  // Log directory info
  if (existsSync(PATHS.logsDir)) {
    const logFiles = getFilesInDir(PATHS.logsDir).filter(f => f.name.endsWith('.log'));
    const logSize = logFiles.reduce((sum, f) => sum + f.size, 0);
    console.log(`\nLogs: ${logFiles.length} files, ${formatBytes(logSize)} (${PATHS.logsDir})`);
  }

  console.log('\n--- Tracked Directories ---\n');

  const registry = config.getTrackedDirs();
  let totalFiles = 0;
  let totalSize = 0;

  for (const [dir, info] of Object.entries(registry.dirs)) {
    const playwrightDir = join(dir, '.playwright-cli');
    if (!existsSync(playwrightDir)) {
      console.log(`  ${dir}: NOT FOUND (stale)`);
      continue;
    }
    const files = getFilesInDir(playwrightDir);
    const size = files.reduce((sum, f) => sum + f.size, 0);
    totalFiles += files.length;
    totalSize += size;
    console.log(`  ${dir}: ${files.length} files, ${formatBytes(size)}`);
    console.log(`    Last used: ${info.lastUsed}`);
  }

  if (Object.keys(registry.dirs).length === 0) {
    console.log('  No tracked directories.');
  }

  console.log(`\nTotal: ${totalFiles} files, ${formatBytes(totalSize)}`);
}

function cmdCleanup(force = false, dryRun = false) {
  const cfg = config.getConfig();
  const cleanupDays = cfg.cleanupDays || DEFAULTS.cleanupDays;
  const lastCleanup = cfg.lastCleanup ? new Date(cfg.lastCleanup) : null;

  if (!force && lastCleanup) {
    const daysSince = Math.floor((Date.now() - lastCleanup.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince < cleanupDays) {
      console.log(`Cleanup not due yet. Last cleanup was ${daysSince} days ago.`);
      console.log(`Use --force to clean now.`);
      return;
    }
  }

  log.info(`Cleanup starting (force=${force}, dryRun=${dryRun})`);
  const prefix = dryRun ? '[DRY RUN] ' : '';
  console.log(`${prefix}=== Perplexity Research Cleanup ===\n`);

  const registry = config.getTrackedDirs();
  let grandTotalFiles = 0;
  let grandTotalSize = 0;
  const staleDirs = [];

  for (const [dir] of Object.entries(registry.dirs)) {
    const playwrightDir = join(dir, '.playwright-cli');

    if (!existsSync(dir) || !existsSync(playwrightDir)) {
      log.info(`Stale dir: ${dir}`);
      console.log(`${prefix}${dir}: stale entry (directory gone)`);
      staleDirs.push(dir);
      continue;
    }

    console.log(`${prefix}Cleaning: ${playwrightDir}`);
    const result = cleanDirectory(playwrightDir, dryRun);
    log.info(`Cleaned ${playwrightDir}: ${result.fileCount} files, ${formatBytes(result.totalSize)}`);
    console.log(`  ${result.fileCount} files, ${formatBytes(result.totalSize)}`);
    grandTotalFiles += result.fileCount;
    grandTotalSize += result.totalSize;
  }

  // Remove stale entries
  if (!dryRun && staleDirs.length > 0) {
    for (const dir of staleDirs) {
      config.unregisterDir(dir);
    }
    log.info(`Removed ${staleDirs.length} stale registry entries`);
    console.log(`\nRemoved ${staleDirs.length} stale registry entries.`);
  }

  // Clean old log files
  const logResult = cleanOldLogs(dryRun);
  if (logResult.fileCount > 0) {
    log.info(`Logs cleaned: ${logResult.fileCount} files, ${formatBytes(logResult.totalSize)}`);
    console.log(`${prefix}Logs cleaned: ${logResult.fileCount} files, ${formatBytes(logResult.totalSize)}`);
    grandTotalFiles += logResult.fileCount;
    grandTotalSize += logResult.totalSize;
  }

  log.info(`Cleanup complete: ${grandTotalFiles} files, ${formatBytes(grandTotalSize)}`);
  console.log(`\n${prefix}Total cleaned: ${grandTotalFiles} files, ${formatBytes(grandTotalSize)}`);

  if (!dryRun) {
    config.setLastCleanup(new Date().toISOString());
  }
}

//endregion

//region CLI

function parseArgs(argv) {
  const args = { force: false, dryRun: false, status: false, help: false };
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f') args.force = true;
    if (arg === '--dry-run' || arg === '-n') args.dryRun = true;
    if (arg === '--status' || arg === '-s') args.status = true;
    if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function showUsage() {
  console.log(`
Perplexity Research - Cleanup Script

Usage: ppx-research cleanup [options]

Options:
  --status, -s     Show cleanup status and folder sizes
  --force, -f      Clean now regardless of schedule
  --dry-run, -n    Show what would be cleaned without deleting
  --help, -h       Show this help

Cleans .playwright-cli/ in all tracked project directories.
Registry: ${PATHS.trackedDirsFile}
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) { showUsage(); return; }
  if (args.status) { cmdStatus(); return; }

  cmdCleanup(args.force, args.dryRun);
}

main();

//endregion
