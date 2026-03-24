# Valor AI Research Platform Plan

## Goal

Turn the current `deep-research-app` MVP into a real multi-agent research platform where:

- a **manager** assigns work
- multiple **researcher workers** run in parallel
- findings are merged into a shared case memory
- leads are deduplicated and re-queued
- Levi can supervise, redirect, approve, and publish

This should start with **3 concurrent researchers** and be designed to scale beyond that without rewriting the system.

The core point: **do not build this as one long-running script**. Build it as a small platform with clear services, state, and operator controls.

---

## What Exists Today

The current MVP already proves several critical pieces:

- one autonomous researcher can run a research wave
- Apify calls can be rate-limited safely
- xAI can analyze findings and generate new leads
- `OPEN_LOOPS.md` already behaves like a primitive task queue
- reports and active memory can be appended automatically

Current limitations:

- single-worker only
- queue state is file-based and fragile
- no assignment ownership or lock management
- no dedupe layer
- no manager intelligence layer
- no worker health tracking
- no structured artifact store
- git push assumes one process owns the workspace

So the MVP is a **worker prototype**, not yet a research operating system.

---

## Recommended Architecture

### 1. Manager Service

This is the control plane.

Responsibilities:

- pulls highest-priority leads from the queue
- assigns work to available researchers
- tracks job state: pending, assigned, running, blocked, review, complete
- merges and deduplicates new leads
- decides whether a lead needs:
  - another wave
  - escalation to a different researcher type
  - human review
  - archival
- enforces global budgets and rate limits
- decides when to commit results to the canonical repo

The manager should not do deep research itself by default. It should coordinate and validate.

### 2. Researcher Workers

Each worker is an execution unit that performs waves on assigned targets.

Responsibilities:

- run search barrage
- run deep dive
- produce structured findings
- emit new leads
- attach evidence and source metadata
- report confidence grades
- return artifacts to the manager

Workers should be stateless between assignments except for local caches.
Shared truth should live in the platform database and artifact store.

### 3. Shared Queue and State Store

Replace `OPEN_LOOPS.md` as the live queue with a real data layer.

Use:

- **Postgres** for canonical state
- **Redis** for queueing, locks, and fast worker coordination

Store:

- leads
- assignments
- wave runs
- findings
- sources
- entities
- relationships
- worker status
- human review actions

`OPEN_LOOPS.md` can still exist as an export or narrative view, but it should no longer be the source of truth.

### 4. Artifact Store

Every run should persist raw artifacts separately from summaries.

Examples:

- raw search results
- extracted PDFs
- screenshots
- parsed page text
- structured JSON outputs
- generated reports

Recommended starting point:

- local filesystem directories by case and wave

Scale path:

- S3-compatible object storage later if needed

### 5. Human Review Layer

Levi needs a way to approve, reject, merge, and redirect work.

The platform should support:

- queue dashboard
- active workers dashboard
- finding review screen
- entity/network graph inspection
- “promote to canonical report” action
- “send back for another wave” action
- “escalate to legal/financial/politics specialist” action

This is what turns the system from autonomous scripts into a newsroom-grade research platform.

---

## Recommended Agent Roles

Start with 4 role types, even if only 3 worker instances run at first.

### 1. Manager

- assigns jobs
- evaluates outputs
- deduplicates
- plans next work

### 2. General Researcher

- broad OSINT
- governance/network tracing
- public-records discovery

### 3. Document Researcher

- PDF extraction
- OCR
- minutes, audits, filings, board packets

### 4. Entity Mapper

- people/org resolution
- title timelines
- relationship graph building
- duplicate detection

At launch, 3 workers can all run the same codebase with different prompts/config profiles.
Later, those become specialized worker classes.

---

## Start With 3 Workers

Recommended first operating model:

- **1 manager**
- **3 concurrent researchers**

Example split:

- Worker 1: live web + OSINT research
- Worker 2: documents + PDFs + minutes
- Worker 3: entity mapping + cross-reference + contradiction check

This gives you parallelism without immediate chaos.

Do not start at 10 workers.
You need assignment discipline, dedupe, and artifact review before scale becomes useful.

---

## Model Strategy For The 3090 Buildout

Your incoming 3090s change the architecture.

Use a **hybrid model router**:

- **Local GPUs** for:
  - summarization
  - classification
  - entity extraction
  - dedupe scoring
  - contradiction detection
  - report drafting
- **Cloud reasoning models** for:
  - hard planning
  - synthesis across many artifacts
  - ambiguous investigative reasoning
  - legal/structural interpretation when high precision matters

Why:

- local GPUs reduce per-wave cost and latency
- cloud models remain useful for top-tier judgment
- the manager can choose which model tier to use based on task type

