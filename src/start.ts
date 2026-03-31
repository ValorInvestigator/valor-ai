// Valor AI -- Preferred runtime entry point
// Boots storage, queues, workers, and optional single-target execution.

import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { createConnection } from 'net';
import { join, resolve } from 'path';
import * as dotenv from 'dotenv';
import { Researcher } from './agents/researcher';
import type {
  FailureMetadata,
  Investigation,
  Lead,
  QueueSnapshot,
  SynthesizedReport,
  WorkerResult,
} from './agents/types';
import { getAvailableProviders } from './llm/client';
import { closeRedisConnection, getRedisEndpoint } from './queue/connection';
import { createSqliteStorageRepository } from './storage';
import { getAvailableTools } from './tools';
import type { QueueWorkerHandlers, QueueWorkerRuntime } from './queue/workers.js';

dotenv.config();

type RuntimeManager = {
  createInvestigation(target: string): Promise<Investigation>;
  synthesizeReport(investigation: Investigation, results: WorkerResult[]): Promise<string>;
  deduplicateLeads(allLeads: Lead[]): Lead[];
};

const reportRequests = new Set<string>();
const workerCount = parsePositiveInteger(process.env.WORKER_COUNT, 1);

function resolveDataRoot(): string {
  const configuredRoot = process.env.VALOR_DATA_DIR?.trim();
  if (configuredRoot) {
    return resolve(configuredRoot);
  }

  const localAppData = process.env.LOCALAPPDATA?.trim() || process.env.APPDATA?.trim();
  if (localAppData) {
    return resolve(localAppData, 'valor-ai');
  }

  return resolve(process.cwd(), 'data');
}

const dataRoot = resolveDataRoot();
const dbPath = process.env.VALOR_DB_PATH?.trim()
  ? resolve(process.env.VALOR_DB_PATH)
  : join(
      process.env.VALOR_DB_DIR?.trim()
        ? resolve(process.env.VALOR_DB_DIR)
        : join(dataRoot, 'db'),
      'valor-ai.sqlite',
    );
const reportDir = process.env.VALOR_REPORT_DIR?.trim()
  ? resolve(process.env.VALOR_REPORT_DIR)
  : join(dataRoot, 'reports');
const storage = createSqliteStorageRepository(dbPath);

type AssignmentJob = Parameters<NonNullable<QueueWorkerHandlers['handleAssignmentExecute']>>[0];
type WorkerResultJob = Parameters<NonNullable<QueueWorkerHandlers['handleWorkerResultIngested']>>[0];
type ReportJob = Parameters<NonNullable<QueueWorkerHandlers['handleReportSynthesisRequested']>>[0];

type QueueModule = typeof import('./queue/queues.js');
type WorkerModule = typeof import('./queue/workers.js');

let cleanupRuntime: (() => Promise<void>) | null = null;
let queueRuntimeActive = false;
let runtimeManager: RuntimeManager | null = null;
let queueModule: QueueModule | null = null;
let workerModule: WorkerModule | null = null;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRequestedTarget(): string | null {
  if (process.argv.includes('--ingest')) return null;
  const cliTarget = process.argv.slice(2).join(' ').trim();
  const envTarget = process.env.INVESTIGATION_TARGET?.trim();
  return cliTarget || envTarget || null;
}

