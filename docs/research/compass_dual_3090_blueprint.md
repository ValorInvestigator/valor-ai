# Dual RTX 3090 local LLM deployment: a production blueprint

**The smartest deployable configuration on dual 3090s without NVLink uses Qwen3-32B-AWQ as the orchestrator on GPU 0, Qwen3-8B-AWQ as the worker fleet on GPU 1, and Llama-3.3-70B-Instruct-AWQ across both GPUs for deep analysis.** This setup maximizes intelligence per VRAM byte on hardware that, despite being two generations old, remains remarkably capable for local inference. vLLM runs exclusively through WSL2/Docker on Windows 11 — there is no production-grade native Windows path — and AWQ 4-bit with Marlin kernels is the only quantization format worth considering for this inference server. The critical insight for Lane 2 is that vLLM's continuous batching architecture eliminates the need for multiple model instances entirely: a single Qwen3-8B handles concurrent worker requests natively through PagedAttention.

---

## Lane 1: the orchestrator brain on a single GPU

**Model: `Qwen/Qwen3-32B-AWQ`** — the smartest dense model that reliably fits a single RTX 3090 under vLLM.

Qwen3-32B (released April 2025) dominates every alternative in the 24GB envelope. It outperforms GPT-4o on ArenaHard (**92.4** vs 85.3), scores **85.7** on AIME'24, and provides hybrid thinking/non-thinking modes — toggle deep chain-of-thought reasoning per request. The official AWQ quantization from Alibaba ships as a drop-in vLLM model with zero compatibility issues.

**VRAM line-item budget (GPU 0):**

| Component | VRAM |
|---|---|
| Model weights (32B × 4-bit AWQ) | **~16.0 GB** |
| CUDA context + vLLM framework overhead | ~1.5 GB |
| KV cache (Qwen3-32B: 64 layers, 8 KV heads, 128 head_dim) | **~4.6 GB** |
| **Total** | **~22.1 GB of 24 GB** |

KV cache math: each token consumes **256 KB** (2 × 64 layers × 8 heads × 128 dim × 2 bytes FP16). With 4.6 GB available, that yields **~18,000 tokens** of context — enough for an orchestrator handling structured queries of 2–8K tokens with room for system prompts and output. Setting `--gpu-memory-utilization 0.95` pushes this to ~20K tokens.

**Why not larger models?** Qwen2.5-72B-AWQ requires **~36 GB** for weights alone — impossible on 24 GB. Llama-3.1-70B at 3-bit GPTQ clocks in at ~26 GB before any KV cache. Yi-34B and Command-R-35B fit physically but trail Qwen3-32B by **15–20 points** on reasoning benchmarks.

**The MoE alternative worth knowing about:** `Qwen/Qwen3-30B-A3B` (30B total, only 3B active per token) achieves **91.0 on ArenaHard** at **35–54 t/s** versus Qwen3-32B's 22 t/s, with 32K context at Q4. The catch: MoE quantized models in vLLM have a documented history of loading failures and inference bugs. If stability has improved by the time you deploy, this becomes the speed-optimized pick. The February 2026 `Qwen3.5-35B-A3B` scores even higher (MMLU-Pro **85.3%**, GPQA Diamond **84.2%**) but its novel Gated Delta Networks architecture still has active vLLM bug reports on single-GPU GPTQ inference.

**Launch command:**
```bash
docker run -d --name vllm-manager \
  --gpus "device=0" \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HF_TOKEN=$HF_TOKEN \
  -p 8000:8000 \
  --ipc=host --shm-size=8g \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen3-32B-AWQ \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.92 \
  --enable-reasoning --reasoning-parser deepseek_r1
```

**Structured output note:** vLLM's `guided_json` works correctly with Qwen3 in thinking mode. A documented bug (issue #18819) breaks JSON output when `enable_thinking=False` is set via the reasoning parser. The workaround: keep thinking enabled but inject `/no_think` in the prompt text when you need fast, non-reasoning responses.