This is the right moment to start designing **Valor AI** as a routed system, not a single-model app.

---

## Platform Components To Build

### Phase 1: Stabilize the Worker Core

Turn the current MVP into a reusable worker service.

Build:

- structured run result format
- structured lead format
- structured source format
- worker heartbeat
- assignment lock handling
- error classification: retryable vs terminal

Output contract from every worker should include:

- assignment id
- target
- findings
- confidence grades
- new leads
- source list
- artifact paths
- recommended next action

### Phase 2: Build the Manager

New component:

- `manager` service or app

Responsibilities:

- pull next leads
- assign work by priority and worker capability
- prevent duplicate work
- requeue failures intelligently
- merge findings
- approve promotion into case memory

The manager should own:

- queue policy
- assignment policy
- merge policy
- commit policy

### Phase 3: Replace File Queue With Real Queue

Move from markdown-driven queueing to DB-backed queueing.

Recommended data entities:

- `lead`
- `assignment`
- `wave_run`
- `finding`
- `source`
- `entity`
- `relationship`
- `artifact`
- `review_decision`
- `worker`

### Phase 4: Build the Operator Interface

A small internal UI matters more than extra automation at this stage.

The first UI should show:

- pending leads
- assigned leads
- worker health
- blocked jobs
- findings awaiting review
- promoted findings
- relationship graph candidates

### Phase 5: Canonical Report Pipeline

Do not let every worker write directly to the main report.

Instead:

- workers write structured outputs
- manager or review layer decides what becomes canonical
- one controlled publisher writes:
  - master report
  - active work
  - open loops
  - git commit

This prevents multi-worker file corruption.

---

## Repo / Codebase Direction

The current code should evolve from a CLI app into a small service-based TypeScript platform.

Suggested structure:

```text
deep-research-app/
  apps/
    manager/
    worker/
    api/
    operator-ui/
  packages/
    core/
    queue/
    models/
    tools/
    storage/
    reporting/
    git-publisher/
  infra/
    docker/
    postgres/
    redis/
```

This keeps the current TypeScript investment while giving you room to scale.

---

## Key Design Rules

### 1. One Writer To Canonical Files

Only one component should write to:

- master report
- active work
- open loops
- git-tracked evidence summaries

That component should be the manager or a dedicated publisher.

### 2. Workers Return Structured Data

Do not make the manager parse long markdown blobs as its primary data source.

Workers should return JSON-like structured outputs first.
Markdown reports can be generated from structured outputs later.

### 3. Queue Ownership Must Be Explicit

Every assignment needs:

- assigned worker id
- lock timestamp
- lease expiry
- retry count
- status

Without that, 3 workers become duplicate chaos.

### 4. Dedupe Must Be First-Class

This platform will generate many overlapping leads.

Add lead fingerprinting early:

- normalized names
- org aliases
- URL hashing
- title/date matching
- semantic similarity scoring

### 5. Separate Raw Evidence From Narrative

Never confuse:

- raw artifact
- extracted text
- structured fact
- hypothesis
- published finding

These should be stored distinctly.

---

## Best First Version

Do not build the full dream in one jump.

The best V1 is:

- manager service
- 3 worker processes
- Postgres
- Redis
- structured outputs
- one publisher
- simple operator UI

That gets you a real platform without overbuilding.

---

## What Not To Do

- do not let all workers write directly to `OPEN_LOOPS.md`
- do not let each worker commit/push independently
- do not keep markdown as the live queue
- do not treat the manager as just another worker
- do not scale worker count before you have dedupe and assignment locks
- do not tie the platform to one model vendor

---

## Immediate Build Recommendation

If building starts now, the next concrete milestone should be:

### Milestone A: Multi-Agent Platform Skeleton

Deliver:

- manager process
- 3 worker process support
- DB-backed lead queue
- structured worker result schema
- manager assignment logic
- single publisher for canonical files

Success condition:

- 3 workers can research different leads in parallel
- no duplicate assignment occurs
- results merge into one reviewed output stream
- only one controlled component writes canonical files

---

## Longer-Term Vision

What you are describing is bigger than a research script.

You are building:

- a **case memory system**
- a **research orchestration layer**
- a **human-in-the-loop investigation platform**
- eventually a **model-routed Valor AI newsroom engine**

That is feasible.

The MVP you already have is a valid seed.
It just needs to be upgraded from **single autonomous worker** to **managed research platform**.

---

## My Recommendation In One Sentence

Yes, build more researchers, but do it as a **manager-led platform with shared state, structured outputs, one canonical publisher, and local-GPU/cloud model routing**, starting with 3 workers and designing for scale from day one.