function isFinalAttempt(job: AssignmentJob): boolean {
  const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function buildFailure(
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

function extractExecutiveSummary(markdown: string, fallback: string): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return lines[0] ?? fallback;
}

function requireQueueModule(): QueueModule {
  if (!queueModule) {
    throw new Error('Queue runtime has not been initialized.');
  }

  return queueModule;
}

function requireWorkerModule(): WorkerModule {
  if (!workerModule) {
    throw new Error('Worker runtime has not been initialized.');
  }

  return workerModule;
}

function requireRuntimeManager(): RuntimeManager {
  if (!runtimeManager) {
    throw new Error('Runtime manager has not been initialized.');
  }

  return runtimeManager;
}

async function ensureRuntimeManager(): Promise<void> {
  if (!runtimeManager) {
    const managerModule = await import('./agents/manager.js');
    runtimeManager = new managerModule.Manager(storage);
  }
}

async function ensureQueueRuntime(): Promise<void> {
  if (!queueModule) {
    queueModule = await import('./queue/queues.js');
  }

  if (!workerModule) {
    workerModule = await import('./queue/workers.js');
  }
}

async function isRedisAvailable(timeoutMs = 1000): Promise<boolean> {
  const endpoint = getRedisEndpoint();

  return new Promise((resolveAvailability) => {
    let settled = false;
    const socket = createConnection({
      host: endpoint.host,
      port: endpoint.port,
    });

    const finalize = (available: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolveAvailability(available);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('error', () => finalize(false));
    socket.once('timeout', () => finalize(false));
  });
}

async function waitForInvestigationCompletion(investigationId: string): Promise<Investigation> {
  while (true) {
    const investigation = await storage.getInvestigation(investigationId);
    if (!investigation) {
      throw new Error(`Investigation ${investigationId} disappeared from storage.`);
    }

    if (
      investigation.status === 'completed'
      || investigation.status === 'stalled'
      || investigation.status === 'failed'
    ) {
      return investigation;
    }

    await sleep(1000);
  }
}

async function handleAssignmentExecute(
  researcher: Researcher,
  job: AssignmentJob,
): Promise<void> {
  const assignment = await storage.getAssignment(job.data.assignmentId);
  if (!assignment) {
    throw new Error(`Assignment ${job.data.assignmentId} was not found in storage.`);
  }

  const result = await researcher.processAssignment(assignment);
  if (result.failure?.retryable && !isFinalAttempt(job)) {
    throw new Error(result.failure.reason);
  }

  await requireQueueModule().enqueueWorkerResultJob({
    investigationId: assignment.investigationId,
    assignmentId: assignment.id,
    workerId: result.workerId,
    completedAt: result.completedAt ?? new Date().toISOString(),
    result,
  });
}

async function handleWorkerResultIngested(job: WorkerResultJob): Promise<void> {
  const investigationId = job.data.investigationId;

  if (await storage.getSynthesizedReport(investigationId)) {
    return;
  }

  // --- SCORCHED EARTH PROTOCOL: RULE ZERO (NEVER STOP) ---
  // Siphon all new leads discovered by the LLM and instantly queue them as follow-up 
  // assignments so the research propagates recursively wave-after-wave.
  const assignments = await storage.listAssignments(investigationId);
  const existingTargets = new Set(assignments.map((a) => a.target.toLowerCase().trim()));
  
  const newLeads = job.data.result.newLeads || [];
  const actionableLeads = newLeads.filter(
    (lead) => !existingTargets.has(lead.name.toLowerCase().trim())
  );

  if (actionableLeads.length > 0) {
    console.log(
      `[Valor AI] Deep Research: Siphoning ${actionableLeads.length} new actionable leads ` +
      `from Worker ${job.data.workerId} straight back into the engine! (Rule Zero Active)`
    );

    const assignmentsToCreate = actionableLeads.map((lead) => {
      const reason = lead.metadata?.reason ?? 'Identified in prior wave';
      return {
        investigationId,
        target: lead.name,
        taskDescription: `[Autonomous Deep Research Wave] Chase Lead: ${lead.name} (${lead.type}). Reason: ${reason}`,
        priority: lead.priority || 1,
      };
    });

    const createdAssignments = await storage.createAssignments(assignmentsToCreate);
    const queues = requireQueueModule();
    
    for (const assignment of createdAssignments) {
      await queues.enqueueAssignmentJob({
        investigationId: assignment.investigationId,
        assignmentId: assignment.id,
        target: assignment.target,
        taskDescription: assignment.taskDescription,
        priority: assignment.priority,
        enqueuedAt: new Date().toISOString(),
        retryCount: 0,
      });
      // Add to our local set so we don't duplicate within the same chunk if it triggered multiple times
      existingTargets.add(assignment.target.toLowerCase().trim());
    }
  }

  // Reload assignments to ensure we include the ones we just created for the terminal check!
  const updatedAssignments = await storage.listAssignments(investigationId);
  const allTerminal = updatedAssignments.length > 0
    && updatedAssignments.every((assignment) => (
      assignment.status === 'completed' || assignment.status === 'failed'
    ));

  if (!allTerminal || reportRequests.has(investigationId)) {
    return;
  }

  reportRequests.add(investigationId);
  try {
    await requireQueueModule().enqueueReportSynthesisJob({
      investigationId,
      assignmentIds: updatedAssignments.map((assignment) => assignment.id),
      requestedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    reportRequests.delete(investigationId);
    throw error;
  }
}

async function writeFinalReport(
  investigation: Investigation,
  results: WorkerResult[],
): Promise<SynthesizedReport> {
  mkdirSync(reportDir, { recursive: true });

  const manager = requireRuntimeManager();
  const markdown = await manager.synthesizeReport(investigation, results);
  const leads = manager.deduplicateLeads(results.flatMap((result) => result.newLeads));
  const findingIds = results.flatMap((result) => result.findings.map((finding) => finding.id));
  const leadIds = leads.map((lead) => lead.id);
  const generatedAt = new Date().toISOString();
  const artifactPath = join(reportDir, `${investigation.id}.md`);
  const title = `Investigation Report: ${investigation.target}`;
  const executiveSummary = extractExecutiveSummary(
    markdown,
    `${results.length} assignment results were synthesized for ${investigation.target}.`,
  );

  writeFileSync(artifactPath, markdown, 'utf8');

  const report: SynthesizedReport = {
    id: randomUUID(),
    investigationId: investigation.id,
    title,
    executiveSummary,
    sections: [
      {
        heading: 'Findings',
        summary: `${findingIds.length} findings synthesized across ${results.length} assignment results.`,
        findingIds,
        leadIds: [],
      },
      {
        heading: 'Leads',
        summary: `${leadIds.length} unique leads identified for follow-up.`,
        findingIds: [],
        leadIds,
      },
    ],
    markdown,
    artifactPath,
    generatedAt,
    llmProvider: results[0]?.llmProvider ?? 'local',
    assignmentIds: results.map((result) => result.assignmentId),
    leadIds,
  };

  await storage.saveSynthesizedReport(report);
  await storage.updateInvestigation(investigation.id, {
    status: 'completed',
    completedAt: generatedAt,
    finalReport: report,
  });

  return report;
}

async function handleReportSynthesisRequested(job: ReportJob): Promise<void> {
  const investigationId = job.data.investigationId;

  try {
    const existingReport = await storage.getSynthesizedReport(investigationId);
    if (existingReport) {
      return;
    }

    const investigation = await storage.getInvestigation(investigationId);
    if (!investigation) {
      throw new Error(`Investigation ${investigationId} was not found for report synthesis.`);
    }

    const assignments = await storage.listAssignments(investigationId);
    const results = assignments
      .map((assignment) => assignment.result)
      .filter((result): result is WorkerResult => Boolean(result));

    const report = await writeFinalReport({ ...investigation, assignments }, results);
    console.log(`[Valor AI] Report ready for ${investigationId}: ${report.artifactPath}`);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'Unknown report synthesis failure';
    await storage.updateInvestigation(investigationId, {
      status: 'stalled',
      failure: buildFailure(
        'report_synthesis',
        reason,
        { investigationId },
        false,
      ),
    });
    throw error;
  } finally {
    reportRequests.delete(investigationId);
  }
}

function formatQueueSnapshot(snapshot: QueueSnapshot): string {
  return [
    `assignments waiting=${snapshot.assignmentsPending}`,
    `assignments active=${snapshot.assignmentsActive}`,
    `reports waiting=${snapshot.reportsPending}`,
    `dead letters=${snapshot.deadLetters}`,
  ].join(', ');
}

function createCleanup(runtimes: QueueWorkerRuntime[]): () => Promise<void> {
  let shuttingDown = false;

  return async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log('[Valor AI] Shutting down runtime...');

    const closures: Array<Promise<unknown>> = [
      ...runtimes.map((runtime) => runtime.close()),
      storage.close(),
    ];

    if (queueRuntimeActive && queueModule) {
      closures.push(queueModule.closeQueues(), closeRedisConnection());
    }

    await Promise.allSettled(closures);
  };
}

function wireSignals(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`[Valor AI] Received ${signal}.`);
      const shutdown = cleanupRuntime ? cleanupRuntime() : Promise.resolve();
      void shutdown.finally(() => {
        process.exit(0);
      });
    });
  }
}

