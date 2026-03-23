// Valor AI -- Shared Rate Limiters
// All workers share these limiters to prevent API hammering.

import Bottleneck from 'bottleneck';
import * as dotenv from 'dotenv';

dotenv.config();

// Apify -- conservative, 1 at a time with spacing
export const apifyLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: parseInt(process.env.APIFY_MIN_TIME_MS || '3000'),
});

// Firecrawl -- 2 concurrent, moderate spacing
export const firecrawlLimiter = new Bottleneck({
  maxConcurrent: 2,
  minTime: parseInt(process.env.FIRECRAWL_MIN_TIME_MS || '1000'),
});

// Brave Search -- generous free tier
export const braveLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: parseInt(process.env.BRAVE_MIN_TIME_MS || '200'),
});

// Local LLM -- unlimited (your hardware)
export const localLlmLimiter = new Bottleneck({
  maxConcurrent: 3, // match worker count
  minTime: 0,
});

// Human jitter to avoid pattern detection
export function sleep(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
