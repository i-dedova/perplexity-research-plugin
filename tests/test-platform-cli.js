/**
 * test-platform-cli.js - Platform detection, CLI args, cross-platform paths
 *
 * Tests: platformModule + cliModule + crossPlatformPaths
 */

const { existsSync } = require('fs');
const { platform, homedir } = require('os');
const {
  log, test,
  assert, assertEqual, assertType,
  lib
} = require('./test-utils');

function run() {
  const { platform: platformMod, cli, sessionState, PATHS } = lib();

  // === platform.js Module ===
  log('\n=== platform.js Module ===');

  test('getPlatform returns valid value', () => {
    const p = platformMod.getPlatform();
    assert(['windows', 'macos', 'linux'].includes(p), `Platform should be one of: windows, macos, linux. Got: ${p}`);
  });

  test('getPlatform matches OS', () => {
    const p = platformMod.getPlatform();
    const os = platform();
    if (os === 'win32') assertEqual(p, 'windows', 'Should be windows on win32');
    if (os === 'darwin') assertEqual(p, 'macos', 'Should be macos on darwin');
    if (os === 'linux') assertEqual(p, 'linux', 'Should be linux on linux');
  });

  test('isWindows returns boolean', () => {
    const result = platformMod.isWindows();
    assertType(result, 'boolean', 'isWindows');
    assertEqual(result, platform() === 'win32', 'isWindows should match platform');
  });

  test('getPlaywrightSessionDir returns string or null', () => {
    const dir = platformMod.getPlaywrightSessionDir();
    assert(dir === null || typeof dir === 'string', 'Should return string or null');
  });

  test('minimizeWindows does not throw', () => {
    platformMod.minimizeWindows('NonExistentWindow12345');
    // If we get here, it didn't throw
  });

  // === cli.js Module ===
  log('\n=== cli.js Module ===');

  test('parseArgs handles empty args', () => {
    const result = cli.parseArgs([]);
    assertEqual(result.command, undefined, 'Command should be undefined');
    assertEqual(result.value, undefined, 'Value should be undefined');
    assert(typeof result.args === 'object', 'Args should be object');
  });

  test('parseArgs handles positional args', () => {
    const result = cli.parseArgs(['check', 'value']);
    assertEqual(result.command, 'check', 'Command');
    assertEqual(result.value, 'value', 'Value');
  });

  test('parseArgs handles flags', () => {
    const result = cli.parseArgs(['--verbose', '--count', '5', 'command']);
    assertEqual(result.args.verbose, true, 'Verbose flag');
    assertEqual(result.args.count, '5', 'Count value');
    assertEqual(result.command, 'command', 'Command');
  });

  test('parseArgs handles mixed args', () => {
    const result = cli.parseArgs(['start', '--session', '0', '--mode', 'deep', 'extra']);
    assertEqual(result.command, 'start', 'Command');
    assertEqual(result.args.session, '0', 'Session');
    assertEqual(result.args.mode, 'deep', 'Mode');
    assertEqual(result.value, 'extra', 'Extra positional');
  });

  test('parseArgs converts dashes in flag names', () => {
    const result = cli.parseArgs(['--topic-slug', 'test']);
    assertEqual(result.args.topicslug, 'test', 'Topic slug (dashes removed)');
  });

  test('sleep is a function returning Promise', async () => {
    const result = cli.sleep(1);
    assert(result instanceof Promise, 'sleep should return Promise');
    await result;
  });

  // === parseArgs arrayFields ===
  log('\n=== parseArgs arrayFields ===');

  test('parseArgs splits arrayFields by comma', () => {
    const result = cli.parseArgs(['start', '--sources', 'web,academic,social'], { arrayFields: ['sources'] });
    assert(Array.isArray(result.args.sources), 'sources should be array');
    assertEqual(result.args.sources.length, 3, 'Should have 3 sources');
    assertEqual(result.args.sources[0], 'web', 'First source');
    assertEqual(result.args.sources[2], 'social', 'Third source');
  });

  test('parseArgs arrayFields trims whitespace', () => {
    const result = cli.parseArgs(['--sources', ' web , academic '], { arrayFields: ['sources'] });
    assertEqual(result.args.sources[0], 'web', 'Should trim first');
    assertEqual(result.args.sources[1], 'academic', 'Should trim second');
  });

  test('parseArgs arrayFields no-op when field missing', () => {
    const result = cli.parseArgs(['start'], { arrayFields: ['sources'] });
    assertEqual(result.args.sources, undefined, 'Missing field should stay undefined');
  });

  test('parseArgs arrayFields no-op for boolean flags', () => {
    const result = cli.parseArgs(['--sources'], { arrayFields: ['sources'] });
    assertEqual(result.args.sources, true, 'Boolean flag should stay true');
  });

  test('parseArgs without options preserves original behavior', () => {
    const result = cli.parseArgs(['--sources', 'web,academic']);
    assertEqual(result.args.sources, 'web,academic', 'Should remain string without options');
  });

  // === Cross-Platform Paths ===
  log('\n=== Cross-Platform Paths ===');

  test('PATHS use path.join (no hardcoded separators)', () => {
    const sep = platform() === 'win32' ? '\\' : '/';
    for (const [key, value] of Object.entries(PATHS)) {
      assert(value.includes(sep), `PATHS.${key} should use ${sep} on this platform`);
    }
  });

  test('Session state file path is valid', () => {
    const path = sessionState.getSessionStateFile(0);
    const hasForwardSlash = path.includes('/');
    const hasBackSlash = path.includes('\\');

    if (platform() === 'win32') {
      assert(hasBackSlash || hasForwardSlash, 'Path should have separators');
    } else {
      assert(hasForwardSlash, 'Path should have forward slashes');
      assert(!hasBackSlash, 'Path should not have backslashes on Unix');
    }
  });

  test('Home directory resolution works', () => {
    const home = homedir();
    assert(home, 'homedir() should return value');
    assert(existsSync(home), 'Home directory should exist');
  });
}

module.exports = { run };
