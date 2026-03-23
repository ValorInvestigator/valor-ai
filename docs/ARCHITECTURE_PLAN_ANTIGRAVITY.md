# Valor AI: OSINT Platform Architecture Plan
*Proposed by Antigravity*

## 1. The Vision: From Script to Platform
Since your RTX 3090s are arriving today, the game has fundamentally changed. You no longer need to rely solely on expensive, external APIs (like xAI or Anthropic) for *every* step of the process. 
With 24GB of VRAM per card, you can run powerful local models (like Llama 3 8B or Mixtral) to do the heavy lifting of raw text parsing and lead extraction, completely free and 100% private. 

**Valor AI** is a multi-node, Manager/Worker intelligence platform. 
We move away from text files (`OPEN_LOOPS.md`) which corrupt under parallel access, and move to a robust Database + Queue architecture.

---

## 2. Core Architecture Components

### A. The Global Queue & Memory (PostgreSQL + BullMQ)
A flat text file cannot handle 3 concurrent workers (let alone 10) trying to read and write to it simultaneously. 
*   **BullMQ (Redis):** Handles the "Task Queue". The Manager drops assignments into this queue, and Workers pull them one by one. If a Worker crashes, the task goes back into the queue.
*   **PostgreSQL + pgvector:** Replaces `active_work.md`. Every finding and lead is saved as a structured row. By using vector embeddings, the database can automatically deduplicate leads. (e.g., The database knows that "John Smith at GOBHI" and "J. Smith GOBHI Board" are the exact same target and merges them).

### B. The Manager Node (The Strategist)
*The Manager does not do the searching. It dictates the war.*
*   Reads the PostgreSQL database and scores the priority of identified leads.
*   Pushes high-priority targets to the BullMQ task queue.
*   Uses **xAI (Grok)** for high-level synthesis: Periodically reads the overall database graph and writes the `NETWORK_INTEL_REPORT.md` to summarize the state of the investigation.
*   Handles Git commits and platform hygiene.

### C. The Worker Nodes (The Grunts)
*Start with 3, scale to infinity.*
*   Each Worker runs its own loop: `Grab Task -> Scrape -> Extract -> Push to DB`.
*   **The 3090 Advantage:** Workers will use a local LLM instance (via Ollama or vLLM running on your new GPUs) to read the multi-page Apify scrape results and extract the JSON leads. This costs $0 in API fees and avoids rate limits.
*   Workers push their raw Markdown findings and new JSON leads *back* to PostgreSQL, then grab the next task.

---

## 3. Implementation Roadmap

### Phase 1: The Multi-Process MVP (Today)
*   **Goal:** Prove we can run 3 parallel researchers safely.
*   **Action:** Implement **BullMQ** (requires a local Redis server).
*   **Code:** Split the codebase into `manager.ts` and `worker.ts`. The Manager reads your current `OPEN_LOOPS.md` and seeds the queue. 3 concurrent `worker.ts` processes pull tasks, run the Apify/xAI loop, and append results.

### Phase 2: Database Storage & Deduplication
*   **Goal:** Stop researching duplicates and build a queryable intelligence vault.
*   **Action:** Spin up a local PostgreSQL database with Prisma ORM. 
*   **Code:** Workers no longer write to `.md` files. They insert rows into `Target`, `Finding`, and `Lead` tables. The Manager runs a deduplication script to merge redundant leads before queueing them.

### Phase 3: The 3090 Local Integration
*   **Goal:** Slash API costs and leverage the new hardware.
*   **Action:** Install **Ollama** on the machine hosting the 3090s.
*   **Code:** Point the Workers to `http://localhost:11434/v1` instead of xAI. The Workers use local compute to extract leads. The Manager continues to use xAI Grok for the complex Final Report generation.

### Phase 4: The Valor AI Command Center
*   **Goal:** Visual control over the swarm.
*   **Action:** Build a React/Vite dashboard.
*   **Features:** View the BullMQ queue in real-time. See which Worker is currently researching which target. View an interactive Network Node Graph of the PostgreSQL database showing the connections between all discovered people and organizations.
