// Valor AI -- Manager Agent
// Owner: Claude Code | TASK-004
// Integrated by Codex with SQLite and BullMQ wiring.
import * as fs from 'fs';
import * as path from 'path';
import type {
  Assignment,
  CreateAssignmentInput,
  FailureMetadata,
  Investigation,
  Lead,
  StorageRepository,
  WorkerResult,
} from './types';
import {
  chatCompletion,
  hasAvailableProvider,
  jsonCompletion,
} from '../llm/client';
import {
  MANAGER_DECOMPOSE_PROMPT,
  MANAGER_FALLBACK_PROMPT,
  MANAGER_SYNTHESIS_PROMPT,
} from '../llm/prompts';
import { enqueueAssignmentJob } from '../queue/queues';
import { sqliteStorageRepository } from '../storage';
import { deduplicateLeads as deduplicateLeadList } from '../utils/dedup';

interface DecompositionResult {
  assignments: Array<{
    target: string;
    taskDescription: string;
    priority: number;
    category: string;
  }>;
}

export class Manager {
  private investigations: Map<string, Investigation> = new Map();
  private readonly storage: StorageRepository;
  private storageReady: Promise<void> | null = null;

  constructor(storage: StorageRepository = sqliteStorageRepository) {
    this.storage = storage;
  }

  async createInvestigation(target: string): Promise<Investigation> {
    await this.ensureStorage();

    const investigation = await this.storage.createInvestigation({ target });
    this.investigations.set(investigation.id, investigation);
    console.log(`[Manager] Created investigation ${investigation.id}: "${target}"`);

    if (!hasAvailableProvider()) {
      return this.markInvestigationStalled(
        investigation,
        this.buildFailure(
          'llm',
          'No LLM provider available for decomposition.',
          { target },
          true,
        ),
      );
    }

    try {
      const assignmentInputs = await this.decompose(investigation);
      if (assignmentInputs.length === 0) {
        return this.markInvestigationStalled(
          investigation,
          this.buildFailure(
            'decomposition',
            'Decomposition produced zero assignments.',
            { target },
            true,
          ),
        );
      }

      const assignments = await this.storage.createAssignments(assignmentInputs);
      await this.enqueueAssignments(assignments);
      await this.storage.updateInvestigation(investigation.id, { status: 'active' });

      const storedInvestigation = await this.storage.getInvestigation(investigation.id);
      const activeInvestigation: Investigation = storedInvestigation
        ? { ...storedInvestigation, status: 'active', assignments }
        : { ...investigation, status: 'active', assignments };

      this.investigations.set(activeInvestigation.id, activeInvestigation);
      console.log(
        `[Manager] Decomposed ${investigation.id} into ${assignments.length} assignments and queued them.`,
      );
      return activeInvestigation;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown manager failure';
      return this.markInvestigationStalled(
        investigation,
        this.buildFailure('unknown', message, { target }, true),
      );
    }
  }

  private async decompose(investigation: Investigation): Promise<CreateAssignmentInput[]> {
    const result = await jsonCompletion<DecompositionResult>(
      [{ role: 'user', content: `Investigation target: ${investigation.target}` }],
      {
        systemPrompt: MANAGER_DECOMPOSE_PROMPT,
        temperature: 0.7,
        preferredProvider: 'nemotron'
      },
    );

    if (result?.data.assignments?.length) {
      console.log(
        `[Manager] Normal decomposition: ${result.data.assignments.length} assignments ` +
        `(${result.meta.provider}, ${result.meta.tokensUsed} tokens, ${result.meta.durationMs}ms)`,
      );
      return result.data.assignments.map((assignment) =>
        this.toAssignmentInput(investigation.id, assignment),
      );
    }

    console.warn('[Manager] Normal decomposition failed. Trying fallback...');
    return this.fallbackDecompose(investigation);
  }

