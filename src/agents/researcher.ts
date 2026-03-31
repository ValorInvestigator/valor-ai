// Valor AI -- Researcher Worker Agent
// Owner: Claude Code | TASK-005
// Integrated by Codex with shared tool contracts and SQLite persistence.

import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type {
  Assignment,
  FailureMetadata,
  Finding,
  Lead,
  StorageRepository,
  ToolAdapter,
  ToolExecutionResult,
  WorkerResult,
  WorkerStatus,
} from './types';
import { hasAvailableProvider, jsonCompletion } from '../llm/client';
import { WORKER_ANALYSIS_PROMPT } from '../llm/prompts';
import { sqliteStorageRepository } from '../storage';
import { ToolName, withRateLimit } from '../utils/rateLimiter';
import { planner } from './planner';

interface AnalysisResult {
  findings: Array<{
    fact: string;
    source: string;
    sourceUrl?: string;
    confidence: number;
    category: string;
    entities: string[];
  }>;
  newLeads: Array<{
    name: string;
    type: string;
    priority: number;
    reason: string;
  }>;
  summary: string;
}

interface AnalysisOutcome {
  analysis: AnalysisResult;
  llmProvider: WorkerResult['llmProvider'];
  tokensUsed: number;
  failure?: FailureMetadata;
}

export class Researcher {
  readonly id: string;
  private status: WorkerStatus;
  private readonly tools: Map<string, ToolAdapter> = new Map();
  private readonly storage: StorageRepository;
  private readonly startedAtMs = Date.now();
  private storageReady: Promise<void> | null = null;

