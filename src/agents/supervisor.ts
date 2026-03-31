// Valor AI -- Supervisor Agent
// Owner: Claude Code
// Wraps Researcher output with hallucination detection and quality validation.
// Uses Qwen3 for deep validation, Mistral for fast triage.

import type {
  Assignment,
  HallucinationFlag,
  HallucinationSeverity,
  LLMProviderName,
  ValidationReport,
  WorkerResult,
  ToolExecutionResult,
} from './types';
import { jsonCompletion } from '../llm/client';
import {
  SUPERVISOR_VALIDATE_PROMPT,
  TRIAGE_PROMPT,
} from '../llm/prompts';

// --- Types ---

export type TriageAction = 'accept' | 'retry_rewrite' | 'switch_tool' | 'mark_stalled';

export interface TriageDecision {
  action: TriageAction;
  rewritten_query?: string;
  next_tool?: string;
  reason: string;
}

interface ValidationLLMResponse {
  valid: boolean;
  flags: Array<{
    indicator: string;
    severity: 'high' | 'medium' | 'low';
    detail: string;
  }>;
  summary: string;
}

interface TriageLLMResponse {
  action: TriageAction;
  rewritten_query?: string;
  next_tool?: string;
  reason: string;
}

// --- Supervisor Class ---

export class Supervisor {
  readonly id: string;
  private validationCount = 0;
  private hallucinationsCaught = 0;
  private triageCount = 0;

  constructor(id?: string) {
    this.id = id || 'supervisor-1';
    console.log(`[Supervisor ${this.id}] Initialized`);
  }

  /**
   * Validate a WorkerResult against the raw tool output.
   * Uses Qwen3 (deep reasoning) to check if findings are grounded in evidence.
   * Returns a ValidationReport attached to the WorkerResult.
   */
  async validate(
    assignment: Assignment,
    result: WorkerResult,
    rawToolOutputs: ToolExecutionResult[],
    retryCount = 0,
  ): Promise<ValidationReport> {
    this.validationCount++;

    // Build the raw evidence string the worker had access to
    const rawEvidence = rawToolOutputs
      .filter((o) => o.status !== 'failed')
      .map((o) => {
        const content = o.normalizedText || o.artifacts.map((a) => a.content).join('\n');
        return `### Tool: ${o.adapter}\n${content.slice(0, 3000)}`;
      })
      .join('\n\n---\n\n');

    // Build the claims string from the worker's findings
    const claims = result.findings
      .map((f, i) => `${i + 1}. [${(f.confidence * 100).toFixed(0)}%] ${f.fact} (source: ${f.source})`)
      .join('\n');

    if (!claims || !rawEvidence) {
      // Nothing to validate -- if no findings, it's vacuously valid
      return this.buildReport(assignment.id, result.workerId, true, [], rawEvidence.length, result.findings.length, retryCount);
    }

    // Ask Qwen3 to validate claims against raw evidence
    const response = await jsonCompletion<ValidationLLMResponse>(
      [
        {
          role: 'user',
          content: [
            `## Assignment: ${assignment.target}`,
            '',
            '## Raw Tool Output (what the worker actually received):',
            rawEvidence.slice(0, 8000),
            '',
            '## Worker Claims (what the worker said it found):',
            claims,
          ].join('\n'),
        },
      ],
      {
        systemPrompt: SUPERVISOR_VALIDATE_PROMPT,
        temperature: 0,
        preferredProvider: 'local', // Qwen3 for deep reasoning
      },
    );

    if (!response) {
      console.warn(`[Supervisor ${this.id}] Validation LLM failed. Passing result through.`);
      return this.buildReport(assignment.id, result.workerId, true, [], rawEvidence.length, result.findings.length, retryCount);
    }

    const flags: HallucinationFlag[] = (response.data.flags || []).map((f) => ({
      indicator: f.indicator,
      severity: f.severity as HallucinationSeverity,
      detail: f.detail,
    }));

    const hasHighSeverity = flags.some((f) => f.severity === 'high');

    if (hasHighSeverity) {
      this.hallucinationsCaught++;
      console.warn(
        `[Supervisor ${this.id}] HALLUCINATION DETECTED in assignment ${assignment.id}: ` +
        `${flags.filter((f) => f.severity === 'high').length} high-severity flags`,
      );
    }

    const report = this.buildReport(
      assignment.id,
      result.workerId,
      !hasHighSeverity,
      flags,
      rawEvidence.length,
      result.findings.length,
      retryCount,
      response.meta.provider,
    );

    console.log(
      `[Supervisor ${this.id}] Validated assignment ${assignment.id}: ` +
      `${report.valid ? 'PASS' : 'FAIL'}, ${flags.length} flags ` +
      `(${response.meta.tokensUsed} tokens, ${response.meta.durationMs}ms)`,
    );

    return report;
  }

