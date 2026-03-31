import * as dotenv from 'dotenv';
import type {
  FailureMetadata,
  ToolAdapter,
  ToolExecutionInput,
  ToolExecutionResult,
} from '../agents/types';
import { ToolName } from '../utils/rateLimiter';

dotenv.config();

export class FirecrawlAdapter implements ToolAdapter {
  name: ToolName = 'firecrawl';
  description = 'Deep web scraping and LLM-ready markdown extraction via Firecrawl API';
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.firecrawl.dev/v1/scrape';

  constructor() {
    this.apiKey = process.env.FIRECRAWL_API_KEY || '';
    if (!this.isConfigured()) {
      console.warn('[Firecrawl] No API key found (FIRECRAWL_API_KEY). Adapter disabled.');
    }
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const startedAt = new Date().toISOString();

    if (!this.isConfigured()) {
      return this.buildFailureResult(startedAt, 'Firecrawl API key not configured', { query: input.query });
    }

    if (!input.query.startsWith('http://') && !input.query.startsWith('https://')) {
      console.warn(`[Firecrawl] Rejecting non-URL query: "${input.query}"`);
      return this.buildFailureResult(startedAt, `Firecrawl Adapter requires a fully formed valid URL (http/https). Received invalid target: "${input.query}"`, { query: input.query });
    }

    try {
      // Firecrawl takes the URL directly in the scrape endpoint
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ 
          url: input.query,
          formats: ['markdown'],
          onlyMainContent: true
        }),
      });

      if (!response.ok) {
        throw new Error(`Firecrawl API ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      
      if (!data.success) {
        throw new Error(`Firecrawl failure: ${data.error || 'Unknown API Exception'}`);
      }

      const markdown = data.data?.markdown || '';

      return {
        adapter: this.name,
        status: markdown.length > 0 ? 'success' : 'partial',
        startedAt,
        completedAt: new Date().toISOString(),
        normalizedText: markdown || 'No content found.',
        metadata: {
          url: data.data?.metadata?.sourceURL || input.query,
          title: data.data?.metadata?.title,
        },
        artifacts: [
          {
            type: 'webpage',
            title: data.data?.metadata?.title || `Firecrawl Extraction: ${input.query}`,
            source: 'Firecrawl API',
            sourceUrl: input.query,
            content: markdown || 'No content found.',
            metadata: {
              investigationId: input.investigationId,
              assignmentId: input.assignmentId,
            },
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown Firecrawl failure';
      return this.buildFailureResult(startedAt, message, { query: input.query });
    }
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

export const firecrawl = new FirecrawlAdapter();
