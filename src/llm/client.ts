// Valor AI -- Unified LLM Client with Fallback Chain
// Owner: Claude Code | TASK-006
// Talks to local vLLM, xAI, or Claude using the same OpenAI SDK interface.
// Graceful degradation: never crashes, returns null provider info when all fail.

import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import type { LLMProviderName } from '../agents/types';

dotenv.config();

// --- Types ---

export interface LLMProvider {
  name: LLMProviderName;
  client: OpenAI;
  model: string;
  available: boolean;
}

export interface LLMResponse {
  content: string;
  provider: LLMProviderName;
  model: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface LLMRequestOptions {
  preferredProvider?: LLMProviderName;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

// --- Provider Setup ---

function buildProviders(): LLMProvider[] {
  const list: LLMProvider[] = [];

  // Local Ollama -- Nemotron-Mini (Fast autonomous loop system)
  // Unified Architecture: Workers and Manager both traffic-control through Ollama directly
  list.push({
    name: 'nemotron',
    client: new OpenAI({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      timeout: 120000, 
    }),
    model: process.env.NEMOTRON_MODEL || 'nemotron-mini',
    available: true,
  });

  // Dedicated Manager Ollama -- (Genius 70B model natively bound to VRAM limits)
  list.push({
    name: 'ollama',
    client: new OpenAI({
      baseURL: process.env.MANAGER_OLLAMA_URL || 'http://localhost:11434/v1',
      apiKey: 'ollama',
      timeout: 300000, 
    }),
    model: process.env.MANAGER_OLLAMA_MODEL || 'nemotron:70b',
    available: true,
  });

  // xAI Grok (paid, strong reasoning)
  if (process.env.XAI_API_KEY) {
    list.push({
      name: 'xai',
      client: new OpenAI({
        baseURL: 'https://api.x.ai/v1',
        apiKey: process.env.XAI_API_KEY,
        timeout: 60000,
      }),
      model: process.env.XAI_MODEL || 'grok-4-1-fast-reasoning',
      available: true,
    });
  }

  // Claude (paid, top-tier reasoning for complex synthesis)
  if (process.env.ANTHROPIC_API_KEY) {
    list.push({
      name: 'claude',
      client: new OpenAI({
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: process.env.ANTHROPIC_API_KEY,
        timeout: 60000,
      }),
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      available: true,
    });
  }

  return list;
}

const providers = buildProviders();

// --- Core Functions ---

/**
 * Send a chat completion with automatic fallback.
 * Tries local first, then xAI, then Claude.
 * Returns null if all providers fail (never throws).
 */
let ollamaSynthesisMutex: Promise<void> | null = null;

export async function chatCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: LLMRequestOptions
): Promise<LLMResponse | null> {
  // MUTEX: If the massive 33B model is currently synthesizing the Final Report natively on VRAM,
  // we vigorously restrict the asynchronous background Node Workers from executing any new 4B model
  // Map-Reduce chunks. This explicitly prevents Ollama from loading 36GB of models simultaneously into
  // the 48GB array, which saturates the PCIe bus and violently freezes the Windows OS ("Hijacking").
  if (options?.preferredProvider === 'nemotron' && ollamaSynthesisMutex) {
    console.warn('[LLM] Traffic Cop: Pausing tiny worker Map-Reduce chunk while 33B Manager node writes the Final Report...');
    await ollamaSynthesisMutex;
  }

  let releaseMutex: Function | null = null;
  if (options?.preferredProvider === 'ollama') {
    ollamaSynthesisMutex = new Promise((resolve) => {
      releaseMutex = resolve;
    });
  }

  const cleanupMutex = () => {
    if (releaseMutex) {
      releaseMutex();
      ollamaSynthesisMutex = null;
    }
  };

  // Build the provider chain with preferred provider first
    const chain = options?.preferredProvider
    ? [
        ...providers.filter((p) => p.name === options.preferredProvider && p.available),
        ...providers.filter((p) => p.name !== options.preferredProvider && p.available),
      ]
    : providers.filter((p) => p.available);

  if (chain.length === 0) {
    console.error('[LLM] No providers available. System should mark investigation as stalled.');
    return null;
  }

  // Prepend system prompt if provided
  const finalMessages = options?.systemPrompt
    ? [{ role: 'system' as const, content: options.systemPrompt }, ...messages]
    : messages;

  for (const provider of chain) {
    const startTime = Date.now();
    try {
      // Shrink max_tokens for the 70B model to mechanically suppress Ollama's KV-Cache expansion,
      // thereby guaranteeing the 42GB model physically fits inside the dual 3090 VRAM limit.
      const artificialMaxTokens = provider.name === 'ollama' ? 1500 : (options?.maxTokens ?? 4096);
      
      const completion = await provider.client.chat.completions.create({
        model: provider.model,
        messages: finalMessages,
        ...(options?.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        max_tokens: artificialMaxTokens,
      });

      const content = completion.choices[0]?.message?.content || '';
      const promptTokens = completion.usage?.prompt_tokens || 0;
      const completionTokens = completion.usage?.completion_tokens || 0;

      const responsePayload = {
        content,
        provider: provider.name,
        model: provider.model,
        tokensUsed: promptTokens + completionTokens,
        promptTokens,
        completionTokens,
        durationMs: Date.now() - startTime,
      };
      cleanupMutex();
      return responsePayload;
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      console.warn(`[LLM] ${provider.name} failed (${elapsed}ms): ${err.message}. Trying next...`);

      // If local vLLM is down, mark it unavailable for this session
      // so we don't waste time retrying on every call
      if (err.message.includes('ECONNREFUSED')) {
        provider.available = false;
        console.warn(`[LLM] Flagged provider ${provider.name} as offline indefinitely.`);
      }
    }
  }

  cleanupMutex();
  return null;
}

/**
 * Request structured JSON output from the LLM.
 * Parses the response and returns the object, or null on failure.
 */
export async function jsonCompletion<T = any>(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: Omit<LLMRequestOptions, 'jsonMode'>
): Promise<{ data: T; meta: Omit<LLMResponse, 'content'> } | null> {
  const response = await chatCompletion(messages, { ...options, jsonMode: true });
  if (!response) return null;

  try {
    const data = JSON.parse(response.content) as T;
    const { content, ...meta } = response;
    return { data, meta };
  } catch (parseErr: any) {
    console.error(`[LLM] JSON parse failed from ${response.provider}: ${parseErr.message}`);
    // Try to extract JSON from markdown code blocks
    const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1].trim()) as T;
        const { content, ...meta } = response;
        return { data, meta };
      } catch {
        // give up
      }
    }
    return null;
  }
}

// --- Utility ---

function isConnectionError(err: any): boolean {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT'
  );
}

/**
 * Get list of currently available providers.
 */
export function getAvailableProviders(): string[] {
  return providers.filter((p) => p.available).map((p) => p.name);
}

/**
 * Check if any LLM provider is available.
 * If false, the system should mark investigations as stalled.
 */
export function hasAvailableProvider(): boolean {
  return providers.some((p) => p.available);
}

/**
 * Re-enable local provider (e.g., after vLLM comes back online).
 */
export function reenableLocalProvider(): void {
  const local = providers.find((p) => p.name === 'local');
  if (local) {
    local.available = true;
    console.log('[LLM] Local vLLM re-enabled.');
  }
}
