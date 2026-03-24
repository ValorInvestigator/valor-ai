# Dual RTX 3090 Local LLM Deployment Stack for Evidence-Grade OSINT

## Scope and operating assumptions

You have dual RTX 3090s (24GB each; compute capability 8.6), no NVLink, and you want everything to run under entity["organization","vLLM","llm inference engine"] with three operating modes: a “manager” model pinned to GPU 0, a concurrent “worker fleet” pinned to GPU 1, and an occasional “deep dive” single-model session spanning both GPUs. citeturn28view0turn34view0

Two constraints drive almost every engineering choice here:

First, VRAM is dominated by (a) **weights** and (b) the **KV cache** for attention. Even when weights fit, KV cache can sink the deployment if you allow long contexts and/or concurrency. citeturn13search13turn33view0turn36search0

Second, because you have **no NVLink**, any multi-GPU sharding has meaningful interconnect cost. entity["organization","vLLM","llm inference engine"] explicitly notes that when GPUs don’t have NVLINK interconnect, pipeline parallelism can outperform tensor parallelism due to reduced synchronization/communication overhead—even if tensor parallelism is still usable. citeturn34view0

## Why the MoE “active params” idea fails on VRAM, and why “uncensoring” is an evidentiary risk

### MoE VRAM reality

The “120B MoE but only 12B active” intuition is compute-relevant, not VRAM-relevant, unless you implement aggressive expert offload/caching (which is complicated and will usually murder latency on consumer PCIe). In normal serving, MoE deployments still need the expert weights present (or at least readily available) because routing can select different experts token-to-token. citeturn38search0turn38search20turn38search25

There are research and engineering efforts aimed at making MoE feasible with partial expert residency (e.g., expert caches and pinned-memory expert residency designs), but that is not the default “drop-in” path for a reliability-first investigative stack. citeturn38search9

### “Refusal vs hallucination” is real, but “weight-level safety stripping” is a bad gamble for OSINT

Your core point is correct: aligned general chat models can produce **false-positive safety refusals** (over-refusing benign, real-world names/documents). But the “solve it by removing safety at the weight level” approach creates a different failure mode that is worse for evidentiary work: **confident fabrication** (hallucination with high certainty, and often citation-shaped hallucinations). The research literature increasingly treats hallucination behavior as entangled with other alignment behaviors in complex ways; changing alignment characteristics can shift hallucination/abstention behavior in non-obvious directions. citeturn30search10turn30search9

If your output is used to steer subpoenas, litigation strategy, or law-enforcement referrals, your system should be engineered so the model is **structurally forced** to (a) quote or cite retrieved evidence or (b) say “insufficient evidence.” That is primarily a systems design problem: retrieval, traceability, structured outputs, and automated verification layers—not “find a model that never refuses.” citeturn30search3turn37view0turn30search27

## Memory math and sizing method

### The two buckets you must budget

**Weights**: fixed cost to load the model. Quantization reduces this. citeturn35view0turn32view0

**KV cache**: grows roughly linearly with (a) sequence length and (b) number of concurrent sequences. This is usually the largest variable memory cost in serving. citeturn13search13turn13search7

A standard KV-cache sizing formula (for GQA/MQA models) is:  
**KV bytes per token = 2 × num_layers × num_kv_heads × head_dim × bytes_per_element**  
The factor 2 is K and V. citeturn13search13turn13search4

### vLLM knobs that actually control fit

Key entity["organization","vLLM","llm inference engine"] parameters:

- `--gpu-memory-utilization`: a per-instance GPU memory cap used by vLLM to size internal allocations. citeturn33view0turn23search2  
- `--max-model-len`: hard ceiling on context length (prompt + generation). vLLM can also auto-pick the largest that fits, but reliability work benefits from explicit ceilings. citeturn23search6turn13search3  
- `--max-num-seqs` / `--max-num-batched-tokens`: controls concurrency and batching, which drives KV cache demand. citeturn13search7turn23search2  
- `--kv-cache-memory-bytes`: explicit KV cache budget per GPU; overrides `gpu_memory_utilization` and is the closest thing to deterministic “don’t exceed this KV allocation” control. citeturn36search0turn33view0

Also: vLLM’s structured outputs (JSON schema constrained decoding) is a major reliability lever for “perfect JSON formatting.” citeturn37view0turn30search3

## Recommended three-lane model stack

This stack prioritizes: (1) stable structured outputs, (2) low hallucination rate under evidence-grounded prompting, (3) predictable fit on 24GB cards, and (4) operational simplicity under entity["organization","vLLM","llm inference engine"] on Ampere. citeturn35view0turn37view0

