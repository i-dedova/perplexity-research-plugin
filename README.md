# Perplexity Research Plugin

Automate deep research via Perplexity using Playwright CLI browser automation. The plugin manages a pool of persistent, logged-in browser sessions so research agents can query Perplexity without manual intervention. You log in once; the plugin clones that authenticated state across up to 10 sessions, tracks cookie expiry, and auto-refreshes stale sessions from valid ones.

## Installation

| Platform | Plugin Directory |
|----------|------------------|
| Windows | `%USERPROFILE%\.claude\plugins\perplexity-research\` |
| macOS/Linux | `~/.claude/plugins/perplexity-research/` |

All paths below use `.claude/` relative to your home directory.

### Requirements

- **Node.js** 18 or newer
- **playwright-cli** >= 0.1.0 (`@playwright/cli` on npm). Versions below 0.1.0 are **not supported** — the session management API changed in 0.1.x.

## How It Works

1. **Persistent sessions** — During setup, you log into Perplexity in a browser window managed by Playwright CLI. That authenticated browser state (cookies, storage) is saved as the "master session" (`perplexity-pro`).

2. **Session pool** — The master session is cloned into 10 numbered sessions (0-9). Each session is an independent browser context with its own copy of the login state, enabling parallel research.

3. **Auto-maintenance** — On every research request, a validation hook checks the target session's cookie. If expired, the plugin finds a valid donor session and refreshes from it. Session status is tracked in `.claude/perplexity/session-status.json` and updated automatically on each use.

4. **Directory tracking** — The plugin records which project directories it runs in (`.claude/perplexity/tracked-dirs.json`). Each project gets its own `.playwright-cli/` folder for downloads and session state.

5. **Auto-cleanup** — On every research request, the validation hook checks if cleanup is due (based on `cleanup_days` config). If overdue, it spawns the cleanup script in the background — no delay to the research flow. Cleanup removes `.playwright-cli/` temp files across all tracked directories and old log files.

## Setup & Troubleshooting

### First Run

```
/perplexity-setup
```

Interactive wizard (skips steps already complete):
1. Install playwright-cli if needed
2. Register `ppx-research` CLI alias
3. Select browser (MS Edge or Chrome)
4. Choose model selection strategy (dynamic, auto, or fixed model)
5. Configure cleanup interval
6. Create master session (login to Perplexity)
7. Clone session pool (0-9) with validation
8. Add research instructions to `.claude/CLAUDE.md`

> **First setup takes 3-5 minutes.** Step 7 opens each session in a browser, navigates to Perplexity, and validates the login cookie individually. Browser windows will appear and disappear — that's normal. Subsequent runs skip completed steps and finish in seconds.

**You don't have to run this manually.** If setup is incomplete when you try to research, the validation hook detects what's missing and prompts Claude to run `/perplexity-setup` for you.

### Re-running Setup

`/perplexity-setup` is not just for first-time setup — it's a healing command. Run it any time to:
- **Expired sessions** — Guides you through re-login, then re-clones the pool
- **Missing config** — Recreates `.claude/perplexity/config.local.md` with your settings
- **Broken state** — Re-validates all sessions, fixes what it can

The wizard is smart: it runs a preflight check, identifies what's broken or missing, and only asks about those steps. Settings already in place are preserved.

### Common Issues

| Issue | Solution |
|-------|----------|
| playwright-cli not found | `npm install -g @playwright/cli@latest` |
| Session not running | `ppx-research init-pool --count 1` |
| Not logged in / sessions expired | Run `/perplexity-setup` — it detects this and guides re-login |
| Debugging issues | Check logs in `.claude/perplexity/logs/` |

## Usage

| Path | Trigger | What happens |
|------|---------|--------------|
| **Skill** (automatic) | Claude recognizes research need from keywords | Interactive scope discussion → agent(s) |
| **Command** | User runs `/perplexity-research [topic]` | Same skill flow — scope discussion → agent(s) |
| **Direct spawn** | Claude determines scope is already clear | Spawns `research-agent` immediately |

Up to 10 concurrent agents (sessions 0-9) for parallel research on independent topics.

> **Recommended:** Add this to your global `.claude/CLAUDE.md` to improve discoverability:
>
> *For research, investigation, comparisons, fact-checking, or when current information matters — use the `perplexity-research` skill to discuss scope with the user, or spawn `research-agent` directly when scope is clear. Perplexity defaults to the most recent sources. Parallel agents for independent topics.*
>
> The `/perplexity-setup` wizard offers to inject this automatically.

## File Locations

The plugin creates a `.claude/perplexity/` directory for all persistent state:

| File | Location | Purpose |
|------|----------|---------|
| Config | `.claude/perplexity/config.local.md` | Browser, cleanup, log, model settings (editable, has instructions inside) |
| Session status | `.claude/perplexity/session-status.json` | Cookie expiry and login state per session (auto-updated) |
| Tracked dirs | `.claude/perplexity/tracked-dirs.json` | Registry of project directories using the plugin |
| Logs | `.claude/perplexity/logs/` | Hook, research, and cleanup logs (auto-cleaned) |
| Research output | `.playwright-cli/` (in project CWD) | Downloads, session state, temp files |
| Final output | `{project}/docs/research/` | Processed research documents |

## Configuration

`.claude/perplexity/config.local.md` is a markdown file with YAML frontmatter. It contains inline instructions explaining each setting:

```yaml
---
browser: msedge            # msedge or chrome
cleanup_days: 7            # 1-30 days
log_retention_days: 7      # 1-30 days
default_model: dynamic     # dynamic, best, or model slug
default_thinking: dynamic  # dynamic, true, false
subscription_tier: pro     # pro or max
---
```

### Models

| Slug | Display Name | Thinking | Tier |
|------|-------------|----------|------|
| `best` | Best | N/A | free |
| `sonar` | Sonar | No | pro |
| `gpt-5.4` | GPT-5.4 | Toggleable | pro |
| `gemini-3.1-pro` | Gemini 3.1 Pro | Always on | pro |
| `claude-sonnet-4.6` | Claude Sonnet 4.6 | Toggleable | pro |
| `nemotron-3-super` | Nemotron 3 Super | Always on | pro |
| `claude-opus-4.6` | Claude Opus 4.6 | No | max |

- `dynamic` — Claude picks per research topic using a decision matrix
- `best` — Perplexity auto-routes to optimal model

If the config file is deleted, run `/perplexity-setup` to recreate it with your previous settings (or defaults).

### Deep Research

Deep mode triggers Perplexity's multi-step research pipeline — it runs autonomously, exploring sources and building a comprehensive answer. Use it thoughtfully: deep mode accepts a **single prompt only** (no follow-ups, no synthesize). Plan your question carefully to include all aspects you need covered. Workflow: start → download → close.

For iterative research with follow-ups, use **search mode** instead.

## Architecture

```
bin/
└── ppx-research.js              # Unified CLI entry point (npm link)

