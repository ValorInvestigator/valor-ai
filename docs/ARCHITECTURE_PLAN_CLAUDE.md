# Valor AI -- Multi-Agent Research Platform
## Architecture Plan v1.0 | March 23, 2026

---

## VISION

Valor AI is a locally-hosted, GPU-accelerated multi-agent research platform. A Manager agent receives investigation targets, breaks them into assignments, dispatches them to a pool of Researcher agents, collects their findings, deduplicates intelligence, and builds consolidated reports. It runs on your hardware, uses your APIs, and scales from 3 workers to as many as your GPUs and API keys can feed.

This is not a script. It is a service that runs continuously, accepts work, and produces intelligence.

---

## HARDWARE FOUNDATION

### GPU Fleet (RTX 3090 x?)
- 24GB VRAM each
- Each 3090 can serve a 13B-parameter model at full speed, or a 70B model quantized to 4-bit
- Two 3090s can shard a single 70B model across GPUs for higher quality
- vLLM serves models as an OpenAI-compatible API endpoint -- every agent talks to it the same way they'd talk to xAI or Claude

### What runs where
| Component | Runs on | Why |
|-----------|---------|-----|
| Local LLM (analysis/synthesis) | 3090 GPU(s) via vLLM | Free inference, no API costs, unlimited tokens |
| Manager Agent | CPU + local LLM or Claude API | Needs strong reasoning for task decomposition |
| Researcher Workers | CPU + local LLM | Bulk analysis work, runs in parallel |
| Tool execution (Apify, Firecrawl, etc.) | CPU + network | I/O bound, not compute bound |
| Embedding/search (future) | 1 GPU partition | For local RAG over your 15,554 BigQuery docs |

---

## ARCHITECTURE

```
+------------------------------------------------------------------+
|                        VALOR AI CORE                              |
|                                                                   |
|  +------------------+     +----------------------------------+    |
|  |   WEB DASHBOARD  |     |         API SERVER               |    |
|  |   (status, logs, |<--->|   FastAPI or Express             |    |
|  |    controls)      |     |   POST /investigate              |    |
|  +------------------+     |   GET  /status                   |    |
|                           |   GET  /reports                  |    |
|                           +---------------+------------------+    |
|                                           |                       |
|                           +---------------v------------------+    |
|                           |        MANAGER AGENT             |    |
|                           |                                  |    |
|                           |  - Receives investigation target |    |
|                           |  - Decomposes into sub-tasks     |    |
|                           |  - Assigns to worker pool        |    |
|                           |  - Monitors progress             |    |
|                           |  - Merges/deduplicates findings  |    |
|                           |  - Generates final report        |    |
|                           +--+--------+--------+-------------+    |
|                              |        |        |                  |
|                    +---------v--+ +---v------+ +--v---------+     |
|                    | RESEARCHER | | RESEARCHER| | RESEARCHER |    |
|                    |  Worker 1  | |  Worker 2 | |  Worker 3  |    |
|                    +-----+------+ +-----+-----+ +-----+-----+    |
|                          |              |              |          |
|                    +-----v--------------v--------------v-----+    |
|                    |              TOOL LAYER                 |    |
|                    |                                         |    |
|                    |  Apify (132+ actors)    Firecrawl       |    |
|                    |  CourtListener API      BigQuery        |    |
|                    |  OSINT tools (Sherlock, Maigret, etc.)  |    |
|                    |  Brave Search           Custom scrapers |    |
|                    +-----------------------------------------+    |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |                    LLM SERVING LAYER                        |  |
|  |                                                             |  |
|  |   vLLM on 3090(s) -- OpenAI-compatible API at :8000        |  |
|  |   Models: Qwen3-32B (analysis), Mistral-7B (fast tasks)    |  |
|  |   Fallback: xAI Grok API, Claude API (for complex reasoning)|  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+

         STORAGE LAYER (external)
  +-------------+  +-------------+  +-----------------+
  | BigQuery    |  | Local Files |  | Git Repos       |
  | (15,554 docs)|  | (D:\ drive) |  | (GitHub/push)   |
  +-------------+  +-------------+  +-----------------+
```

---

## COMPONENT DETAILS

### 1. LLM Serving Layer (vLLM on 3090s)

**What:** A local API server that serves open-source LLMs on your GPUs. Every agent in the system talks to it like it's OpenAI's API.