### Manager lane

**Model**: `Qwen/Qwen2.5-32B-Instruct-AWQ`  
**Quantization**: AWQ INT4 (pre-quantized safetensors, group size 128)  
**Why this model**: The model card explicitly calls out improved instruction following and generating structured outputs (especially JSON), which is exactly what you want for “perfect JSON formatting” and tool-like behavior. citeturn32view0  
**Why this quant**: AWQ is supported on Ampere in vLLM; Marlin support exists on Ampere for AWQ/GPTQ kernels, but the bigger point is that AWQ reduces weight memory enough to make a 32B manager feasible within 24GB. citeturn35view0

**Architecture parameters (for KV math)**: 64 layers; 8 KV heads; head_dim 128 (from config). citeturn5view0

**KV cache budget math (FP16 KV, single sequence)**  
Using KV/token = 2 × 64 × 8 × 128 × 2 bytes ≈ 262,144 bytes/token. citeturn13search13turn5view0  
That yields approximate KV usage:
- 8,192 tokens ≈ 2.0 GiB KV  
- 12,288 tokens ≈ 3.0 GiB KV citeturn13search13turn5view0

**Fit recommendation that stays below 24GB with margin**  
- Set `--max-model-len 8192`  
- Set `--max-num-seqs 1`  
- Treat this manager as a “single active session” engine; don’t waste VRAM on concurrency here.

This is the tightest lane on your hardware because the 32B AWQ weights are large (repo footprint ~19.3GB). If you let context creep upward, you will OOM from KV cache. citeturn4view0turn13search7

**Reliability upgrade (strongly recommended)**  
Use vLLM structured outputs with JSON Schema for every “final answer” payload. vLLM supports JSON-schema constrained decoding in its OpenAI-compatible API. citeturn37view0turn30search3

### Worker fleet lane

**Model**: `Qwen/Qwen2.5-7B-Instruct-AWQ`  
**Quantization**: AWQ INT4  
**Why this model**: Small enough to be fast, but still a modern instruct model; its KV cache footprint is dramatically smaller than 32B/70B class models, enabling long-context extraction jobs and concurrent sequences on a single 24GB card. citeturn6view0turn8view0  
**Key point**: You do **not** want “three separate model instances” eating three copies of weights. You want **one** vLLM server that supports multiple concurrent sequences. That gives you three (or more) agents in parallel without tripling VRAM. vLLM’s `max_num_seqs` is the correct mechanism here. citeturn13search7turn23search2

**Architecture parameters (for KV math)**: 28 layers; 4 KV heads; head_dim 128. citeturn8view0

**KV cache budget math (FP16 KV, three concurrent sequences)**  
Approx KV usage per sequence:
- 32,768 tokens ≈ 1.75 GiB KV per sequence  
Three sequences at 32k each ≈ 5.25 GiB KV. citeturn13search13turn8view0

Given weights are ~5.58GB on disk for this AWQ repo, you have ample headroom for:
- long-context chunk analysis, and  
- multiple simultaneous extraction/summarization jobs. citeturn7view0

**Fit recommendation that is realistically safe**  
- Set `--max-model-len 32768`  
- Set `--max-num-seqs 3` (or 4–6 if you later want more parallelism; tune by observing vLLM’s startup KV-cache logs). citeturn13search7turn34view0

### Deep dive lane

You asked for “absolute smartest dense model across the full 48GB pool” with tensor parallelism. With your constraints, that’s a 70B-class dense instruct model in 4-bit.

**Model**: `ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4`  
**Quantization**: AWQ INT4  
**Why this model**: The quant repo explicitly states ~35 GiB VRAM is required just to load the checkpoint (excluding KV cache and CUDA graphs) and was produced/validated on 2× RTX 3090 hardware, which is directly relevant to your exact setup. citeturn24view0turn25view0  
**Architecture parameters (for KV math)**: 80 layers; 8 KV heads; head_dim 128; max position embeddings 131,072. citeturn26view0

**KV cache math**  
If stored in FP16, KV for this architecture is approximately:
- 4,096 tokens ≈ 1.25 GiB  
- 8,192 tokens ≈ 2.5 GiB citeturn13search13turn26view0

**Fit recommendation that’s “boringly safe” on 2×24GB without NVLink**  
- Use `--tensor-parallel-size 2`  
- Set `--max-model-len 4096` initially  
- Only raise to `8192` if the startup logs show adequate KV headroom and you’re not hitting CUDA-graph memory surprises. vLLM will print KV cache size and estimated maximum concurrency at startup. citeturn34view0turn13search3

