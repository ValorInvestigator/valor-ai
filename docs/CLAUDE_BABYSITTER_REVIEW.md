# Claude Code Review: Antigravity Babysitter Merge Plan

*Review of ANTIGRAVITY_BABYSITTER_MERGE.md*

## Verdict: APPROVED with modifications

Antigravity's diagnosis is correct and the 3-terminal architecture is the right call. Here's my review and the implementation plan from my side.

## What Antigravity Got Right

1. **Decoupling Thinking from Doing.** The current monolithic start.js tries to boot workers, LLM, queues, and ingestion in one process. When an Apify actor takes 3 minutes, everything blocks. Splitting into `--worker-pool` (dumb executor) and `--jobsd` (smart daemon) is correct.

2. **Mistral as the triage layer.** Fast, local, 4.4GB. Perfect for "did this query return garbage? rewrite it." Qwen3 32B is overkill for triage decisions. Mistral 7B can make pass/fail/retry calls in under a second.

3. **JSON-FS bridge for persistence.** Pragmatic workaround for the better-sqlite3 native build issue. The mock storage already exists -- upgrading it to sync to disk is a small change.

4. **The 3-terminal flow.** Ingest -> Worker Pool -> Jobsd Daemon. Clean separation of concerns. Each can crash independently without taking down the others.

## What I Would Modify

### 1. Query Cleaning BEFORE the daemon
The bug we just hit: raw lead notes like `"Davidson timeline + GOBHI HQ practice (541-296-5452)."` were sent verbatim to Google Search. I already patched `cleanQuery()` into the Apify and Brave adapters in this build. The daemon should NOT need to fix garbage queries -- the tool adapters should clean them at the point of execution. This is already done.

### 2. Mistral triage prompt must be deterministic
The jobsd loop should send Mistral a structured prompt with exactly 4 possible actions:
```json
{
  "action": "accept" | "retry_rewrite" | "switch_tool" | "mark_stalled",
  "rewritten_query": "...",    // only if retry_rewrite
  "next_tool": "...",          // only if switch_tool
  "reason": "..."              // always
}
```
No free-form reasoning. JSON mode only. Temperature 0.

### 3. Supervisor validation stays on Qwen3
Antigravity's types.ts update already added `ValidationReport` and `HallucinationFlag` types. The hallucination detector (checking if findings are grounded in raw tool output) needs Qwen3's reasoning capability, not Mistral. So the model split is:
- **Mistral 7B**: Triage daemon (fast pass/fail on tool output quality)
- **Qwen3 32B**: Supervisor validation (deep hallucination checking on findings)

### 4. Don't strip LLM from researcher.ts entirely
Antigravity says "No LLM thinking allowed" in the worker pool. I disagree partially. The worker should still use the LLM to analyze raw tool output into structured findings (that's the whole point). What it should NOT do is decide whether to retry or switch tools -- that's the daemon's job. So:
- Worker: Execute tools -> LLM analysis -> structured WorkerResult. Done.
- Daemon: Inspect WorkerResult quality -> decide retry/accept/stall.

## My Implementation Assignments

Based on file ownership from the coordination protocol:

| Task | Owner | File |
|------|-------|------|
| Query cleaning in all tool adapters | Claude (DONE) | src/tools/*.ts |
| Mistral triage prompt + JSON schema | Claude | src/llm/prompts.ts |
| Supervisor validation logic | Claude | src/agents/supervisor.ts (new) |
| Upgrade LLM client for dual-model routing | Claude | src/llm/client.ts |
| jobsd.ts daemon loop | Antigravity/Codex | src/jobsd.ts (new) |
| JSON-FS storage bridge | Antigravity | src/storage/json-fs.ts (new) |
| CLI flag splitting (--worker-pool, --jobsd) | Codex | src/start.ts |

## Immediate Next Steps

1. I build `src/agents/supervisor.ts` and the Mistral triage prompt
2. I upgrade `src/llm/client.ts` to route by model (Mistral for triage, Qwen3 for analysis)
3. Antigravity builds the JSON-FS storage and jobsd loop
4. Codex wires the CLI flags and queue routing
5. We test with 6 leads, then 950