**Stack:**
- vLLM (Python) -- production LLM serving, supports batching, paged attention, tensor parallelism
- Runs as a systemd service (or Windows Service via NSSM)
- Endpoint: `http://localhost:8000/v1/chat/completions`

**Models to start with:**
| Model | Size | VRAM | Use case |
|-------|------|------|----------|
| Qwen3-32B-AWQ (4-bit) | ~18GB | 1x 3090 | Primary analysis, report writing |
| Mistral-7B-Instruct | ~14GB | 1x 3090 | Fast classification, lead extraction |
| Nomic-embed-text | ~1GB | Shared | Embeddings for RAG (future) |

**With 2+ GPUs:** Run Qwen3-72B across 2x 3090s for near-Claude-quality analysis locally.

**Setup:**
```bash
pip install vllm
vllm serve Qwen/Qwen3-32B-AWQ --port 8000 --gpu-memory-utilization 0.9
```

Every agent's LLM call becomes:
```typescript
const client = new OpenAI({ baseURL: "http://localhost:8000/v1", apiKey: "not-needed" });
```

**Fallback chain:** Local vLLM -> xAI Grok API -> Claude API (for tasks that need top-tier reasoning)

---

### 2. Manager Agent

**What:** The brain. Receives a high-level investigation target, breaks it into specific research assignments, dispatches them to workers, monitors progress, and synthesizes results.

**Responsibilities:**
- **Task Decomposition:** "Investigate Moda Health Oregon" becomes 5-8 specific sub-tasks (contracts, leadership, lobbying, litigation, regulatory actions, etc.)
- **Assignment:** Picks the best available worker, sends the sub-task with context
- **Load Balancing:** Tracks which workers are busy, queues overflow
- **Deduplication:** When workers return overlapping leads, merges them
- **Synthesis:** Combines all worker reports into a single consolidated intelligence report
- **Lead Management:** New leads go into a priority queue, not just a flat list
- **Escalation:** If a worker hits something critical (e.g., court filing mentioning Bingaman), flags it immediately

**Runs on:** Claude API or local Qwen3-72B (needs strong reasoning)

**State:** Redis for job queue + SQLite for investigation history

---

### 3. Researcher Workers (starting at 3, expandable)

**What:** Each worker is an autonomous research agent. It receives a specific assignment, uses tools to gather information, analyzes findings with the LLM, and returns a structured report + new leads.

**Each worker has:**
- Its own tool execution context (Apify client, Firecrawl, etc.)
- Access to the shared rate limiter (prevents API hammering)
- A worker ID and assignment log
- Heartbeat reporting back to the Manager

**Worker lifecycle:**
```
IDLE -> ASSIGNED (gets task) -> SEARCHING (running tools) ->
ANALYZING (LLM processing) -> REPORTING (writing findings) ->
RETURNING (sends results to Manager) -> IDLE
```

**Output format (structured JSON):**
```json
{
  "worker_id": "researcher-01",
  "assignment": "Moda Health Oregon lobbying expenditures",
  "confidence": 0.82,
  "findings": [
    { "fact": "...", "source": "...", "confidence": 0.9 },
    { "fact": "...", "source": "...", "confidence": 0.7 }
  ],
  "new_leads": ["Lead A", "Lead B"],
  "report_markdown": "## Moda Health Lobbying\n..."
}
```

**Scaling:**
- 3 workers on day 1
- Each worker needs ~2GB RAM + shared GPU for LLM calls
- Add workers by incrementing a config number -- no code changes
- Rate limiter scales automatically (wider spacing with more workers)

---

### 4. Tool Layer (shared across all workers)

**Existing tools (already working in your codebase):**
- Apify (Google Search Scraper, Website Content Crawler, 132+ actors)
- Firecrawl (deep scraping with JS rendering)
- xAI Grok API (analysis)
- Git auto-commit

**Tools to add:**
- CourtListener API (court records, PACER)
- BigQuery client (query your 15,554 investigation docs)
- OSINT tools (Sherlock, Maigret, Holehe -- username/email lookups)
- Brave Search API (fast web search, cheaper than Google)
- PDF extraction (for court documents)

**Rate Limiting (critical):**
Your Bottleneck setup is already right. For multiple workers:
```
Global rate limiter (shared across all workers):
  - Apify: 1 request per 3 seconds (wider spacing for 3 workers)
  - Firecrawl: 2 concurrent, 1 per second
  - Brave Search: 5 per second (generous free tier)
  - CourtListener: 1 per 2 seconds
  - Local LLM: unlimited (your hardware)
```