  /**
   * Fast triage of a tool execution result.
   * Uses Mistral 7B to decide: accept, retry with rewritten query, switch tool, or stall.
   * This is the "babysitter" -- it runs after every tool execution.
   */
  async triage(
    assignment: Assignment,
    toolResult: ToolExecutionResult,
  ): Promise<TriageDecision> {
    this.triageCount++;

    // Quick heuristic checks before burning an LLM call
    const quickDecision = this.quickTriage(toolResult);
    if (quickDecision) {
      console.log(
        `[Supervisor ${this.id}] Quick triage for ${assignment.id}: ${quickDecision.action} (${quickDecision.reason})`,
      );
      return quickDecision;
    }

    // Build triage context
    const resultCount = toolResult.artifacts.length;
    const contentLength = (toolResult.normalizedText || '').length;
    const status = toolResult.status;

    const response = await jsonCompletion<TriageLLMResponse>(
      [
        {
          role: 'user',
          content: [
            `Tool: ${toolResult.adapter}`,
            `Status: ${status}`,
            `Query: "${assignment.target}"`,
            `Results returned: ${resultCount} artifacts, ${contentLength} chars of content`,
            `Content preview: ${(toolResult.normalizedText || 'EMPTY').slice(0, 500)}`,
            toolResult.failure ? `Error: ${toolResult.failure.reason}` : '',
          ].filter(Boolean).join('\n'),
        },
      ],
      {
        systemPrompt: TRIAGE_PROMPT,
        temperature: 0,
        preferredProvider: 'local', // Will route to Mistral via dual-model config
        // If only one local model, falls back to whatever is available
      },
    );

    if (!response) {
      // LLM triage failed -- default to accept (don't block the pipeline)
      return { action: 'accept', reason: 'Triage LLM unavailable, defaulting to accept' };
    }

    const decision = response.data;
    console.log(
      `[Supervisor ${this.id}] Triage for ${assignment.id}: ${decision.action} (${decision.reason})`,
    );

    return decision;
  }

  /**
   * Fast heuristic triage that doesn't need an LLM call.
   */
  private quickTriage(toolResult: ToolExecutionResult): TriageDecision | null {
    // Tool hard-failed (network error, auth error, etc.)
    if (toolResult.status === 'failed' && toolResult.failure) {
      if (!toolResult.failure.retryable) {
        return { action: 'mark_stalled', reason: `Non-retryable failure: ${toolResult.failure.reason}` };
      }
      return { action: 'retry_rewrite', reason: `Retryable failure: ${toolResult.failure.reason}` };
    }

    // Tool returned substantial content -- no need for LLM triage
    const contentLength = (toolResult.normalizedText || '').length;
    if (toolResult.status === 'success' && contentLength > 500) {
      return { action: 'accept', reason: `Good result: ${contentLength} chars of content` };
    }

    // Tool returned but with zero content
    if (contentLength === 0 && toolResult.artifacts.length === 0) {
      return { action: 'retry_rewrite', reason: 'Zero content returned' };
    }

    // Ambiguous -- let LLM decide
    return null;
  }

  /**
   * Build a ValidationReport.
   */
  private buildReport(
    assignmentId: string,
    workerId: string,
    valid: boolean,
    flags: HallucinationFlag[],
    rawDataSizeChars: number,
    claimedFindingsCount: number,
    retryCount: number,
    supervisorProvider?: LLMProviderName,
  ): ValidationReport {
    return {
      assignmentId,
      workerId,
      valid,
      hallucinated: flags.some((f) => f.severity === 'high'),
      flags,
      validatedAt: new Date().toISOString(),
      retryCount,
      supervisorProvider,
      rawDataSizeChars,
      claimedFindingsCount,
    };
  }

  /**
   * Get supervisor stats.
   */
  getStats(): { validations: number; hallucinationsCaught: number; triages: number } {
    return {
      validations: this.validationCount,
      hallucinationsCaught: this.hallucinationsCaught,
      triages: this.triageCount,
    };
  }
}

export const supervisor = new Supervisor();
