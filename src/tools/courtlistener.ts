import * as dotenv from 'dotenv';
import type {
  FailureMetadata,
  ToolAdapter,
  ToolExecutionInput,
  ToolExecutionResult,
} from '../agents/types';
import { ToolName } from '../utils/rateLimiter';

dotenv.config();

export class CourtListenerAdapter implements ToolAdapter {
  name: ToolName = 'courtlistener';
  description = 'Legal document and case docket lookup via CourtListener RECAP API';
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.courtlistener.com/api/rest/v3/search/';

  constructor() {
    this.apiKey = process.env.COURTLISTENER_API_KEY || '';
    if (!this.isConfigured()) {
      console.warn('[CourtListener] No API key found (COURTLISTENER_API_KEY). Adapter disabled.');
    }
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const startedAt = new Date().toISOString();

    if (!this.isConfigured()) {
      return this.buildFailureResult(startedAt, 'CourtListener API key not configured', { query: input.query });
    }

    try {
      const url = `${this.baseUrl}?q=${encodeURIComponent(input.query)}&page_size=${input.maxResults ?? 10}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`CourtListener API ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const results = data.results || [];
      
      const normalizedText = results
        .map(
          (result: any, index: number) =>
            `[${index + 1}] Case: ${result.caseName}\n` +
            `Court: ${result.court}\n` +
            `Date Filed: ${result.dateFiled}\n` +
            `Docket Number: ${result.docketNumber}\n` +
            `URL: https://www.courtlistener.com${result.absolute_url}`
        )
        .join('\n\n');

      return {
        adapter: this.name,
        status: results.length > 0 ? 'success' : 'partial',
        startedAt,
        completedAt: new Date().toISOString(),
        normalizedText: normalizedText || 'No court records found matching the query.',
        metadata: {
          query: input.query,
          resultCount: results.length,
        },
        artifacts: [
          {
            type: 'search_results',
            title: `CourtListener Docket Search: "${input.query}"`,
            source: 'CourtListener RECAP',
            content: normalizedText || 'No records found.',
            metadata: {
              investigationId: input.investigationId,
              assignmentId: input.assignmentId,
            },
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown CourtListener failure';
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

export const courtListener = new CourtListenerAdapter();
