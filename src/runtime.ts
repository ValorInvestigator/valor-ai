// Valor AI -- Preferred runtime entry point
// Boots storage, queues, workers, and optional single-target execution.

import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { createConnection } from 'net';
import { join, resolve } from 'path';
import * as dotenv from 'dotenv';
import { Manager } from './agents/manager.js';
import { Researcher } from './agents/researcher';
import type {
  FailureMetadata,
  Investigation,
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
const runtimeManager = new Manager(storage);

type AssignmentJob = Parameters<NonNullable<QueueWorkerHandlers['handleAssignmentExecute']>>[0];
type WorkerResultJob = Parameters<NonNullable<QueueWorkerHandlers['handleWorkerResultIngested']>>[0];
type ReportJob = Parameters<NonNullable<QueueWorkerHandlers['handleReportSynthesisRequested']>>[0];

type QueueModule = typeof import('./queue/queues.js');
type WorkerModule = typeof import('./queue/workers.js');

let cleanupRuntime: (() => Promise<void>) | null = null;
let queueRuntimeActive = false;
let queueModule: QueueModule | null = null;
let workerModule: WorkerModule | null = null;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRequestedTarget(): string | null {
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

  const assignments = await storage.listAssignments(investigationId);
  const allTerminal = assignments.length > 0
    && assignments.every((assignment) => (
      assignment.status === 'completed' || assignment.status === 'failed'
    ));

  if (!allTerminal || reportRequests.has(investigationId)) {
    return;
  }

  reportRequests.add(investigationId);
  try {
    await requireQueueModule().enqueueReportSynthesisJob({
      investigationId,
      assignmentIds: assignments.map((assignment) => assignment.id),
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

  const markdown = await runtimeManager.synthesizeReport(investigation, results);
  const leads = runtimeManager.deduplicateLeads(results.flatMap((result) => result.newLeads));
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
    console.warn(
      `[Valor AI] Redis unavailable at ${redisEndpoint.host}:${redisEndpoint.port}. ` +
      'Queue-backed execution is disabled.',
    );

    if (!target) {
      console.log(
        `[Valor AI] Booted in degraded idle mode. Providers: ${
          providers.length > 0 ? providers.join(', ') : 'none'
        }. Tools: ${
          configuredTools.length > 0 ? configuredTools.map((tool) => tool.name).join(', ') : 'llm-only'
        }.`,
      );
      await cleanupRuntime();
      return;
    }

    const investigation = await storage.createInvestigation({ target });
    const failure = buildFailure(
      'assignment_queue',
      `Redis unavailable at ${redisEndpoint.host}:${redisEndpoint.port}; assignments were not queued.`,
      {
        host: redisEndpoint.host,
        port: redisEndpoint.port,
        target,
      },
      true,
    );

    await storage.updateInvestigation(investigation.id, {
      status: 'stalled',
      failure,
    });

    console.error(
      `[Valor AI] Investigation ${investigation.id} stalled before queueing: ${failure.reason}`,
    );
    await cleanupRuntime();
    return;
  }

  await ensureQueueRuntime();
  queueRuntimeActive = true;

  const researchers = Array.from({ length: workerCount }, (_, index) => {
    const researcher = new Researcher(`researcher-${index + 1}`, storage);
    for (const tool of configuredTools) {
      researcher.registerTool(tool);
    }
    return researcher;
  });

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

  const queueSnapshot = await requireQueueModule().getQueueSnapshot();
  console.log(
    `[Valor AI] Booted with ${researchers.length} worker(s). ` +
    `Providers: ${providers.length > 0 ? providers.join(', ') : 'none'}. ` +
    `Tools: ${configuredTools.length > 0 ? configuredTools.map((tool) => tool.name).join(', ') : 'llm-only'}.`,
  );
  console.log(`[Valor AI] Queue snapshot: ${formatQueueSnapshot(queueSnapshot)}`);

  if (!target) {
    console.log(
      '[Valor AI] No investigation target provided. Pass one on the command line or set INVESTIGATION_TARGET.',
    );
    return;
  }

  const investigation = await runtimeManager.createInvestigation(target);
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