**Blunt reality**: a 70B 4-bit model on 2×3090 without NVLink is “big brain” but not “big throughput.” Expect noticeably slower tokens/sec and higher latency than your 7B worker fleet. That’s normal; the point of this lane is capability, not speed. citeturn34view0turn24view0

## Deployment parameters and exact launch commands

### Quantization format decision

For your environment and requirement set:

- **AWQ** is the default recommendation under entity["organization","vLLM","llm inference engine"] on Ampere (3090 class). AWQ is supported on Ampere, and Marlin kernels exist on Ampere for AWQ/GPTQ/FP8 variants. citeturn35view0  
- **GGUF** in vLLM exists but is explicitly labeled “highly experimental and under-optimized” and only supports single-file GGUF, which is hostile to production reliability and to features you likely care about (structured outputs, tool parsing, etc.). citeturn22search1  
- **EXL2** is not properly supported in vLLM (it’s primarily an ExLlamaV2 ecosystem format). citeturn22search0  

So: stick to **AWQ** for all three lanes if you’re staying in vLLM.

### Manager server on GPU 0

Use the OpenAI-compatible vLLM server, pin to GPU 0 via `CUDA_VISIBLE_DEVICES`. citeturn23search23turn23search7

```bash
CUDA_VISIBLE_DEVICES=0 \
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
  --dtype half \
  --max-model-len 8192 \
  --max-num-seqs 1 \
  --gpu-memory-utilization 0.92 \
  --enforce-eager
```

Why `--enforce-eager`: Qwen’s own vLLM deployment notes flag that CUDA Graphs can consume memory not controlled by vLLM, and recommends lowering `gpu-memory-utilization` or using eager mode when you see OOM surprises. This is the conservative choice for a manager whose job is correctness, not max throughput. citeturn29view0turn23search2

If you want even tighter deterministic control, you can replace the utilization cap with an explicit KV cache budget via `--kv-cache-memory-bytes`. citeturn36search0turn33view0

### Worker server on GPU 1

```bash
CUDA_VISIBLE_DEVICES=1 \
vllm serve Qwen/Qwen2.5-7B-Instruct-AWQ \
  --dtype half \
  --max-model-len 32768 \
  --max-num-seqs 3 \
  --gpu-memory-utilization 0.90
```

This configuration is designed so you can run three independent “agent sessions” concurrently against the same model server without multiple weight copies, and still keep long contexts for chunked HTML/PDF text. citeturn13search7turn23search2turn8view0

### Deep dive server across both GPUs with tensor parallelism

```bash
CUDA_VISIBLE_DEVICES=0,1 \
vllm serve ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4 \
  --dtype half \
  --tensor-parallel-size 2 \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.92 \
  --enforce-eager
```

Notes you should not ignore:

vLLM’s parallelism guidance explicitly warns that if GPUs lack NVLINK interconnect, pipeline parallelism may give better throughput/lower overhead than tensor parallelism; tensor parallelism still works, but it is not automatically the best choice on PCIe-only multi-GPU. citeturn34view0

The model’s quant README states ~35 GiB VRAM is needed just to load the checkpoint (excluding KV cache/CUDA graphs). With tensor parallelism, that weight memory is split across GPUs, but you still need to budget KV cache on top. citeturn24view0turn26view0

## Operational guardrails for “no refusals, no hallucinations” in investigative OSINT

You cannot “model-pick” your way out of the refusal/hallucination trade space. You system-design your way out.

The hard-nosed approach that holds up in practice is:

Use vLLM structured outputs + JSON Schema for any output that must be machine-consumable (entity records, timelines, allegation maps, source indexes). This eliminates “format drift,” even when the model is under stress. citeturn37view0turn30search3

Treat every claim as requiring evidence IDs. Your workers should output extracted facts as a structured list with precise provenance (URL, document ID, page number, quoted span). Then the manager is only allowed to reason over those evidence snippets and must cite them. This is consistent with mainstream hallucination reduction guidance: grounding + verification loops outperform “better prompting alone.” citeturn30search27turn30search9

Run an automated “citation integrity” check. The most common failure mode in RAG pipelines is the model producing plausible citations that do not actually support the sentence. You want a deterministic post-check (string overlap, embedding similarity, or exact-quote validation) before any report is considered evidentiary. citeturn30search27turn37view0

Finally, for OSINT involving named individuals and litigation/medical governance: position your “manager model” explicitly as an **analyst that must abstain** when evidence is thin. This is not vibes; it is necessary because LLMs are still vulnerable to confident completion under ambiguity, as documented widely in hallucination surveys. citeturn30search9turn30search10