---

### 5. Job Queue (Redis + BullMQ)

**Why not OPEN_LOOPS.md?** A flat markdown file works for 1 researcher. With 3+ workers grabbing tasks concurrently, you need atomic operations (two workers can't grab the same lead). Redis handles this.

**Queue structure:**
```
investigation:pending    -- new investigations waiting to be decomposed
assignments:pending      -- sub-tasks waiting for a worker
assignments:active       -- currently being researched
assignments:completed    -- done, findings merged
leads:priority           -- priority-sorted lead queue
leads:investigated       -- already researched (dedup check)
```

**BullMQ gives you:**
- Atomic task assignment (no double-grabs)
- Retry on failure
- Progress tracking
- Dead letter queue (tasks that fail 3x)
- Dashboard (Bull Board -- web UI to watch jobs)

---

### 6. API Server + Dashboard

**API (FastAPI or Express):**
```
POST /investigate          -- submit a new investigation target
GET  /status               -- current workers, active assignments
GET  /reports              -- list completed reports
GET  /reports/:id          -- get a specific report
GET  /leads                -- view lead queue
POST /leads                -- manually add a lead
GET  /workers              -- worker status and history
POST /workers/scale        -- add/remove workers
GET  /metrics              -- token usage, API costs, throughput
```

**Dashboard (web UI):**
- Real-time worker status (idle/busy/error)
- Live investigation progress
- Lead queue with priority sorting
- Report viewer
- API cost tracker
- GPU utilization monitor

---

## TECH STACK

| Layer | Technology | Why |
|-------|-----------|-----|
| Language | TypeScript (Node.js) | You already have working TS code, consistent stack |
| LLM Serving | vLLM (Python) | Best-in-class GPU utilization, OpenAI-compatible |
| Job Queue | Redis + BullMQ | Battle-tested, atomic operations, web dashboard |
| API Server | Express.js or Fastify | Lightweight, TS native |
| Dashboard | React + Vite (or Next.js) | Fast, modern, deployable to Vercel |
| Database | SQLite (local) + BigQuery (cloud) | SQLite for app state, BigQuery for investigation data |
| Process Manager | PM2 | Keeps workers alive, auto-restart, log management |
| LLM Client | OpenAI SDK (unified) | Same client talks to vLLM, xAI, Claude -- just change baseURL |
| Containerization | Docker Compose (future) | One command to start everything |

---

## BUILD PHASES

### Phase 1: Foundation (Week 1)
- [ ] Set up vLLM on first 3090, serve Qwen3-32B
- [ ] Install Redis, set up BullMQ queues
- [ ] Build Manager agent (task decomposition + assignment)
- [ ] Refactor existing researcher into a Worker class
- [ ] Wire Manager -> Queue -> Worker pipeline
- [ ] Test: Manager decomposes "Moda Health" into 3 sub-tasks, 3 workers execute in parallel

### Phase 2: Intelligence (Week 2)
- [ ] Add tool layer abstraction (unified interface for all tools)
- [ ] Integrate CourtListener, Brave Search, BigQuery tools
- [ ] Build deduplication engine (embedding similarity on leads)
- [ ] Add structured output format for worker reports
- [ ] Build report merger (Manager synthesizes worker reports into one)
- [ ] Add LLM fallback chain (local -> xAI -> Claude)

### Phase 3: Interface (Week 3)
- [ ] Build Express API server
- [ ] Build web dashboard (worker status, live logs, reports)
- [ ] Add Bull Board for queue monitoring
- [ ] Add investigation history (SQLite)
- [ ] PM2 process management for all components

### Phase 4: Scale + Harden (Week 4)
- [ ] Dynamic worker scaling (add/remove via API)
- [ ] Multi-GPU model serving (Qwen3-72B across 2x 3090)
- [ ] RAG pipeline over BigQuery docs (local embeddings)
- [ ] Cost tracking (API calls, tokens, GPU hours)
- [ ] Auto-retry and dead letter handling
- [ ] Git auto-push for all reports

### Phase 5: Advanced (Month 2+)
- [ ] Specialized worker types (court researcher, social media analyst, financial investigator)
- [ ] Inter-worker communication (Worker 1 finds a lead, directly assigns to Worker 2)
- [ ] Continuous monitoring mode (watch a target for new court filings, news)
- [ ] Voice briefing generation (TTS summary of overnight findings)
- [ ] Mobile notification on critical findings
- [ ] Plugin system for new tool integrations

---

## DIRECTORY STRUCTURE

```
D:\Valor-AI\
  |-- docker-compose.yml        (future: one-command startup)
  |-- package.json
  |-- tsconfig.json
  |-- .env                      (API keys, config)
  |
  |-- src/
  |   |-- server/
  |   |   |-- index.ts          (Express API server)
  |   |   |-- routes/
  |   |       |-- investigate.ts
  |   |       |-- workers.ts
  |   |       |-- reports.ts
  |   |       |-- leads.ts
  |   |
  |   |-- agents/
  |   |   |-- manager.ts        (Manager agent -- decomposes, assigns, merges)
  |   |   |-- researcher.ts     (Worker agent -- your existing code, refactored)
  |   |   |-- types.ts          (shared types: Assignment, Finding, Report, Lead)
  |   |
  |   |-- tools/
  |   |   |-- apify.ts          (existing, refined)
  |   |   |-- firecrawl.ts
  |   |   |-- courtlistener.ts
  |   |   |-- bigquery.ts
  |   |   |-- brave-search.ts
  |   |   |-- osint.ts          (Sherlock, Maigret, Holehe wrappers)
  |   |   |-- index.ts          (unified tool interface)
  |   |
  |   |-- queue/
  |   |   |-- connection.ts     (Redis connection)
  |   |   |-- queues.ts         (BullMQ queue definitions)
  |   |   |-- workers.ts        (BullMQ worker processors)
  |   |
  |   |-- llm/
  |   |   |-- client.ts         (unified LLM client with fallback chain)
  |   |   |-- prompts.ts        (system prompts for manager + workers)
  |   |
  |   |-- storage/
  |   |   |-- sqlite.ts         (local app state)
  |   |   |-- reports.ts        (report read/write)
  |   |
  |   |-- utils/
  |       |-- rateLimiter.ts    (existing, shared across workers)
  |       |-- dedup.ts          (lead deduplication)
  |       |-- logger.ts
  |
  |-- dashboard/                (React web UI)
  |   |-- src/
  |   |-- package.json
  |
  |-- data/
  |   |-- reports/              (generated intelligence reports)
  |   |-- logs/                 (worker logs)
  |   |-- db/                   (SQLite files)
  |
  |-- scripts/
      |-- setup-vllm.sh         (GPU setup script)
      |-- start-all.sh          (PM2 ecosystem start)
```

---

## COST ANALYSIS

### With local 3090s (Valor AI):
| Resource | Cost |
|----------|------|
| LLM inference | $0 (your hardware, your electricity) |
| Apify | ~$49/mo (paid plan, 132+ actors) |
| Firecrawl | Free tier or ~$19/mo |
| Brave Search | Free tier (2,000 queries/mo) |
| CourtListener | Free (RECAP project) |
| Redis | $0 (local) |
| Electricity | ~$0.50-1.00/day per 3090 under load |
| **Total** | **~$70-100/month** |

### Without local GPUs (API only):
| Resource | Cost |
|----------|------|
| xAI Grok API | ~$200-500/mo at research volume |
| Claude API | ~$100-300/mo for complex tasks |
| Same tool costs | ~$70/mo |
| **Total** | **~$370-870/month** |

The 3090s pay for themselves in 2-3 months.

---

## DAY ONE CHECKLIST (when GPUs arrive)

1. Install GPUs, verify CUDA with `nvidia-smi`
2. Install vLLM: `pip install vllm`
3. Download Qwen3-32B-AWQ: `huggingface-cli download Qwen/Qwen3-32B-AWQ`
4. Start vLLM: `vllm serve Qwen/Qwen3-32B-AWQ --port 8000`
5. Test from Node: `curl http://localhost:8000/v1/chat/completions -d '{"model":"Qwen/Qwen3-32B-AWQ","messages":[{"role":"user","content":"Hello"}]}'`
6. Install Redis: `winget install Redis.Redis` (or Docker)
7. Create `D:\Valor-AI\` directory structure
8. Move + refactor existing researcher code into new structure
9. Build Manager agent
10. Run first 3-worker investigation

---

## THE NAME

**Valor AI** -- an autonomous intelligence platform built by Valor Investigations.
Not a chatbot. Not a script. A research engine that works while you sleep.

---

*Plan authored: March 23, 2026*
*Levi Bakke, Valor Investigations*