  private async fallbackDecompose(
    investigation: Investigation,
  ): Promise<CreateAssignmentInput[]> {
    const result = await jsonCompletion<DecompositionResult>(
      [{ role: 'user', content: `Investigation target: ${investigation.target}` }],
      {
        systemPrompt: MANAGER_FALLBACK_PROMPT,
        temperature: 0.3,
      },
    );

    if (result?.data.assignments?.length) {
      console.log(
        `[Manager] Fallback decomposition: ${result.data.assignments.length} assignment ` +
        `(${result.meta.provider})`,
      );
      return result.data.assignments.map((assignment) =>
        this.toAssignmentInput(investigation.id, assignment),
      );
    }

    console.error('[Manager] Fallback decomposition also failed. No assignments created.');
    return [];
  }

  private toAssignmentInput(
    investigationId: string,
    raw: { target: string; taskDescription: string; priority: number; category: string },
  ): CreateAssignmentInput {
    const taskDescription = raw.category
      ? `${raw.taskDescription}\nCategory: ${raw.category}`
      : raw.taskDescription;

    return {
      investigationId,
      target: raw.target,
      taskDescription,
      priority: raw.priority,
    };
  }

  private async enqueueAssignments(assignments: Assignment[]): Promise<void> {
    await Promise.all(
      assignments.map((assignment) =>
        enqueueAssignmentJob({
          investigationId: assignment.investigationId,
          assignmentId: assignment.id,
          target: assignment.target,
          taskDescription: assignment.taskDescription,
          priority: assignment.priority,
          enqueuedAt: new Date().toISOString(),
          retryCount: 0,
        }),
      ),
    );
  }

  async synthesizeReport(
    investigation: Investigation,
    results: WorkerResult[],
  ): Promise<string> {
    if (results.length === 0) {
      return '# Investigation Report\n\nNo results were returned by workers.';
    }

    // NATIVE CONTEXT COMPRESSION:
    // Compress 173+ findings down to the top 40 highest-confidence facts across all workers.
    const allFindings = results.flatMap((r) => r.findings);
    const topFindings = allFindings
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 40);

    // HIERARCHICAL JSON GROUPING (Prevents topic-crosspollination hallucination)
    const groupedSections: Record<string, any[]> = {};
    topFindings.forEach((f) => {
      const cat = f.category || 'other';
      if (!groupedSections[cat]) groupedSections[cat] = [];
      groupedSections[cat].push([f.fact, parseFloat(f.confidence.toFixed(2)), f.source]);
    });

    const sectionsPayload = Object.entries(groupedSections).map(([cat, facts]) => ({
      id: cat,
      title: cat.toUpperCase() + " FINDINGS",
      facts: facts,
    }));

