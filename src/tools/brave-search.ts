// Valor AI -- Brave Search Tool Adapter
// Owner: Claude Code | TASK-007
// Integrated by Codex with the frozen ToolAdapter contract.

import * as dotenv from 'dotenv';
import type {
  FailureMetadata,
  ToolAdapter,
  ToolExecutionInput,
  ToolExecutionResult,
} from '../agents/types';
import { ToolName } from '../utils/rateLimiter';

dotenv.config();

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveSearchResult[];
  };
  query?: {
    original: string;
  };
}

export class BraveSearchAdapter implements ToolAdapter {
  name: ToolName = 'brave';
  description = 'Web search via the Brave Search API';
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.search.brave.com/res/v1/web/search';

  constructor() {
    this.apiKey = process.env.BRAVE_SEARCH_API_KEY || '';
    if (!this.isConfigured()) {
      console.warn('[BraveSearch] No API key found (BRAVE_SEARCH_API_KEY). Adapter disabled.');
    }
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const startedAt = new Date().toISOString();

    if (!this.isConfigured()) {
      return this.buildFailureResult(
        startedAt,
        'Brave Search API key not configured',
        { query: input.query },
      );
    }

    try {
      const cleanedQuery = this.cleanQuery(input.query);
      console.log(`[BraveSearch] Cleaned query: "${cleanedQuery}"`);
      const url = `${this.baseUrl}?q=${encodeURIComponent(cleanedQuery)}&count=${input.maxResults ?? 10}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Brave API ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as BraveSearchResponse;
      const results = data.web?.results || [];
      const normalizedText = results
        .map(
          (result, index) =>
            `[${index + 1}] ${result.title}\n` +
            `URL: ${result.url}\n` +
            `${result.description}${result.age ? ` (${result.age})` : ''}`,
        )
        .join('\n\n');

      return {
        adapter: this.name,
        status: results.length > 0 ? 'success' : 'partial',
        startedAt,
        completedAt: new Date().toISOString(),
        normalizedText: normalizedText || 'No results found.',
        metadata: {
          query: data.query?.original ?? input.query,
          resultCount: results.length,
        },
        artifacts: [
          {
            type: 'search_results',
            title: `Brave Search results for "${input.query}"`,
            source: 'Brave Search API',
            sourceUrl: `https://search.brave.com/search?q=${encodeURIComponent(input.query)}`,
            content: normalizedText || 'No results found.',
            metadata: {
              investigationId: input.investigationId,
              assignmentId: input.assignmentId,
            },
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Brave Search failure';
      return this.buildFailureResult(startedAt, message, { query: input.query });
    }
  }

  private cleanQuery(raw: string): string {
    return raw
      .replace(/\(\d{3}\)[\s-]?\d{3}[\s-]?\d{4}/g, '')
      .replace(/\d{3}[\s-]\d{3}[\s-]\d{4}/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[+]/g, ' ')
      .replace(/--/g, ' ')
      .replace(/[.]{1,}$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private buildFailureResult(
    startedAt: string,
    reason: string,
    details?: Record<string, unknown>,
  ): ToolExecutionResult {
    return {
      adapter: this.name,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      artifacts: [],
      failure: this.buildFailure(reason, details),
    };
  }

  private buildFailure(
    reason: string,
    details?: Record<string, unknown>,
  ): FailureMetadata {
    return {
      stage: 'tool',
      reason,
      retryable: true,
      occurredAt: new Date().toISOString(),
      details,
    };
  }
}

export const braveSearch = new BraveSearchAdapter();