---

## Lane 2: why one worker beats three

**Model: `Qwen/Qwen3-8B-AWQ`** — a single vLLM instance replaces three separate workers.

The original premise of "3 concurrent instances at ~8 GB each" reflects a misunderstanding of vLLM's architecture. **vLLM does not need multiple instances for concurrency.** Its continuous batching scheduler assembles batches from all active sequences at every decode step, and PagedAttention allocates KV cache in non-contiguous blocks on demand. A single model instance handles 3, 10, or 50 concurrent requests — limited only by KV cache capacity, not instance count. This fundamentally changes the math: instead of budgeting 8 GB × 3 = 24 GB, you budget for **one model load plus shared KV cache**.

**VRAM line-item budget (GPU 1, single instance):**

| Component | VRAM |
|---|---|
| Model weights (8B × 4-bit AWQ) | **~4.0 GB** |
| CUDA context + framework overhead | ~1.5 GB |
| KV cache pool (shared across all concurrent requests) | **~16.5 GB** |
| **Total** | **~22.0 GB of 24 GB** |

KV cache math: Qwen3-8B uses ~**56 KB per token** (2 × 36 layers × 4 KV heads × 128 dim × 2 bytes). With 16.5 GB available, you get **~300,000 tokens** of aggregate KV capacity. Three concurrent requests at 8K context each consume just **~1.3 GB** — leaving 15 GB for additional concurrent requests or longer contexts. You could serve **10 concurrent requests at 32K context** and still have headroom.

**Why Qwen3-8B over alternatives?** Per the Qwen3 technical report, Qwen3-8B outperforms Qwen2.5-14B on over half of benchmarks despite being nearly half the size. It supports non-thinking mode (disable the reasoning overhead for fast extraction), native tool calling, and structured JSON output via `guided_json`. The official AWQ quantization from Qwen is battle-tested on vLLM.

**The specialized extraction option:** `numind/NuExtract-2.0-8B` is purpose-built for structured extraction and outperforms GPT-4.1 by **+9 F-Score** on extraction benchmarks. It's multimodal (can extract from PDFs/images directly) but based on Qwen2.5-VL, so its vision encoder adds VRAM overhead. For a mixed workload (extraction + summarization + NER + RAG), the general-purpose Qwen3-8B-AWQ is more versatile. For a pure extraction pipeline, NuExtract is best-in-class.

**Alternative models ranked:**

| Model | HuggingFace path | Weights (AWQ) | Best for |
|---|---|---|---|
| **Qwen3-8B** ★ | `Qwen/Qwen3-8B-AWQ` | ~4 GB | General extraction + summarization |
| Qwen2.5-14B | `Qwen/Qwen2.5-14B-Instruct-AWQ` | ~7 GB | Maximum quality on structured data/tables |
| Qwen2.5-7B | `Qwen/Qwen2.5-7B-Instruct-AWQ` | ~3.5 GB | Proven reliable, huge community support |
| NuExtract 2.0 | `numind/NuExtract-2.0-8B` | ~16 GB (FP16) | Pure entity extraction (needs quantization for vLLM) |
| Phi-4-mini | `microsoft/Phi-4-mini-instruct` | ~2 GB | Ultra-lightweight, function calling |
| Gemma-3-4B | `google/gemma-3-4b-it` | ~2 GB | Multimodal document understanding, 128K context |

**Launch command:**
```bash
docker run -d --name vllm-workers \
  --gpus "device=1" \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HF_TOKEN=$HF_TOKEN \
  -p 8001:8000 \
  --ipc=host --shm-size=8g \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen3-8B-AWQ \
  --max-model-len 16384 \
  --max-num-seqs 16 \
  --gpu-memory-utilization 0.92 \
  --chat-template-kwargs '{"enable_thinking": false}'
```

