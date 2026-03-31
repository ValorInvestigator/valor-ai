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
  description = 'Advanced scraping Actor execution via Apify — use only when Brave/CourtListener/Firecrawl cannot handle the task';
  private client: ApifyClient | null = null;
  private schemaCache = new Map<string, Record<string, unknown>>();

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
      // Clean the query: strip phone numbers, punctuation noise, and shorthand
      const cleanedQuery = this.cleanQuery(input.query);
      console.log(`[Apify] Cleaned query: "${cleanedQuery}" (from: "${input.query.slice(0, 80)}")`);

      // Dynamically select the exact Apify actor requested by the Planner
      let actorId = (input.metadata?.actorId as string) || 'apify/google-search-scraper';
      console.log(`[Apify] Executing Actor: ${actorId} with cleaned query: "${cleanedQuery}"`);

      // Fetch the actor's schema locally from cache, or download it if we've never seen it before
      let exampleInput = this.schemaCache.get(actorId);

      if (!exampleInput) {
        console.log(`[Apify] Downloading schema for ${actorId}...`);
        const actorInfo = await this.client.actor(actorId).get();
        exampleInput = (actorInfo?.exampleRunInput as unknown as Record<string, unknown>) || {};
        this.schemaCache.set(actorId, exampleInput);
      } else {
        console.log(`[Apify] Loaded schema for ${actorId} from local cache.`);
      }

      let payload: Record<string, unknown> = {};

      // Map the query dynamically into the correct primary argument EXACTLY as the actor schema specifies
      const isUrlCrawler = 'startUrls' in exampleInput || 'urls' in exampleInput || actorId.includes('website-content-crawler') || actorId.includes('web-scraper');
      const isUrl = cleanedQuery.startsWith('http://') || cleanedQuery.startsWith('https://');

      if (isUrlCrawler && !isUrl) {
        console.warn(`[Apify] Rejecting non-URL query for crawler ${actorId}: "${cleanedQuery}". Falling back to google-search-scraper.`);
        actorId = 'apify/google-search-scraper';
        payload.queries = cleanedQuery;
      } else if ('startUrls' in exampleInput || actorId.includes('website-content-crawler') || actorId.includes('web-scraper')) {
        payload.startUrls = [{ url: cleanedQuery }];
      } else if ('urls' in exampleInput) {
        payload.urls = [{ url: cleanedQuery }];
      } else if ('queries' in exampleInput) {
        payload.queries = cleanedQuery;
      } else if ('searchTerms' in exampleInput) {
        payload.searchTerms = cleanedQuery;
      } else if ('search' in exampleInput) {
        payload.search = cleanedQuery;
      } else if ('query' in exampleInput) {
        payload.query = cleanedQuery;
      } else if ('url' in exampleInput) {
        payload.url = cleanedQuery;
      } else {
        payload.queries = cleanedQuery; // fallback
      }

      // Add pagination configurations — BUDGET-SAFE defaults
      payload.resultsPerPage = input.maxResults ?? 10;
      if (actorId === 'apify/google-search-scraper' || (!payload.startUrls && !payload.urls)) {
        payload.maxPagesPerQuery = 1;
      } else {
        // Tight limits to prevent credit burn (was 100/4, now 5/1)
        payload.maxCrawlPages = 5;
        payload.maxCrawlDepth = 1;
      }

      console.log(`[Apify] Built dynamic payload keys: ${Object.keys(payload).join(', ')}`);
      const run = await this.client.actor(actorId).call(payload);

      const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

      const normalizedText = items
        .map(
          (result: any, index: number) =>
            `[${index + 1}] ${result.title}\n` +
            `URL: ${result.url}\n` +
            `${result.description}`
        )
        .join('\n\n');

      return {
        adapter: this.name,
        status: items.length > 0 ? 'success' : 'partial',
        startedAt,
        completedAt: new Date().toISOString(),
        normalizedText: normalizedText || 'No results found.',
        metadata: {
          query: input.query,
          resultCount: items.length,
          runId: run.id,
        },
        artifacts: [
          {
            type: 'search_results',
            title: `Apify Deep Search results for "${input.query}"`,
            source: 'Apify Actor (google-search-scraper)',
            content: normalizedText || 'No results found.',
            metadata: {
              investigationId: input.investigationId,
              assignmentId: input.assignmentId,
            },
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Apify Actor failure';
      return this.buildFailureResult(startedAt, message, { query: input.query });
    }
  }

  /**
   * Clean raw lead notes into viable Google search queries.
   * Strips phone numbers, parenthetical asides, punctuation noise,
   * trailing periods, and shorthand like "+" connectors.
   */
  private cleanQuery(raw: string): string {
    return raw
      .replace(/\(\d{3}\)[\s-]?\d{3}[\s-]?\d{4}/g, '') // phone numbers (xxx) xxx-xxxx
      .replace(/\d{3}[\s-]\d{3}[\s-]\d{4}/g, '')        // phone numbers xxx-xxx-xxxx
      .replace(/\([^)]*\)/g, '')                          // anything in parentheses
      .replace(/[+]/g, ' ')                               // plus signs to spaces
      .replace(/--/g, ' ')                                // double dashes
      .replace(/[.]{1,}$/g, '')                           // trailing periods
      .replace(/\s{2,}/g, ' ')                            // collapse whitespace
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
