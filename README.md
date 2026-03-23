# Valor AI

Multi-agent OSINT research platform built by [Valor Investigations](https://valor-investigations.com).

A Manager agent receives investigation targets, decomposes them into sub-tasks, dispatches them to a pool of Researcher workers, collects findings, deduplicates intelligence, and builds consolidated reports.

## Architecture

- **Manager Agent** -- task decomposition, assignment, synthesis
- **Researcher Workers** (3+) -- autonomous research agents with tool access
- **LLM Layer** -- vLLM on RTX 3090s (local, free inference) with xAI/Claude fallback
- **Job Queue** -- Redis + BullMQ for atomic task distribution
- **Storage** -- SQLite + sqlite-vec for structured findings with vector dedup
- **Tools** -- Apify (132+ actors), Firecrawl, CourtListener, Brave Search, BigQuery, OSINT tools
- **Dashboard** -- React command center with real-time worker status

## Status

Phase 1 -- Foundation (in progress)

## Setup

```bash
npm install
cp .env.example .env
# Add your API keys to .env
```

## Docs

- [Consolidated Master Plan](docs/MASTER_PLAN.md)
- [Architecture Plan (Claude)](docs/ARCHITECTURE_PLAN_CLAUDE.md)
- [Architecture Plan (Antigravity)](docs/ARCHITECTURE_PLAN_ANTIGRAVITY.md)

## License

Private -- Valor Investigations
