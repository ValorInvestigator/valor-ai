# Valor AI -- Deployment Specification v1.0

Consolidated from 5 independent research sources (Compass/Claude, ChatGPT, Gemini Deep Dive, Antigravity Manager Plan, NotebookLM). All sources converge on the same core stack.

## Hardware

- 2x NVIDIA RTX 3090 (24GB GDDR6X each, 48GB total)
- No NVLink (PCIe 4.0 x8 interconnect, ~16 GB/s bidirectional)
- Compute Capability 8.6 (Ampere / GA102)
- Windows 11 Pro, WSL2 + Docker for vLLM

## Quantization: AWQ 4-bit Only

All sources agree: AWQ with Marlin kernels is the only production-grade format for vLLM on Ampere.

| Format | vLLM Support | Throughput | Verdict |
|--------|-------------|------------|---------|
| AWQ + Marlin | Full | 741 tok/s | USE THIS |
| GPTQ + Marlin | Full | 712 tok/s | Good alternative |
| GGUF | Experimental | 93 tok/s | Use llama.cpp instead |
| EXL2 | None | N/A | Incompatible with vLLM |
| FP8 | Unstable on Ampere | Varies | Avoid on 3090 |

## Lane 1: Manager (GPU 0, 24GB)

**Model: `huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated-AWQ`**

- 32.5B params, AWQ 4-bit
- Weights: ~17.9 GB
- CUDA overhead: ~1.2 GB
- KV cache: ~3-5 GB (8K-12K context)
- Total: ~22 GB
- Headroom: ~2 GB

Why this model:
- R1 distillation = visible chain-of-thought reasoning (auditable for evidentiary work)
- Qwen 2.5 base = rock-solid JSON output and tool calling
- huihui-ai abliteration = surgical refusal vector removal, zero OSINT refusals
- 94.3% MATH-500, 72.6% AIME 2024, outperforms o1-mini
- Pre-quantized AWQ = drop-in for vLLM, no conversion needed

```bash
docker run -d --name vllm-manager \
  --gpus "device=0" \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HF_TOKEN=$HF_TOKEN \
  -p 8000:8000 \
  --ipc=host --shm-size=8g \
  vllm/vllm-openai:latest \
  --model huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated-AWQ \
  --quantization awq \
  --dtype half \
  --max-model-len 8192 \
  --max-num-seqs 1 \
  --gpu-memory-utilization 0.92 \
  --enforce-eager
```

## Lane 2: Worker Fleet (GPU 1, 24GB)

**Model: `Qwen/Qwen3-8B-AWQ`**

- 8B params, AWQ 4-bit
- Weights: ~4.0 GB
- CUDA overhead: ~1.5 GB
- KV cache pool: ~16.5 GB (shared across ALL concurrent requests)
- Total: ~22 GB
- Headroom: ~2 GB

ONE model instance handles ALL concurrent worker requests via vLLM continuous batching.
No need for 3 separate loads. PagedAttention allocates KV cache on demand per request.

- 3 concurrent requests at 8K context = ~1.3 GB KV (out of 16.5 GB available)
- 16 concurrent requests at 16K context = still fits
- Upgrade path: Qwen3.5-9B-Instruct AWQ when available (78.1 OlmOCR, beats Claude on extraction)

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

## Lane 3: Deep Dive (Both GPUs, 48GB, TP=2)

**Model: `ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4`**

- 70B params, AWQ 4-bit, tensor parallel across 2 GPUs
- Weights: ~35 GB (~17.5 GB per GPU)
- CUDA overhead: ~3.5 GB (~1.75 per GPU)
- KV cache: ~5.7 GB (~2.83 per GPU)
- Total: ~44 GB (~22 GB per GPU)
- Context: 8K-16K tokens (32K with FP8 KV cache)

Requires shutting down Lane 1 + Lane 2 first. Both GPUs serve one model.

No NVLink penalty: ~32% slower than NVLink (483 tok/s vs 715 tok/s at TP=2).
Expect 10-16 tok/s decode, 2-5 second time-to-first-token. Fine for deep analysis.

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

## Docker Compose (Lane 1 + Lane 2 simultaneous)

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
      --model huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated-AWQ
      --quantization awq
      --dtype half
      --max-model-len 8192
      --max-num-seqs 1
      --gpu-memory-utilization 0.92
      --enforce-eager

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

## Mode Switching

**Mode A (Standard):** `docker compose up -d` -- Manager on GPU 0, Workers on GPU 1
**Mode B (Deep Dive):** `docker compose down` then launch Lane 3 container

## Infrastructure Requirements

1. WSL2 enabled (Ubuntu 24.04 LTS)
2. NVIDIA driver on Windows host (do NOT install CUDA inside WSL)
3. Docker Desktop 4.54+ with WSL2 backend (or Docker Engine in WSL2)
4. NVIDIA Container Toolkit installed in WSL2
5. Redis (for BullMQ job queue)
6. HuggingFace token ($HF_TOKEN)

## Valor AI Integration

Both endpoints expose OpenAI-compatible APIs:
- Manager: `http://localhost:8000/v1/chat/completions`
- Workers: `http://localhost:8001/v1/chat/completions`

The `src/llm/client.ts` OpenAI SDK client works unchanged -- just point `VLLM_BASE_URL` at the right port.

## Research Sources

- `docs/research/compass_dual_3090_blueprint.md` -- Compass/Claude analysis
- `docs/research/chatgpt_dual_3090_research.md` -- ChatGPT research
- `docs/research/gemini_dual_3090_deep_dive.md` -- Gemini exhaustive analysis
- `docs/research/antigravity_manager_plan.md` -- Antigravity manager architecture
- `docs/research/notebooklm_consolidated_report.txt` -- NotebookLM consolidation
