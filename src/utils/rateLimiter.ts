// Valor AI -- Shared Rate Limiter with acquire/release interface
// Owner: Claude Code | TASK-008
// All workers share these limiters to prevent API hammering.
// Uses Bottleneck for per-tool rate limiting with configurable limits.

import Bottleneck from 'bottleneck';
import * as dotenv from 'dotenv';

dotenv.config();

// --- Types ---

export type ToolName = 'apify' | 'firecrawl' | 'brave' | 'courtlistener' | 'bigquery' | 'osint' | 'local_llm';

interface LimiterConfig {
  maxConcurrent: number;
  minTimeMs: number;
  reservoir?: number;       // max calls per window
  reservoirRefreshInterval?: number; // window size in ms
}

// --- Default Configs ---

const DEFAULT_CONFIGS: Record<ToolName, LimiterConfig> = {
  apify: {
    maxConcurrent: 1,
    minTimeMs: parseInt(process.env.APIFY_MIN_TIME_MS || '3000'),
  },
  firecrawl: {
    maxConcurrent: 2,
    minTimeMs: parseInt(process.env.FIRECRAWL_MIN_TIME_MS || '1000'),
  },
  brave: {
    maxConcurrent: 5,
    minTimeMs: parseInt(process.env.BRAVE_MIN_TIME_MS || '200'),
    reservoir: 2000,
    reservoirRefreshInterval: 30 * 24 * 60 * 60 * 1000, // 30 days (free tier)
  },
  courtlistener: {
    maxConcurrent: 1,
    minTimeMs: 2000,
  },
  bigquery: {
    maxConcurrent: 3,
    minTimeMs: 500,
  },
  osint: {
    maxConcurrent: 1,
    minTimeMs: 5000, // conservative for username lookups
  },
  local_llm: {
    maxConcurrent: 3, // match worker count
    minTimeMs: 0,     // unlimited on local hardware
  },
};

// --- Limiter Registry ---

const limiters = new Map<ToolName, Bottleneck>();

function getLimiter(tool: ToolName): Bottleneck {
  let limiter = limiters.get(tool);
  if (!limiter) {
    const config = DEFAULT_CONFIGS[tool];
    if (!config) {
      throw new Error(`[RateLimiter] Unknown tool: ${tool}`);
    }
    limiter = new Bottleneck({
      maxConcurrent: config.maxConcurrent,
      minTime: config.minTimeMs,
      ...(config.reservoir ? { reservoir: config.reservoir } : {}),
      ...(config.reservoirRefreshInterval
        ? { reservoirRefreshInterval: config.reservoirRefreshInterval }
        : {}),
    });
    limiters.set(tool, limiter);
  }
  return limiter;
}

// --- Public API ---

/**
 * Acquire a rate limit slot for a tool. Resolves when the slot is available.
 * The returned function must be called to release the slot.
 *
 * Usage:
 *   const release = await acquire('apify');
 *   try {
 *     await doApifyCall();
 *   } finally {
 *     release();
 *   }
 */
export async function acquire(tool: ToolName): Promise<() => void> {
  const limiter = getLimiter(tool);
  let releaseGate: (() => void) | null = null;

  const holdSlot = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const acquired = new Promise<() => void>((resolve) => {
    void limiter.schedule(async () => {
      let released = false;
      resolve(() => {
        if (!released && releaseGate) {
          released = true;
          releaseGate();
          releaseGate = null;
        }
      });

      await holdSlot;
    });
  });

  return acquired;
}

/**
 * Execute a function within a rate limit slot.
 * Simpler API when you don't need manual release control.
 *
 * Usage:
 *   const result = await withRateLimit('brave', () => braveSearch(query));
 */
export async function withRateLimit<T>(tool: ToolName, fn: () => Promise<T>): Promise<T> {
  const limiter = getLimiter(tool);
  return limiter.schedule(fn);
}

/**
 * Get current limiter stats for monitoring.
 */
export function getLimiterStats(tool: ToolName): {
  running: number;
  queued: number;
  done: number;
} {
  const limiter = getLimiter(tool);
  const counts = limiter.counts();
  return {
    running: counts.RUNNING ?? 0,
    queued: counts.QUEUED ?? 0,
    done: counts.DONE ?? 0,
  };
}

/**
 * Get stats for all tools.
 */
export function getAllLimiterStats(): Record<ToolName, ReturnType<typeof getLimiterStats>> {
  const stats: Partial<Record<ToolName, ReturnType<typeof getLimiterStats>>> = {};
  for (const tool of Object.keys(DEFAULT_CONFIGS) as ToolName[]) {
    stats[tool] = getLimiterStats(tool);
  }
  return stats as Record<ToolName, ReturnType<typeof getLimiterStats>>;
}

// --- Jitter utility ---

/**
 * Random delay to avoid pattern detection on external APIs.
 */
export function jitter(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