Disable thinking mode for worker tasks — extraction and summarization don't benefit from chain-of-thought overhead, and non-thinking mode runs **2–3× faster** by skipping reasoning token generation.

---

## Lane 3: the 70B deep-analysis model across both GPUs

**Model: `ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4`** — the biggest brain that fits across 48 GB via tensor parallelism.

This lane requires shutting down Lane 1 and Lane 2 containers before launching, since it needs both GPUs. **vLLM tensor parallelism works without NVLink**, but you must set `NCCL_P2P_DISABLE=1` to force PCIe communication. Direct benchmarks from Himesh Prasad (March 2025) on 2× RTX 3090 with `NCCL_P2P_DISABLE=1` measured **483 output tokens/s** at TP=2 without NVLink versus 715 t/s with NVLink — a **32% performance penalty** (PCIe runs at 68% of NVLink throughput). The bottleneck hits hardest during prefill: each of the 80 transformer layers requires an all-reduce synchronization across the **16 GB/s PCIe 3.0** bus versus NVLink's 112.5 GB/s. Expect **2–5 second time-to-first-token** for prompts of 500–1,000 tokens.

Llama-3.3-70B-Instruct (December 2024) matches Llama-3.1-405B on multiple benchmarks at 5.8× smaller. The AWQ INT4 quantization by `ibnzterrell` was specifically built and validated on 2× RTX 3090 hardware.

**VRAM line-item budget (both GPUs, TP=2):**

| Component | Per GPU | Total |
|---|---|---|
| Model weights (70B × 4-bit AWQ ÷ 2 GPUs) | **~17.5 GB** | ~35 GB |
| CUDA context + activations + framework | ~1.75 GB | ~3.5 GB |
| KV cache (FP16) | **~2.83 GB** | ~5.66 GB |
| **Total** | **~22.08 GB** | **~44.16 GB of 48 GB** |

KV cache math with TP=2: Llama-3.3-70B has 80 layers, 8 KV heads (GQA), 128 head_dim. Split across 2 GPUs, each handles 4 KV heads. Per token per GPU: 2 × 80 × 4 × 128 × 2 = **160 KB**. With 2.83 GB per GPU: **~18,000 tokens** of context. Using `--kv-cache-dtype fp8` (supported on Ampere for KV storage) doubles this to **~36,000 tokens** at minimal quality loss.

**Why Llama-3.3-70B over Qwen2.5-72B?** Qwen2.5-72B-AWQ weighs **~37 GB** versus 35 GB for Llama-3.3, leaving only ~1.6 GB per GPU for KV cache (~8–10K context). The 2 GB weight difference translates to roughly double the context window on Llama-3.3. Both score comparably on reasoning benchmarks, but Llama-3.3 gives you more operational headroom.

