# Perplexity Research Plugin - Smoke Tests

Cross-platform smoke tests for the perplexity-research Claude Code plugin.

## Location

Tests are stored outside the plugin directory to avoid bundling with distribution:
```
~/.claude/plugin-tests/perplexity-research/   # Tests (NOT distributed)
~/.claude/plugins/perplexity-research/         # Plugin (distributed)
```

## Running Tests

### Local Testing

```bash
# Run all tests
node ~/.claude/plugin-tests/perplexity-research/smoke-test.js

# Verbose output
node ~/.claude/plugin-tests/perplexity-research/smoke-test.js --verbose

# CI mode (exit code reflects pass/fail)
node ~/.claude/plugin-tests/perplexity-research/smoke-test.js --ci
```

### CI/CD (GitHub Actions)

Copy `.github/workflows/smoke-test.yml` to your plugin repository.

Tests run on:
- **Platforms:** Ubuntu, macOS, Windows
- **Node versions:** 20, 22

## Test Coverage

**Total: 70 tests** (local with full setup) / ~60 tests (CI without playwright-cli)

### Structure Tests (6 tests)
- Plugin root exists
- scripts/lib directory exists
- All lib modules exist
- All scripts exist
- All hooks exist
- plugin.json exists

### Library Import Tests (9 tests)
- Main lib index imports
- All module exports verified (config, platform, playwright, sessionStatus, sessionCookie, sessionState, cli)
- Convenience re-exports

### config.js Tests (8 tests)
- PATHS keys and values
- DEFAULTS values
- getConfig, getBrowser, getCleanupDays return types
- Input validation for setBrowser and setCleanupDays

### platform.js Tests (5 tests)
- getPlatform returns valid value matching OS
- isWindows returns correct boolean
- getPlaywrightSessionDir handles missing directory
- minimizeWindows handles errors gracefully

### cli.js Tests (6 tests)
- parseArgs handles empty, positional, flag, and mixed arguments
- Dash conversion in flag names
- sleep returns Promise

### session-status.js Tests (9 tests)
- getSessionStatus returns valid structure
- isSessionExpired handles null, future, and past dates
- findValidDonorSession logic
- checkSessionPool structure
- Path getters return string or null

### session-state.js Tests (4 tests)
- State file path format
- hasSessionState returns boolean
- Save/get/clear roundtrip
- Throws for missing session

### playwright.js Tests (10 tests)
- CLI_TIMEOUT is reasonable
- checkPlaywrightCli returns valid structure
- isSessionRunning returns boolean
- runCli executes --version and session-list
- startSession opens real browser (session 9)
- isSessionRunning detects started session
- runCode executes JavaScript in session
- pressKey sends keystrokes to session
- stopSession closes browser
- verifySessionRunning throws for non-running session

**Note:** Browser tests are conditional - they run when playwright-cli is installed and session pool is configured. In CI environments without playwright-cli, these tests are skipped automatically.

### CLI Script Tests (6 tests)
- setup.js --help, check, preflight
- perplexity-research.mjs --help
- cleanup.js --help, --status

### Hook Script Tests (3 tests)
- validate-before-spawn.js with non-matching input
- inject-templates.js produces valid output
- extract-research-output.js handles empty transcript

### Cross-Platform Tests (3 tests)
- PATHS use path.join (no hardcoded separators)
- Session state file paths are valid
- Home directory resolution works

## Extending Tests

Add new tests in the appropriate category function:

```javascript
function testMyModule() {
  log('\n=== My Module ===');

  test('My test name', () => {
    // Test code here
    assert(condition, 'Error message');
    assertEqual(actual, expected, 'Values should match');
  });
}
```

Call from `main()`:
```javascript
testMyModule();
```