    const allLeads = results.flatMap((r) => r.newLeads);
    const topLeads = allLeads
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 15);

    const leadsSummary = topLeads
      .map((lead) => `- ${lead.name} (${lead.type}, priority ${lead.priority})`)
      .join('\n');

    const resultsSummary = `### Structured Context Data:\n\`\`\`json\n${JSON.stringify({ sections: sectionsPayload }, null, 2)}\n\`\`\`\n\n### Top New Leads:\n${leadsSummary}`;

    let oldGlobalMemory = "No prior global memory exists.";
    const memoryPath = path.join(process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.local/share'), 'valor-ai', 'reports', 'global_memory.md');
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const winMemoryPath = path.join(localAppData, 'valor-ai', 'reports', 'global_memory.md');
    const finalMemPath = process.platform === 'win32' ? winMemoryPath : memoryPath;

    try {
      if (fs.existsSync(finalMemPath)) {
        oldGlobalMemory = fs.readFileSync(finalMemPath, 'utf8');
      }
    } catch (e) {
      console.warn('[Manager] Could not read global memory file.', e);
    }

    // VRAM EVICTION PROTOCOL:
    // Forcefully flush nemotron-mini. This clears out all 3GB of VRAM overhead from the workers,
    // ensuring the massive 70B model has the absolute maximum available memory buffer on the dual-3090s.
    try {
      console.log(`[Manager] Initiating VRAM Flush: Evicting worker models from GPU...`);
      await fetch(process.env.LOCAL_LLM_BASE_URL?.replace('/v1', '/api/generate') || 'http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.NEMOTRON_MODEL || 'nemotron-mini', keep_alive: 0 }),
      });
      console.log(`[Manager] GPUs successfully flushed. Booting 70B synthesis engine natively...`);
    } catch (e) {
      console.warn('[Manager] Failed to emit manual GPU flush command.', e);
    }

    const response = await chatCompletion(
      [
        {
          role: 'user',
          content: `Target: ${investigation.target}\n\nExisting Global Context:\n${oldGlobalMemory}\n\nWorker Results:\n\n${resultsSummary}`,
        },
      ],
      { systemPrompt: MANAGER_SYNTHESIS_PROMPT, preferredProvider: 'ollama' },
    );

    if (!response) {
      console.warn('[Manager] Synthesis LLM failed. Returning raw concatenation.');
      return `# Investigation Report: ${investigation.target}\n\n${results.map((result) => result.reportMarkdown).join('\n\n---\n\n')}`;
    }

    console.log(
      `[Manager] Report synthesized (${response.provider}, ${response.tokensUsed} tokens)`,
    );

    // Extract XML tags
    const reportMatch = response.content.match(/<report>([\s\S]*?)<\/report>/i);
    let memoryMatch = response.content.match(/<global_memory>([\s\S]*?)<\/global_memory>/i);
    
    let memoryToSave = memoryMatch ? memoryMatch[1].trim() : null;

    if (!memoryToSave) {
      // Fallback: look for a markdown header that looks like Global Memory
      const fallbackMatch = response.content.match(/##\s*Global\s*Memory(?:[\s\S]*?)(?:\n##\s*|\Z)/i);
      if (fallbackMatch) {
         memoryToSave = fallbackMatch[0].replace(/##\s*Global\s*Memory/i, '').trim();
      }
    }

    if (!memoryToSave) {
      // Ultimate fallback: if there's no memory block found, append the report to older memory directly.
      memoryToSave = oldGlobalMemory + "\n\n## Updates:\n" + (reportMatch && reportMatch[1] ? reportMatch[1].trim() : response.content);
      console.warn(`[Manager] ${response.provider.toUpperCase()} failed to wrap output in <global_memory> tags. Using report appending fallback.`);
    }
    
    // Save updated global memory
    if (memoryToSave) {
      try {
        fs.writeFileSync(finalMemPath, memoryToSave, 'utf8');
        console.log(`[Manager] Successfully updated rolling global memory state at ${finalMemPath}`);
      } catch (e) {
        console.warn('[Manager] Failed to write global memory file.', e);
      }
    }

    return reportMatch && reportMatch[1] ? reportMatch[1].trim() : response.content;
  }

  deduplicateLeads(allLeads: Lead[]): Lead[] {
    return deduplicateLeadList(allLeads);
  }

  getInvestigation(id: string): Investigation | undefined {
    return this.investigations.get(id);
  }

  getAllInvestigations(): Investigation[] {
    return Array.from(this.investigations.values());
  }

  private async ensureStorage(): Promise<void> {
    if (!this.storageReady) {
      this.storageReady = this.storage.initialize();
    }

    await this.storageReady;
  }

  private async markInvestigationStalled(
    investigation: Investigation,
    failure: FailureMetadata,
  ): Promise<Investigation> {
    await this.storage.updateInvestigation(investigation.id, {
      status: 'stalled',
      failure,
    });

    const storedInvestigation = await this.storage.getInvestigation(investigation.id);
    const stalledInvestigation: Investigation = storedInvestigation
      ? { ...storedInvestigation, status: 'stalled', failure }
      : { ...investigation, status: 'stalled', failure };

    this.investigations.set(stalledInvestigation.id, stalledInvestigation);
    console.error(`[Manager] Investigation ${investigation.id} stalled: ${failure.reason}`);
    return stalledInvestigation;
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
}

export const manager = new Manager();