**What about 2025/2026 models?** No new open-weight dense model in the 70B class has appeared since Llama 3.3. Llama 4 is MoE-only (Scout at 109B total needs ~55 GB at INT4 — doesn't fit). Qwen3's dense lineup tops out at 32B. The 70B AWQ sweet spot remains the ceiling for 48 GB total VRAM.

**Launch command:**
```bash
docker run --rm --name vllm-deepdive \
  --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HF_TOKEN=$HF_TOKEN \
  -e NCCL_P2P_DISABLE=1 \
  -p 8000:8000 \
  --ipc=host --shm-size=16g \
  vllm/vllm-openai:latest \
  --model ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4 \
  --quantization awq \
  --dtype float16 \
  --tensor-parallel-size 2 \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.92 \
  --max-num-seqs 4 \
  --disable-custom-all-reduce
```

The `--disable-custom-all-reduce` flag is essential: vLLM's custom all-reduce requires P2P GPU capability (NVLink), so you must fall back to NCCL's standard implementation over PCIe.

**Realistic performance expectations:** Single-user decode at **~10–16 tokens/second**. Prefill at **~100–150 tokens/second**. Usable for deep-dive investigative reports where you trade latency for intelligence. Not suitable for interactive chat.

---

## The infrastructure stack: vLLM on Windows 11

**vLLM does not run natively on Windows.** A community fork exists (`SystemPanic/vllm-windows`) but lacks Flash Attention v3, has fragile compilation requirements, and is not production-grade. The only recommended path is **Docker via WSL2**.

**Setup requirements:**
- Windows 11 Pro with WSL2 enabled (Ubuntu 24.04 LTS recommended)
- NVIDIA Game Ready or Studio driver on the Windows host (do NOT install CUDA toolkit inside WSL — it overwrites the GPU stub)
- Docker Desktop 4.54+ with WSL2 backend, or Docker Engine installed directly inside WSL2
- NVIDIA Container Toolkit installed inside WSL2
- RTX 3090 = compute capability 8.6 (Ampere) — fully supported

WSL2 delivers **90–100%** of native Linux inference performance. The overhead is negligible for inference workloads.

**Docker Compose for Lane 1 + Lane 2 (simultaneous operation):**
```yaml
services:
  manager:
    image: vllm/vllm-openai:latest
    container_name: vllm-manager
    ports:
      - "8000:8000"
    environment:
      HF_TOKEN: ${HF_TOKEN}
    volumes:
      - ~/.cache/huggingface:/root/.cache/huggingface
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['0']
              capabilities: [gpu]
    ipc: host
    shm_size: "8g"
    command: >
      --model Qwen/Qwen3-32B-AWQ
      --max-model-len 8192
      --gpu-memory-utilization 0.92
      --enable-reasoning --reasoning-parser deepseek_r1

  workers:
    image: vllm/vllm-openai:latest
    container_name: vllm-workers
    ports:
      - "8001:8000"
    environment:
      HF_TOKEN: ${HF_TOKEN}
    volumes:
      - ~/.cache/huggingface:/root/.cache/huggingface
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['1']
              capabilities: [gpu]
    ipc: host
    shm_size: "8g"
    command: >
      --model Qwen/Qwen3-8B-AWQ
      --max-model-len 16384
      --max-num-seqs 16
      --gpu-memory-utilization 0.92
```

**Important:** Use `device_ids` in the Docker Compose deploy section, not `CUDA_VISIBLE_DEVICES`. A known vLLM issue (#28132) causes "No CUDA GPUs available" errors when using `CUDA_VISIBLE_DEVICES` inside containers.

---

## AWQ wins the quantization format war for this hardware

vLLM's quantization support is not equal across formats. On RTX 3090 (Ampere, SM 8.6), the performance hierarchy is stark:

| Format | vLLM support | Throughput (tok/s) | Perplexity | Verdict |
|---|---|---|---|---|
| **AWQ + Marlin kernel** | ✅ Full | **741** | 6.84 | **Use this** |
| GPTQ + Marlin | ✅ Full | 712 | 6.90 | Good alternative |
| BitsAndBytes 4-bit | ✅ (4-bit only) | 168 | **6.67** | Best quality, slow |
| GGUF Q4_K_M | ⚠️ Experimental | 93 | 6.74 | Use llama.cpp instead |
| FP8 (W8A16 Marlin) | ✅ Partial | Moderate | Near-FP16 | Not 4-bit; less VRAM savings |
| EXL2 | ❌ Not supported | N/A | N/A | ExLlamaV2 only |

**AWQ with the Marlin kernel delivers 1.6× the throughput of FP16** while preserving identical code generation quality (HumanEval Pass@1). GGUF in vLLM runs at **8× slower** than AWQ — if you need GGUF models, use llama.cpp directly. EXL2 is flatly unsupported in vLLM (feature request closed as "not planned"). FP8 on RTX 3090 runs as weight-only W8A16 via Marlin (full W8A8 requires Ada Lovelace SM ≥ 8.9), making it viable but offering less VRAM savings than 4-bit.

The recommendation is unambiguous: **AWQ 4-bit for all three lanes.** Use official Qwen/HuggingFace AWQ quantizations where available — they're calibrated by the model authors and guaranteed compatible.

---

## Context windows achievable per lane

| Lane | Model | KV budget | KV per token | Max context | Practical target |
|---|---|---|---|---|---|
| 1 (Manager) | Qwen3-32B-AWQ | ~4.6 GB | 256 KB | ~18K tokens | **8–12K** |
| 2 (Workers) | Qwen3-8B-AWQ | ~16.5 GB | 56 KB | ~300K aggregate | **16K per request, 16 concurrent** |
| 3 (Deep Dive) | Llama-3.3-70B-AWQ TP=2 | ~2.8 GB/GPU | 160 KB/GPU | ~18K tokens | **8–16K** (32K with FP8 KV) |

Lane 1's 8–12K context is sufficient for an orchestrator routing structured queries. Lane 2's massive KV headroom means the worker fleet is never context-limited in practice. Lane 3 is the tightest — for long investigative reports, use `--kv-cache-dtype fp8` to double the effective context to ~32K tokens at negligible quality cost.

---

## Operational switching between modes

The three lanes represent two operational modes that share the same hardware:

**Mode A (Standard Operation):** Lanes 1 + 2 run simultaneously. GPU 0 serves the manager model, GPU 1 serves the worker fleet. Your orchestrator dispatches extraction tasks to `localhost:8001` and handles reasoning on `localhost:8000`. This is the default state.

**Mode B (Deep Analysis):** Shut down both Lane 1 and Lane 2 containers, then launch Lane 3. Both GPUs serve a single 70B model for maximum-intelligence analysis. This is an on-demand mode for complex investigative deep-dives — writing final reports, analyzing complex evidence chains, or performing multi-step reasoning that exceeds 32B capability.

A simple bash script or Docker Compose profile handles the switch:
```bash
# Switch to Deep Analysis mode
docker compose down
docker run --rm --gpus all -e NCCL_P2P_DISABLE=1 \
  -e HF_TOKEN=$HF_TOKEN -p 8000:8000 \
  --ipc=host --shm-size=16g \
  vllm/vllm-openai:latest \
  --model ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4 \
  --tensor-parallel-size 2 --max-model-len 16384 \
  --gpu-memory-utilization 0.92 --disable-custom-all-reduce
```

---

## Conclusion

Three decisions define this deployment. First, **Qwen3-32B-AWQ is the intelligence ceiling for a single 3090** — no 72B model fits, no 34B model matches it on reasoning, and its hybrid thinking mode makes it uniquely suited for orchestration tasks that alternate between fast routing and deep analysis. Second, **continuous batching eliminates the multi-instance problem entirely** for the worker fleet: one Qwen3-8B-AWQ instance with 16.5 GB of KV cache handles far more concurrent work than three cramped instances ever could. Third, **tensor parallelism over PCIe works but costs 32% throughput** — a tax worth paying when you need 70B-class reasoning for final-stage investigative analysis, but one that makes the mode-switching architecture (Lanes 1+2 for daily work, Lane 3 for deep dives) the right operational pattern.

The model landscape as of March 2026 strongly favors the Qwen family for local deployment. Qwen3 and Qwen3.5 models ship with official AWQ quantizations, Apache 2.0 licensing, native tool calling, and structured output support that aligns precisely with investigative journalism pipelines. DeepSeek-R1-Distill-Qwen-32B (`deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`) deserves mention as a Lane 1 alternative when transparent chain-of-thought verification matters more than raw benchmark scores — its exposed reasoning traces let you audit exactly how the model reached a conclusion, invaluable for evidence-based journalism. Watch for vLLM stabilization of Qwen3.5-35B-A3B support: once the Gated Delta Networks architecture bugs are resolved, that model's **110 t/s** decode speed at quality matching DeepSeek-V3.2 would make it the clear Lane 1 upgrade.