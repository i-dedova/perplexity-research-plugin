# Model Selection Reference

Decision guide for choosing Perplexity model when config is `default_model: dynamic`.

**Key principle:** When in doubt, always pick `best` — Perplexity auto-routes to the optimal model for the query.

## Available Models

| Slug | Display Name | Thinking | Tier | Best For |
|------|-------------|----------|------|----------|
| `best` | Best | N/A | free | Default auto-routing. Use when topic spans multiple domains or unsure which model fits. |
| `sonar` | Sonar | No | pro | Wide surveys (20+ sources), fact-checking, consensus-finding. Tuned for retrieval and ranking. Top of Perplexity Search Arena. |
| `gpt-5.4` | GPT-5.4 | Toggleable | pro | Code/API research, implementing patterns from documentation, schema design from web specs, rigorous multi-step logic. |
| `gemini-3.1-pro` | Gemini 3.1 Pro | Always on | pro | Long document deep-dives (whitepapers, specs, legal), math-heavy reasoning, multimodal research (text + figures). 1M token context. |
| `claude-sonnet-4.6` | Claude Sonnet 4.6 | Toggleable | pro | Complex multi-source synthesis, policy/legal/ethics analysis, nuanced long-form drafting, agentic browsing. |
| `nemotron-3-super` | Nemotron 3 Super | Always on | pro | Agentic workflows, long-context analysis (1M tokens), RAG pipelines. LatentMoE architecture, ~450 tok/s throughput. |
| `claude-opus-4.6` | Claude Opus 4.6 | No | max | (Requires Max tier) |

## Research Patterns

Common workflows and which models fit each phase:

| Pattern | Scout (find sources) | Analyze (reason over them) |
|---------|---------------------|---------------------------|
| **Landscape mapping** — vendors, market, competitors, 40+ sources | `sonar` — retrieval breadth, citation-rich | `gemini-3.1-pro` or `claude-sonnet-4.6` — long-form synthesis |
| **Technical spec evaluation** — papers, whitepapers, architecture docs | `sonar` — find and skim | `gpt-5.4` — code patterns, trade-off reasoning |
| **Policy/legal/ethics** — regulations, compliance, board-ready briefs | `sonar` — statute and guidance retrieval | `claude-sonnet-4.6` — cautious, nuanced analysis |
| **Code and API research** — repos, implementations, design patterns | `sonar` — discover repos and documentation | `gpt-5.4` or `claude-sonnet-4.6` — code reading, pattern synthesis |
| **Agentic / long-context** — large codebases, RAG over many docs | `sonar` — initial discovery | `nemotron-3-super` — 1M context, high throughput reasoning |

## Thinking Guidance

- **Off by default** for most queries
- **On** for: complex analysis, trade-off evaluation, multi-step reasoning, comparing approaches
- Models with "Always on" thinking (`gemini-3.1-pro`, `nemotron-3-super`) handle this automatically

## Deep Mode Guidance

Deep mode triggers Perplexity's autonomous multi-step pipeline. It accepts a **single prompt only** — no follow-ups or synthesize. Craft the question to cover all aspects upfront. Use search mode for iterative exploration with follow-ups.
