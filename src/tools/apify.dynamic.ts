import { ApifyClient } from 'apify-client';
import * as dotenv from 'dotenv';
import type {
  FailureMetadata,
  ToolAdapter,
  ToolExecutionInput,
  ToolExecutionResult,
} from '../agents/types';
import { ToolName } from '../utils/rateLimiter';

dotenv.config();

export class ApifyAdapter implements ToolAdapter {
  name: ToolName = 'apify';
  description = 'Advanced scraping Actor execution via Apify platform';
  private client: ApifyClient | null = null;

  constructor() {
    const token = process.env.APIFY_API_TOKEN || '';
    if (token) {
      this.client = new ApifyClient({ token });
    } else {
      console.warn('[Apify] No API token found (APIFY_API_TOKEN). Adapter disabled.');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const startedAt = new Date().toISOString();

    if (!this.client) {
      return this.buildFailureResult(startedAt, 'Apify token not configured', { query: input.query });
    }

    try {
      const cleanedQuery = this.cleanQuery(input.query);
      
      const actorId = (input.metadata?.actorId as string) || 'apify/google-search-scraper';
      console.log(`[Apify] Executing Actor: ${actorId} with cleaned query: "${cleanedQuery}"`);

      // Actor input schema can vary widely
      const runOptions = {
        queries: cleanedQuery,
        searchTerms: cleanedQuery,
        query: cleanedQuery,
        maxPagesPerQuery: 1,
        resultsPerPage: input.maxResults ?? 10,
        ...((input.metadata?.runOptions as Record<string, unknown>) || {})
      };

      const run = await this.client.actor(actorId).call(runOptions as Record<string, unknown>);
      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

      const normalizedText = items
        .map((result: any, index: number) => {
          const title = result.title || result.name || result.headline || 'Item';
          const url = result.url || result.link || 'No URL';
          const details = result.description || result.text || result.content || JSON.stringify(result).slice(0, 200);
          return `[${index + 1}] ${title}\nURL: ${url}\n${details}`;
        })
        .join('\n\n');

      return {
        adapter: this.name,
        status: items.length > 0 ? 'success' : 'partial',
        startedAt,
        completedAt: new Date().toISOString(),
        normalizedText: normalizedText || 'No results found from Actor.',
        metadata: {
          query: input.query,
          actorId,
          resultCount: items.length,
          runId: run.id,
        },
        artifacts: [
          {
            type: 'search_results',
            title: `Apify Actor (${actorId}) results for "${input.query}"`,
            source: `Apify Platform -> ${actorId}`,
            content: normalizedText || 'No results found.',
            metadata: {
              investigationId: input.investigationId,
              assignmentId: input.assignmentId,
              rawJson: items.slice(0, 5),
            },
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Apify Actor failure';
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

export const apify = new ApifyAdapter();
