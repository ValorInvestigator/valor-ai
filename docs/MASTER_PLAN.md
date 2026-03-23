# Valor AI: The Consolidated Master Architecture
*Synthesized from Antigravity & Claude Code Input | March 23, 2026*

---

## The Verdict
Claude's plan is exceptionally well-structured. It perfectly maps out the hardware layer (vLLM serving Qwen3-32B on your 3090s) and introduces an excellent API/Dashboard layer. 

By merging my database/deduplication concepts with Claude's robust vLLM serving strategy and directory structure, we have a flawless, production-ready blueprint.

---

## The Synthesized Architecture

### 1. The Hardware & LLM Layer (The Claude Code Advantage)
*   **vLLM** running on the RTX 3090s serving `Qwen3-32B-AWQ` via an OpenAI-compatible endpoint at `http://localhost:8000/v1`.
*   **The Beauty of this:** By using identical OpenAI SDK formatting, you can swap between your local 3090s and xAI Grok simply by changing the `baseURL` in your `.env` file. No code rewrites needed.

### 2. The Core State (The Antigravity + Claude Hybrid)
*   **The Queue (Redis + BullMQ):** We are in 100% agreement here. Open loops should not be a markdown file. Redis handles atomic task distribution so Worker 1 and Worker 2 never scrape the exact same lead simultaneously.
*   **The Memory (SQLite + Vector Extensions):** Claude suggested SQLite. I initially suggested PostgreSQL. Claude is right—SQLite is much lighter and easier to deploy. We can use `sqlite-vec` (a vector search extension for SQLite) to achieve the mathematical deduplication I proposed, without the overhead of a massive PostgreSQL Docker container.

### 3. The Agent Trifecta
1.  **The Manager:** Runs on the CPU but requests high-level reasoning from xAI Grok (or Qwen3-72B if running multiple GPUs). Decomposes targets into 5-8 sub-tasks and drops them into Redis.
2.  **The Workers (Start with 3):** Node.js processes that pull jobs from Redis, run Apify/Firecrawl, and use the local 3090 vLLM endpoint to extract leads for **zero cost**.
3.  **The Dashboard:** A React/Vite command center that hits an Express API to visualize the Redis Queue and SQLite findings in real-time.

---

## Action Plan: Executing Phase 1 (Today)

Claude's directory structure is perfect. If you approve this consolidated plan, I am ready to start writing the code. 

**Here is exactly what we will do right now for Phase 1:**
1.  Initialize the new `Valor-AI` folder structure in your `D:\` drive.
2.  Set up the `BullMQ` queue connections.
3.  Write `src/agents/manager.ts` (which reads the current `OPEN_LOOPS.md` and loads them into Redis).
4.  Refactor the code we just wrote into `src/agents/researcher.ts` (which will pull a job from Redis, run the wave, and mark it complete).

While I build this Node.js architecture, you can install your 3090s, download vLLM, and spin up the Qwen endpoint. 

The moment both are done, we connect them together and the swarm goes live.
