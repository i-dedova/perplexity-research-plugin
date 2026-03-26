# Changelog

## [0.2.0] - 2026-03-26

### Added

- **Configurable output directory** — setup wizard asks where to save research outputs. Relative folder path stored in config (`output_dir`). Nested paths supported (e.g., `docs/research/perplexity`). Default: `docs/research`.
- MIT license
- macOS headed CI test — validates `--headed --persistent` browser launch on GitHub Actions macOS runners
- macOS permission guidance in setup wizard — warns about Accessibility and System Events prompts before browser steps
- "Why Browser Windows?" section in README — explains Cloudflare bot protection and why headed sessions are required
- This changelog

### Changed

- **Commands replaced by user-invocable skills** — `/perplexity-research` and `/perplexity-setup` are now skills with `user-invocable: true`, removing the need for separate command wrappers. Both Claude and users can invoke them.
- **Agent description restructured** — mode selection rules added inline: search is default for 90% of queries, deep only for comprehensive multi-faceted analysis (5-10 min). Mode chosen by question complexity, not user wording.
- **Skill-first instruction softened** — "ALWAYS use skill first" changed to "use skill when unclear", reducing unnecessary token usage when scope is already clear.

### Fixed

- **Search timeout with thinking/auto-routing** — search mode with `thinking: true` or `model: best` now uses extended timeout (5 min instead of 2 min). Agent instructions always set `timeout: 600000` on Bash calls regardless of mode.
- **Setup hint messages** — `setup.js` check/error messages now include `--persistent` flag (was missing, could cause headless session issues)

### Removed

- `commands/perplexity-research.md` — redundant wrapper for the skill
- `commands/perplexity-setup.md` — migrated to `skills/perplexity-setup/SKILL.md`
- npm link reference from setup wizard

## [0.1.9] - 2026-03-22

### Removed

- Redundant breadcrumb system from SubagentStop hook — simplified extract-research-output.js

## [0.1.8] - 2026-03-20

### Fixed

- 11 cross-platform fixes identified via comprehensive audit
- 11 new tests added (168 total), CI green on all 6 jobs (Ubuntu/macOS/Windows x Node 18/22)

## [0.1.7] - 2026-03-19

### Added

- GitHub Actions CI — Ubuntu, macOS, Windows with Node 18 and 22
- Browser integration tests via example.com

### Fixed

- 9 platform-specific fixes for cross-platform compatibility

## [0.1.6] - 2026-03-19

### Changed

- CLI alias installed via `install-alias.sh` wrapper (replaces `npm link` which broke on marketplace installs)
- All CLI calls use `execFileSync` — eliminates CMD window flash on Windows
- Setup wizard asks before re-login if sessions are healthy
- Preflight shows null for unconfigured values instead of defaults

### Fixed

- `marketplace.json` location corrected to `.claude-plugin/`

## [0.1.0] - 2026-03-18

### Added

- Production-ready release, published to marketplace
- Preflight session health detection with cookie expiry checks
- Master session promotion from valid pool session when master expired

### Fixed

- `clone-pool` skipping existing sessions (never overwrote stale pool)
- `minimizeWindows` matching VS Code window title
- Cookie regex rejecting float timestamps
- Cleanup never triggered (dead wiring)
- `startSession` broken for existing sessions

### Changed

- `validate-research-session.js` main function split (complexity 50 → 15)
- `parseArgs` consolidated (removed MJS duplicate, added arrayFields option)
- `extract-research-output.js` refactored (main split, configureSession extracted)