async function bootstrap(): Promise<void> {
  await storage.initialize();
  mkdirSync(reportDir, { recursive: true });

  const runtimes: QueueWorkerRuntime[] = [];
  cleanupRuntime = createCleanup(runtimes);
  wireSignals();

  const providers = getAvailableProviders();
  const configuredTools = getAvailableTools();
  const target = getRequestedTarget();
  const redisEndpoint = getRedisEndpoint();
  const redisAvailable = await isRedisAvailable();

  console.log(`[Valor AI] Data paths: db=${dbPath}, reports=${reportDir}`);

  if (!redisAvailable) {
    console.log(
      `[Valor AI] Redis unavailable at ${redisEndpoint.host}:${redisEndpoint.port}. ` +
      'Queue-backed execution is disabled.',
    );

    if (!target && process.argv.indexOf('--ingest') === -1) {
      console.log(
        `[Valor AI] Booted in degraded idle mode. Providers: ${
          providers.length > 0 ? providers.join(', ') : 'none'
        }. Tools: ${
          configuredTools.length > 0 ? configuredTools.map((tool) => tool.name).join(', ') : 'llm-only'
        }.`,
      );
      await cleanupRuntime();
      process.exit(0);
    }

    if (target) {
      const investigation = await storage.createInvestigation({ target });
      const failure = buildFailure(
        'assignment_queue',
        `Redis unavailable at ${redisEndpoint.host}:${redisEndpoint.port}; assignments were not queued.`,
        { host: redisEndpoint.host, port: redisEndpoint.port, target },
        true,
      );

      await storage.updateInvestigation(investigation.id, { status: 'stalled', failure });
      console.error(`[Valor AI] Investigation ${investigation.id} stalled before queueing: ${failure.reason}`);
      await cleanupRuntime();
      process.exit(0);
    }
    
    // If we're doing --ingest, we'll bypass queue initialization entirely!
    queueRuntimeActive = false;
  }

  await ensureRuntimeManager();

  const researchers = Array.from({ length: workerCount }, (_, index) => {
    const researcher = new Researcher(`researcher-${index + 1}`, storage);
    for (const tool of configuredTools) {
      researcher.registerTool(tool);
    }
    return researcher;
  });

  if (redisAvailable) {
    await ensureQueueRuntime();
    queueRuntimeActive = true;

    const workers = requireWorkerModule();
    const sharedRuntime = workers.createQueueWorkers(
      {
        handleWorkerResultIngested,
        handleReportSynthesisRequested,
      },
      {
        workerResultConcurrency: 1,
        reportConcurrency: 1,
      },
    );

    const assignmentRuntimes = researchers.map((researcher) =>
      workers.createQueueWorkers(
        {
          handleAssignmentExecute: async (job) => handleAssignmentExecute(researcher, job),
        },
        { assignmentConcurrency: 1 },
      ),
    );

    runtimes.push(sharedRuntime, ...assignmentRuntimes);
  }

  console.log(
    `[Valor AI] Booted with ${researchers.length} worker(s). ` +
    `Providers: ${providers.length > 0 ? providers.join(', ') : 'none'}. ` +
    `Tools: ${configuredTools.length > 0 ? configuredTools.map((tool) => tool.name).join(', ') : 'llm-only'}.`,
  );
  if (redisAvailable) {
    const queueSnapshot = await requireQueueModule().getQueueSnapshot();
    console.log(`[Valor AI] Queue snapshot: ${formatQueueSnapshot(queueSnapshot)}`);
  }

  const ingestIndex = process.argv.indexOf('--ingest');
  if (ingestIndex !== -1 && process.argv[ingestIndex + 1]) {
    const ingestPath = process.argv[ingestIndex + 1];
    console.log(`[Valor AI] Native Ingestion mode activated. Scanning: ${ingestPath}`);
    
    // Glob for .md files
    const { readdirSync, statSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    
    const getAllFiles = (dir: string): string[] => {
      let results: string[] = [];
      try {
        const list = readdirSync(dir);
        for (const file of list) {
          const path = join(dir, file);
          if (statSync(path).isDirectory()) {
            results = results.concat(getAllFiles(path));
          } else if (path.endsWith('.md')) {
            results.push(path);
          }
        }
      } catch (e) {
        // Suppress permissions errors
      }
      return results;
    };
    
    const mdFiles = getAllFiles(ingestPath);
    const legacyLeads: string[] = [];
    for (const file of mdFiles) {
      try {
        const content = readFileSync(file, 'utf8');
        // Match literal: \d+. [OPEN] text
        const matches = content.matchAll(/^\s*\d+\.\s*\[OPEN\]\s*(.+)$/gm);
        for (const match of matches) {
          legacyLeads.push(match[1].trim());
        }
      } catch (e) {}
    }
    
    const uniqueLeads = Array.from(new Set(legacyLeads));
    if (uniqueLeads.length === 0) {
      console.log(`[Valor AI] No legacy [OPEN] leads found inside ${ingestPath}`);
      await cleanupRuntime();
      return;
    }
    
    console.log(`[Valor AI] Success: Identified ${uniqueLeads.length} unique [OPEN] leads. Loading to Redis...`);
    // Create container investigation WITHOUT decomposition -- leads are fed directly below
    const investigation = await storage.createInvestigation({ target: 'Legacy Deep-Research Ingestion' });
    await storage.updateInvestigation(investigation.id, { status: 'active' });
    console.log(`[Valor AI] Container Investigation tracking spawned: ${investigation.id}`);
    
    const assignmentsToCreate = uniqueLeads.map((lead, idx) => ({
      investigationId: investigation.id,
      target: lead,
      taskDescription: `Migrated legacy OSINT lead: ${lead}`,
      priority: 1
    }));
    
    const createdAssignments = await storage.createAssignments(assignmentsToCreate);
    if (redisAvailable) {
      const queues = requireQueueModule();
      let queuedCount = 0;
      for (const assignment of createdAssignments) {
        await queues.enqueueAssignmentJob({
          investigationId: assignment.investigationId,
          assignmentId: assignment.id,
          target: assignment.target,
          taskDescription: assignment.taskDescription,
          priority: assignment.priority,
          enqueuedAt: new Date().toISOString(),
          retryCount: 0
        });
        queuedCount++;
      }
      console.log(`[Valor AI] Slurped ${queuedCount} legacy tasks into the active assignment pool!`);
      console.log(`[Valor AI] Workers firing off. Watch the queue snapshot logs...`);
      
      let currentInves = await storage.getInvestigation(investigation.id);
      while (currentInves && currentInves.status !== 'completed' && currentInves.status !== 'failed' && currentInves.status !== 'stalled') {
        await sleep(5000);
        currentInves = await storage.getInvestigation(investigation.id);
      }
      
      if (currentInves?.finalReport) {
        console.log(`[Valor AI] Deep-Research Ingestion Complete. Final Rollup: ${currentInves.finalReport.artifactPath}`);
      }
    } else {
      console.log(`[Valor AI] Running ${createdAssignments.length} legacy assignments SYNCHRONOUSLY since Redis is disconnected!`);
      await ensureRuntimeManager();
      const results: WorkerResult[] = [];
      const syncResearcher = researchers[0] || new Researcher('sync-worker-1', storage);
      if (researchers.length === 0) {
        for (const tool of configuredTools) syncResearcher.registerTool(tool);
      }
      
      for (const assignment of createdAssignments) {
        console.log(`[Valor AI] Processing: ${assignment.target}`);
        try {
          const result = await syncResearcher.processAssignment(assignment);
          results.push(result);
        } catch (err: unknown) {
          console.error(`[Valor AI] Failed to process ${assignment.target}:`, err);
        }
      }
      
      console.log(`[Valor AI] Synchronous execution finished. Synthesizing final report...`);
      const finalInves = await storage.getInvestigation(investigation.id);
      if (finalInves) {
        try {
          const report = await writeFinalReport(finalInves, results);
          console.log(`[Valor AI] Deep-Research Ingestion Complete. Final Rollup: ${report.artifactPath}`);
        } catch (err) {
          console.error(`[Valor AI] Report synthesis failed:`, err);
        }
      }
    }
    
    await cleanupRuntime();
    return;
  }

  if (process.argv.includes('--worker-pool')) {
    console.log('[Valor AI] Worker Pool Daemon spinning indefinitely. Awaiting Redis jobs...');
    return; // Don't cleanup or exit.
  }
  
  if (process.argv.includes('--jobsd')) {
    console.log('[Valor AI] Booting jobsd Mistral Babysitter Daemon...');
    const jobsd = await import('./orchestration/jobsd.js');
    await jobsd.startDaemon(storage);
    return;
  }

  if (!target) {
    console.log(
      '[Valor AI] No investigation target provided. Pass one on the command line or use --worker-pool.',
    );
    await cleanupRuntime();
    return;
  }

  const investigation = await requireRuntimeManager().createInvestigation(target);
  console.log(
    `[Valor AI] Investigation ${investigation.id} created with status ${investigation.status}.`,
  );

  if (investigation.status === 'stalled' || investigation.status === 'failed') {
    console.error(`[Valor AI] Investigation could not start: ${investigation.failure?.reason ?? 'unknown error'}`);
    await cleanupRuntime();
    return;
  }

  const completedInvestigation = await waitForInvestigationCompletion(investigation.id);
  if (completedInvestigation.finalReport) {
    console.log(
      `[Valor AI] Investigation completed. Report written to ${completedInvestigation.finalReport.artifactPath}`,
    );
  } else {
    console.log(
      `[Valor AI] Investigation reached ${completedInvestigation.status} without a final report.`,
    );
  }

  await cleanupRuntime();
}

bootstrap().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap failure';
  console.error(`[Valor AI] Fatal startup error: ${message}`);
  await cleanupRuntime?.();
  process.exitCode = 1;
});
