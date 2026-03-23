// Valor AI -- Unified LLM Client with Fallback Chain
// Talks to local vLLM, xAI, or Claude using the same OpenAI SDK interface.

import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

interface LLMProvider {
  name: string;
  client: OpenAI;
  model: string;
}

// Build the fallback chain: local -> xAI -> claude
const providers: LLMProvider[] = [];

// Local vLLM (free, on your 3090s)
if (process.env.VLLM_BASE_URL) {
  providers.push({
    name: 'local',
    client: new OpenAI({
      baseURL: process.env.VLLM_BASE_URL,
      apiKey: 'not-needed',
    }),
    model: process.env.LOCAL_MODEL || 'Qwen/Qwen3-32B-AWQ',
  });
}

// xAI Grok (paid, strong reasoning)
if (process.env.XAI_API_KEY) {
  providers.push({
    name: 'xai',
    client: new OpenAI({
      baseURL: 'https://api.x.ai/v1',
      apiKey: process.env.XAI_API_KEY,
    }),
    model: process.env.XAI_MODEL || 'grok-4-1-fast-reasoning',
  });
}

// Claude (paid, top-tier reasoning for complex synthesis)
if (process.env.ANTHROPIC_API_KEY) {
  providers.push({
    name: 'claude',
    client: new OpenAI({
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: process.env.ANTHROPIC_API_KEY,
    }),
    model: 'claude-sonnet-4-6',
  });
}

/**
 * Send a chat completion with automatic fallback.
 * Tries local first, then xAI, then Claude.
 */
export async function chatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: { preferredProvider?: string; jsonMode?: boolean }
): Promise<{ content: string; provider: string; tokensUsed: number }> {
  const chain = options?.preferredProvider
    ? [
        ...providers.filter((p) => p.name === options.preferredProvider),
        ...providers.filter((p) => p.name !== options.preferredProvider),
      ]
    : providers;

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
  return providers.map((p) => p.name);
}