scripts/
├── lib/                         # Shared modules
│   ├── index.js                 # Barrel exports (require('./lib'))
│   ├── config.js                # Config paths, reading, writing
│   ├── platform.js              # Platform detection, window minimize
│   ├── playwright.js            # CLI wrapper, session management
│   ├── session-status.js        # Session tracking JSON
│   ├── session-cookie.js        # Cookie validation, refresh
│   ├── session-state.js         # Runtime research state
│   ├── file-lock.js             # Concurrent file locking, atomic writes
│   ├── cli.js                   # Argument parsing utilities
│   └── logger.js                # File-based logging
├── setup.js                     # Setup CLI (check, preflight, clone-pool, etc.)
├── perplexity-research.mjs      # Research CLI (start, followup, download, etc.)
└── cleanup.js                   # Temp file cleanup

hooks/
├── hooks.json                   # Hook event configuration
├── check-research-agent.js      # PreToolUse: gate — checks if research-agent
├── validate-research-session.js # Utility: full session validation + browser start
├── inject-templates.js          # SubagentStart: injects config into agent
└── extract-research-output.js   # SubagentStop: extracts output path

agents/
└── research-agent.md            # Autonomous research execution agent

skills/
└── perplexity-research/
    ├── SKILL.md                 # Scope discussion skill
    └── references/
        └── model-selection.md   # Model decision guide

commands/
├── perplexity-research.md       # /perplexity-research command
└── perplexity-setup.md          # /perplexity-setup wizard
```

## Components

| Component | Purpose |
|-----------|---------|
| **Skill**: `perplexity-research` | Scope discussion → agent handoff → output |
| **Command**: `/perplexity-research` | User-invocable entry point |
| **Command**: `/perplexity-setup` | Interactive setup and healing wizard |
| **Agent**: `research-agent` | Autonomous research execution |

## CLI Commands

All commands use the unified `ppx-research` alias (installed via `npm link` during setup):

### Research

```
ppx-research <command> [options]
```

| Command | Description |
|---------|-------------|
| `start` | Begin research thread (returns text). Flags: `--model`, `--thinking` |
| `followup` | Continue thread (search mode only — blocked in deep) |
| `synthesize` | Synthesize thread and download (search mode only) |
| `download` | Download current response |
| `close --session N` | Close single session |
| `ensure-session` | Verify session running + logged in (start if needed) |
| `init-pool --count N` | Start N browser sessions |
| `close-pool --count N` | Close N sessions |

### Setup

```
ppx-research setup <command>
```

| Command | Description |
|---------|-------------|
| `check` | Show setup status |
| `preflight` | JSON status for automation |
| `set-browser <name>` | Set browser (msedge/chrome) |
| `set-cleanup <days>` | Set cleanup interval |
| `set-model <value>` | Set default model (dynamic/best/slug) |
| `set-thinking <value>` | Set default thinking (dynamic/true/false) |
| `set-tier <value>` | Set subscription tier (pro/max) |
| `clone-pool` | Clone master to sessions 0-9 |
| `check-session <N>` | Validate session cookie |
| `scan-sessions` | Scan all sessions |
| `refresh-session <N>` | Refresh from valid donor |
| `ensure-valid <N>` | Ensure valid (used by hooks) |

### Cleanup

```
ppx-research cleanup [options]
```

| Option | Description |
|--------|-------------|
| `--status` | Show cleanup status |
| `--force` | Clean now |
| `--dry-run` | Preview cleanup |

## Research Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **search** | Standard research with follow-ups and synthesis | Most queries — focused questions, comparisons, practical advice |
| **deep** | Perplexity's autonomous multi-step pipeline | Complex topics needing comprehensive, multi-source analysis. Single prompt — plan carefully |

**Search mode** is for iterative research: focused questions, comparisons, follow-ups, and synthesis across multiple turns. **Deep mode** is for comprehensive one-shot analysis — craft a detailed prompt that covers all aspects upfront, as there are no follow-ups.

## Manual Setup

Skip if you used `/perplexity-setup`.

### 1. Install dependencies

```bash
npm install -g @playwright/cli@latest
npm link --prefix ~/.claude/plugins/perplexity-research
```

### 2. Create Master Session

```bash
PLAYWRIGHT_CLI_SESSION=perplexity-pro playwright-cli open https://perplexity.ai --persistent --headed --browser msedge
# Log in manually, then:
PLAYWRIGHT_CLI_SESSION=perplexity-pro playwright-cli close
```

### 3. Clone Session Pool

```bash
ppx-research setup clone-pool
```

### 4. Verify

```bash
ppx-research setup check
```
