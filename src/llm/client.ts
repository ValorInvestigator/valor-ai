// Valor AI -- Unified LLM Client with Role-Based Routing
// Manager (GPU 0, port 8000) and Workers (GPU 1, port 8001) are separate vLLM instances.
// Cloud providers (xAI, Claude) serve as fallback for when local GPUs are unavailable.

import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

export type LLMRole = 'manager' | 'worker' | 'deepdive';

interface LLMProvider {
  name: string;
  client: OpenAI;
  model: string;
  role: LLMRole | 'cloud'; // cloud = fallback for any role
}

const providers: LLMProvider[] = [];

// Local vLLM -- Manager on GPU 0 (DeepSeek-R1-Distill-Qwen-32B-abliterated-AWQ)
if (process.env.VLLM_MANAGER_URL) {
  providers.push({
    name: 'local-manager',
    client: new OpenAI({
      baseURL: process.env.VLLM_MANAGER_URL,
      apiKey: 'not-needed',
    }),
    model: process.env.MANAGER_MODEL || 'huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated-AWQ',
    role: 'manager',
  });
}

// Local vLLM -- Workers on GPU 1 (Qwen3-8B-AWQ, continuous batching)
if (process.env.VLLM_WORKER_URL) {
  providers.push({
    name: 'local-worker',
    client: new OpenAI({
      baseURL: process.env.VLLM_WORKER_URL,
      apiKey: 'not-needed',
    }),
    model: process.env.WORKER_MODEL || 'Qwen/Qwen3-8B-AWQ',
    role: 'worker',
  });
}

// Local vLLM -- Deep Dive across both GPUs (Llama-3.3-70B-AWQ, TP=2)
if (process.env.VLLM_DEEPDIVE_URL) {
  providers.push({
    name: 'local-deepdive',
    client: new OpenAI({
      baseURL: process.env.VLLM_DEEPDIVE_URL,
      apiKey: 'not-needed',
    }),
    model: process.env.DEEPDIVE_MODEL || 'ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4',
    role: 'deepdive',
  });
}

// xAI Grok (cloud fallback)
if (process.env.XAI_API_KEY) {
  providers.push({
    name: 'xai',
    client: new OpenAI({
      baseURL: 'https://api.x.ai/v1',
      apiKey: process.env.XAI_API_KEY,
    }),
    model: process.env.XAI_MODEL || 'grok-4-1-fast-reasoning',
    role: 'cloud',
  });
}

// Claude (cloud fallback for complex synthesis)
if (process.env.ANTHROPIC_API_KEY) {
  providers.push({
    name: 'claude',
    client: new OpenAI({
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
    }),
    model: 'claude-sonnet-4-6',
    role: 'cloud',
  });
}

/**
 * Build a fallback chain for a given role.
 * Tries role-specific local model first, then cloud fallbacks.
 */
function getChainForRole(role: LLMRole): LLMProvider[] {
  const roleMatch = providers.filter((p) => p.role === role);
  const cloudFallbacks = providers.filter((p) => p.role === 'cloud');
  return [...roleMatch, ...cloudFallbacks];
}

/**
 * Send a chat completion routed by agent role.
 * Manager tasks hit GPU 0, worker tasks hit GPU 1, deep dive hits both.
 * Falls back to cloud if local is unavailable.
 */
export async function chatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    role?: LLMRole;
    preferredProvider?: string;
    jsonMode?: boolean;
  }
): Promise<{ content: string; provider: string; tokensUsed: number }> {
  let chain: LLMProvider[];

  if (options?.preferredProvider) {
    chain = [
      ...providers.filter((p) => p.name === options.preferredProvider),
      ...providers.filter((p) => p.name !== options.preferredProvider),
    ];
  } else if (options?.role) {
    chain = getChainForRole(options.role);
  } else {
    // Default: try manager, then worker, then cloud
    chain = [
      ...providers.filter((p) => p.role === 'manager'),
      ...providers.filter((p) => p.role === 'worker'),
      ...providers.filter((p) => p.role === 'cloud'),
    ];
  }

  for (const provider of chain) {
    try {
      const completion = await provider.client.chat.completions.create({
        model: provider.model,
        messages,
        ...(options?.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      });

      const content = completion.choices[0]?.message?.content || '';
      const tokensUsed =
        (completion.usage?.prompt_tokens || 0) + (completion.usage?.completion_tokens || 0);

      return { content, provider: provider.name, tokensUsed };
    } catch (err: any) {
      console.warn(`[LLM] ${provider.name} failed: ${err.message}. Trying next...`);
    }
  }

  throw new Error('[LLM] All providers failed. No LLM available.');
}

export function getAvailableProviders(): string[] {
  return providers.map((p) => `${p.name} (${p.role})`);
}