  constructor(workerId?: string, storage: StorageRepository = sqliteStorageRepository) {
    this.id = workerId || `researcher-${uuid().slice(0, 8)}`;
    this.storage = storage;
    this.status = {
      id: this.id,
      status: 'idle',
      completedCount: 0,
      failedCount: 0,
      lastHeartbeat: new Date().toISOString(),
      uptime: 0,
    };
    void this.persistStatus().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown status persistence failure';
      console.error(`[Worker ${this.id}] Failed to persist initial status: ${message}`);
    });
    console.log(`[Worker ${this.id}] Initialized`);
  }

  registerTool(adapter: ToolAdapter): void {
    this.tools.set(adapter.name, adapter);
    console.log(`[Worker ${this.id}] Registered tool: ${adapter.name}`);
  }

  async processAssignment(assignment: Assignment): Promise<WorkerResult> {
    const startTime = Date.now();
    const assignedAt = new Date().toISOString();

    await this.ensureStorage();
    this.status.status = 'busy';
    this.status.currentAssignment = assignment.id;
    this.status.failure = undefined;
    this.updateHeartbeat();
    await this.persistStatus();

    await this.storage.updateAssignment(assignment.id, {
      status: 'in_progress',
      workerId: this.id,
      assignedAt,
    });

    console.log(
      `[Worker ${this.id}] Processing assignment ${assignment.id}: "${assignment.target}"`,
    );

    try {
      const toolOutputs = await this.executeTools(assignment);
      const analysisOutcome = await this.analyzeFinding(assignment, toolOutputs);
      const completedAt = new Date().toISOString();

      const result: WorkerResult = {
        workerId: this.id,
        assignmentId: assignment.id,
        investigationId: assignment.investigationId,
        findings: analysisOutcome.analysis.findings.map((finding) => ({
          id: uuid(),
          investigationId: assignment.investigationId,
          assignmentId: assignment.id,
          fact: finding.fact,
          source: finding.source,
          sourceUrl: finding.sourceUrl,
          confidence: finding.confidence,
          category: finding.category as Finding['category'],
          entities: finding.entities,
          timestamp: completedAt,
        })),
        newLeads: analysisOutcome.analysis.newLeads.map((lead) => ({
          id: uuid(),
          name: lead.name,
          type: lead.type as Lead['type'],
          priority: lead.priority,
          source: `${this.id}/${assignment.id}`,
          status: 'new',
          createdAt: completedAt,
          metadata: { reason: lead.reason, assignmentId: assignment.id },
        })),
        artifactPaths: this.collectArtifactPaths(toolOutputs),
        reportMarkdown: this.buildReport(assignment, analysisOutcome.analysis),
        confidence: this.calculateOverallConfidence(analysisOutcome.analysis.findings),
        tokensUsed: analysisOutcome.tokensUsed,
        llmProvider: analysisOutcome.llmProvider,
        durationMs: Date.now() - startTime,
        completedAt,
        failure: analysisOutcome.failure,
      };

      await this.storage.saveWorkerResult(result);

      if (result.failure) {
        this.status.failedCount++;
        this.status.failure = result.failure;
      } else {
        this.status.completedCount++;
        this.status.failure = undefined;
      }

      this.status.status = 'idle';
      this.status.currentAssignment = undefined;
      this.updateHeartbeat();
      await this.persistStatus();

      console.log(
        `[Worker ${this.id}] Completed assignment ${assignment.id}: ` +
        `${result.findings.length} findings, ${result.newLeads.length} leads, ` +
        `${result.durationMs}ms`,
      );

      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown worker failure';
      const completedAt = new Date().toISOString();
      const failure = this.buildFailure('research', message, { assignmentId: assignment.id }, true);

      const result: WorkerResult = {
        workerId: this.id,
        assignmentId: assignment.id,
        investigationId: assignment.investigationId,
        findings: [],
        newLeads: [],
        artifactPaths: [],
        reportMarkdown: `# Assignment Failed\n\nError: ${message}`,
        confidence: 0,
        tokensUsed: 0,
        llmProvider: 'local',
        durationMs: Date.now() - startTime,
        completedAt,
        failure,
      };

      await this.storage.saveWorkerResult(result);

      this.status.failedCount++;
      this.status.status = 'error';
      this.status.currentAssignment = undefined;
      this.status.failure = failure;
      this.updateHeartbeat();
      await this.persistStatus();

      console.error(`[Worker ${this.id}] Failed assignment ${assignment.id}: ${message}`);
      return result;
    }
  }

  private async executeTools(assignment: Assignment): Promise<ToolExecutionResult[]> {
    const availableTools = Array.from(this.tools.values()).filter((tool) => tool.isConfigured());

    if (availableTools.length === 0) {
      console.warn(`[Worker ${this.id}] No tools available. Using LLM-only path.`);
      const now = new Date().toISOString();
      const content = [
        `Research target: ${assignment.target}`,
        `Task: ${assignment.taskDescription}`,
        '',
        'No external tools available. Provide analysis based on your training data only.',
      ].join('\n');

      return [
        {
          adapter: 'local_llm',
          status: 'partial',
          startedAt: now,
          completedAt: now,
          normalizedText: content,
          artifacts: [
            {
              type: 'text',
              title: 'LLM-only fallback input',
              source: 'researcher',
              content,
            },
          ],
        },
      ];
    }

    const outputs: ToolExecutionResult[] = [];

    // --- AGENTIC PLANNING PHASE ---
    // Instead of blindly firing every configured tool (the old brute-force method),
    // we ask the Nemotron Planner to pick the exact right tool and Apify Actor
    // based on the assignment target and context.
    
    // Inject the global cross-wave memory so the Planner doesn't redundant-scrape
    let investigationContext = "Gathering initial intel for assignment";
    try {
      const memoryPath = path.join(process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share'), 'valor-ai', 'reports', 'global_memory.md');
      
      // Override for windows if LocalAppData is preferred (same as sqlite logic)
      const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
      const winMemoryPath = path.join(localAppData, 'valor-ai', 'reports', 'global_memory.md');
      
      const finalMemPath = process.platform === 'win32' ? winMemoryPath : memoryPath;
      if (fs.existsSync(finalMemPath)) {
        investigationContext = `[PREVIOUSLY ESTABLISHED FACTS -- DO NOT REDUNDANTLY RE-RESEARCH THIS]:\n\n` + fs.readFileSync(finalMemPath, 'utf8');
      }
    } catch {
      // Missing or unreadable, defaults to empty context
    }

    const plan = await planner.planNextStep(assignment, investigationContext);

    // If the planner successfully decided on a tool, run just that one.
    // Otherwise fallback to trying the first available tool (usually Apify).
    const selectedToolName = plan ? plan.tool : availableTools[0].name;
    const targetTool = availableTools.find((t) => t.name === selectedToolName) || availableTools[0];

    try {
      this.updateHeartbeat();
      await this.persistStatus();

      const runQuery = plan ? plan.query : assignment.target;
      const actorId = plan ? plan.actorId : undefined;

      const result = await withRateLimit(targetTool.name as ToolName, () =>
        targetTool.execute({
          investigationId: assignment.investigationId,
          assignmentId: assignment.id,
          target: assignment.target,
          query: runQuery,
          maxResults: 10,
          metadata: { 
            taskDescription: assignment.taskDescription,
            actorId,
          },
        }),
      );

      outputs.push(result);
      console.log(
        `[Worker ${this.id}] Tool ${targetTool.name}: ${result.status.toUpperCase()} ` +
        `(${result.completedAt})`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown tool failure';
      console.warn(`[Worker ${this.id}] Tool ${targetTool.name} threw: ${message}`);
      const now = new Date().toISOString();
      outputs.push({
        adapter: targetTool.name,
        status: 'failed',
        startedAt: now,
        completedAt: now,
        artifacts: [],
        failure: this.buildFailure(
          'tool',
          message,
          { tool: targetTool.name, assignmentId: assignment.id },
          true,
        ),
      });
    }

    return outputs;
  }

  private async analyzeFinding(
    assignment: Assignment,
    toolOutputs: ToolExecutionResult[],
  ): Promise<AnalysisOutcome> {
    const fullRawText = toolOutputs
      .filter((output) => output.status !== 'failed')
      .map((output) => this.summarizeToolOutput(output))
      .filter((summary) => summary.length > 0)
      .join('\n\n---\n\n');

    if (!fullRawText) {
      return {
        analysis: { findings: [], newLeads: [], summary: 'No usable tool output.' },
        llmProvider: 'local',
        tokensUsed: 0,
      };
    }

    if (!hasAvailableProvider()) {
      return {
        analysis: { findings: [], newLeads: [], summary: 'LLM analysis unavailable.' },
        llmProvider: 'local',
        tokensUsed: 0,
        failure: this.buildFailure(
          'llm',
          'No LLM provider available for worker analysis.',
          { assignmentId: assignment.id },
          true,
        ),
      };
    }

    // --- MAP-REDUCE CHUNKING LOGIC ---
    // Instead of forcing 20K+ characters into a 4B model and causing JSON truncation,
    // we slice the combined raw text into ~3000-character chunks and fire them natively
    // in parallel against Nemotron.
    const CHUNK_SIZE = 800000;
    const chunks: string[] = [];
    for (let i = 0; i < fullRawText.length; i += CHUNK_SIZE) {
      chunks.push(fullRawText.substring(i, i + CHUNK_SIZE));
    }

    console.log(`[Worker ${this.id}] MAP-REDUCE: Firing ${chunks.length} parallel analysis chunks at the LLM...`);

    const chunkPromises = chunks.map(async (chunkText, index) => {
      try {
        const res = await jsonCompletion<AnalysisResult>(
          [
            {
              role: 'user',
              content:
                `Assignment: ${assignment.target}\n` +
                `Task: ${assignment.taskDescription}\n\n` +
                `--- RAW DATA CHUNK [${index + 1}/${chunks.length}] ---\n\n${chunkText}`,
            },
          ],
          { systemPrompt: WORKER_ANALYSIS_PROMPT, temperature: 0.1, preferredProvider: 'nemotron' },
        );
        return res;
      } catch (err) {
        console.warn(`[Worker ${this.id}] Chunk ${index + 1} failed: ${err}`);
        return null;
      }
    });

    const chunkResults = (await Promise.all(chunkPromises)).filter((r) => r !== null && r !== undefined);

    if (chunkResults.length === 0) {
      console.warn(`[Worker ${this.id}] All chunked LLM analyses failed. Returning failure result.`);
      return {
        analysis: { findings: [], newLeads: [], summary: 'All chunk analyses failed.' },
        llmProvider: 'local',
        tokensUsed: 0,
        failure: this.buildFailure(
          'analysis',
          'Structured analysis requests returned no results.',
          { assignmentId: assignment.id },
          true,
        ),
      };
    }

    // --- MERGE RESULTS ---
    const mergedFindings = chunkResults.flatMap(r => r!.data.findings || []);
    const mergedLeads = chunkResults.flatMap(r => r!.data.newLeads || []);
    const totalTokens = chunkResults.reduce((acc, r) => acc + (r!.meta.tokensUsed || 0), 0);
    const dominantProvider = chunkResults[0]!.meta.provider;

    return {
      analysis: {
        findings: mergedFindings,
        newLeads: mergedLeads,
        summary: `Successfully parsed and merged ${chunks.length} chunks of multi-agent LLM analysis.`
      },
      llmProvider: dominantProvider,
      tokensUsed: totalTokens,
    };
  }

  private buildReport(assignment: Assignment, analysis: AnalysisResult): string {
    const findingsSection = analysis.findings
      .sort((left, right) => right.confidence - left.confidence)
      .map(
        (finding) =>
          `- **[${(finding.confidence * 100).toFixed(0)}%]** ${finding.fact}\n` +
          `  Source: ${finding.source}${finding.sourceUrl ? ` (${finding.sourceUrl})` : ''}`,
      )
      .join('\n');

    const leadsSection = analysis.newLeads
      .sort((left, right) => left.priority - right.priority)
      .map((lead) => `- **${lead.name}** (${lead.type}, P${lead.priority}) -- ${lead.reason}`)
      .join('\n');

    return [
      `## ${assignment.target}`,
      '',
      analysis.summary,
      '',
      '### Findings',
      findingsSection || '_No findings extracted._',
      '',
      '### New Leads',
      leadsSection || '_No new leads identified._',
    ].join('\n');
  }

  private calculateOverallConfidence(findings: Array<{ confidence: number }>): number {
    if (findings.length === 0) {
      return 0;
    }

    const sum = findings.reduce((accumulator, finding) => accumulator + finding.confidence, 0);
    return parseFloat((sum / findings.length).toFixed(3));
  }

  private collectArtifactPaths(toolOutputs: ToolExecutionResult[]): string[] {
    return toolOutputs
      .flatMap((output) => output.artifacts)
      .map((artifact) => artifact.savedPath)
      .filter((savedPath): savedPath is string => typeof savedPath === 'string' && savedPath.length > 0);
  }

  private summarizeToolOutput(output: ToolExecutionResult): string {
    const content =
      output.normalizedText ?? output.artifacts.map((artifact) => artifact.content).join('\n\n');

    if (!content) {
      return '';
    }

    // No hardcoded slice length - the parallel chunking map-reduce logic handles arbitrary length effortlessly.
    return `### Source: ${output.adapter}\n${content}`;
  }

  private updateHeartbeat(): void {
    this.status.lastHeartbeat = new Date().toISOString();
    this.status.uptime = Date.now() - this.startedAtMs;
  }

  private async ensureStorage(): Promise<void> {
    if (!this.storageReady) {
      this.storageReady = this.storage.initialize();
    }

    await this.storageReady;
  }

  private async persistStatus(): Promise<void> {
    await this.ensureStorage();
    await this.storage.saveWorkerStatus({ ...this.status });
  }

  private buildFailure(
    stage: FailureMetadata['stage'],
    reason: string,
    details?: Record<string, unknown>,
    retryable = false,
  ): FailureMetadata {
    return {
      stage,
      reason,
      retryable,
      occurredAt: new Date().toISOString(),
      details,
    };
  }

  getStatus(): WorkerStatus {
    return { ...this.status };
  }
}
