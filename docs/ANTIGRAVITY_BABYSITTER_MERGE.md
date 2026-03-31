# Antigravity Babysitter Merge Plan

*Response to MISTRAL_BABYSITTER_PLAN.md*

Your diagnosis of the runtime failure is 100% correct. Because the `researcher` tools currently run synchronously inline inside the queue processing loop, an external Apify container taking 3 minutes to spin up strictly blocks the Node event loop and prevents graceful resumption if the user hits `SIGINT`.

We must decouple the "Thinking" from the "Doing" entirely. Your Babysitter concept perfectly maps to the architecture we established today. Here is exactly how we align your Mistral-triage concept with the C++ Node compiler constraints we currently face on your machine:

## 1. The Persistence Engine (The "JSON-SQLite" Bridge)
The Mistral babysitter relies entirely on a persistent state machine to know if a job was interrupted or if it succeeded. Because your D: drive compiler cannot currently install the native C++ `better-sqlite3` driver, we cannot use a raw SQLite table.
**The Fix:** I will upgrade the "volatile" `src/storage/sqlite.ts` mock I built today. Instead of losing all data on `SIGINT`, it will aggressively `fs.writeFileSync` its internal structures to a local `valor-state-db.json` file after every single mutation. 
Both the workers and the `jobsd` daemon will read/write from this unified JSON source of truth, natively achieving the exact persistency of SQLite without compiling a single line of C++.

## 2. Decoupling the CLI Roles
Currently, `node dist/start.js` boots everything (UI, Workers, Queues, Manager). Let's shatter it into dedicated binaries:

### A) The Muscle (`node dist/start.js --worker-pool`)
- Completely dumb. No LLM thinking allowed.
- Simply connects to BullMQ, pulls jobs, executes the exact Tool/Actor requested, dumps the raw `ToolExecutionResult` back into the `valor-state-db.json`, and completes the job.
- Does not care if it hit 0 results or 1,000 results. It just executes what it is told.

### B) The Brain (`node dist/start.js --jobsd`)
- The Mistral Babysitter. It does not execute web scrapes.
- It sits in an infinite `while(true)` loop (sleeping for 5 seconds). 
- It scans `valor-state-db.json` for recently completed `WorkerResult` footprints or stale `running` jobs.
- **The Triage:** It passes the payload to the local Mistral LLM asking: *"Look at this Apify output. It returned 0 results. What is the retry action?"*
- It intercepts Mistral's deterministic JSON response (e.g. `switch_tool`, `rewrite_query`, `mark_stalled`) and natively pushes the *new* resulting job directly back into the BullMQ Redis queue.

## 3. The Execution Flow for 950 Leads
If we adopt this unified architecture, your 950 leads from `WAVE_156.md` stop being a scary terminal matrix and become a beautifully orchestrated symphony:

1. **Terminal 1**: You run `node dist/start.js --ingest ...`. It dumps all 950 leads into `valor-state-db.json` and immediately exits peacefully.
2. **Terminal 2**: You run `node dist/start.js --worker-pool`. It connects to Redis and waits silently.
3. **Terminal 3**: You run `node dist/start.js --jobsd`. It wakes up, sees 950 pending leads, bundles them into Apify/Firecrawl execution tickets, and pushes them to Redis.
4. **The Loop Continues**: The worker pool pulls the tickets, runs them, and updates the JSON file. The `jobsd` loop sees the completions, analyzes them with Mistral, and orchestrates the next phase completely unsupervised.

## Ready to Execute
This architectural split will take roughly 3 robust coding passes to implement:
1. Upgrading Storage to JSON FS Sync.
2. Building `jobsd.ts` (The Mistral loop).
3. Stripping `researcher.ts` down to a deterministic executor.

If you approve this merge plan, we move out of Phase 2 and into Phase 4: The Daemon Architecture.
