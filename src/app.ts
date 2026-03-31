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
import { createSqliteStorageRepository } from './storage';
import { getAvailableTools } from './tools';
import type { QueueWorkerHandlers, QueueWorkerRuntime } from './queue/workers';
import {
  getBooleanFlag,
  getIntegerFlag,
  getLegacyTarget,
  getStringFlag,
  parseCliArgs,
} from './cli-flags';

dotenv.config();

type RuntimeManager = {
  createInvestigation(target: string): Promise<Investigation>;
  synthesizeReport(investigation: Investigation, results: WorkerResult[]): Promise<string>;
  deduplicateLeads(allLeads: Lead[]): Lead[];
};

interface StartOptions {
  target?: string;
  investigationId?: string;
  once: boolean;
  workers: number;
  redisHost: string;
  redisPort: number;
  dbPath: string;
  reportDir: string;
}

type AssignmentJob = Parameters<NonNullable<QueueWorkerHandlers['handleAssignmentExecute']>>[0];
type WorkerResultJob = Parameters<NonNullable<QueueWorkerHandlers['handleWorkerResultIngested']>>[0];
type ReportJob = Parameters<NonNullable<QueueWorkerHandlers['handleReportSynthesisRequested']>>[0];
type QueueModule = typeof import('./queue/queues');
type WorkerModule = typeof import('./queue/workers');
type ConnectionModule = typeof import('./queue/connection');

const reportRequests = new Set<string>();

let cleanupRuntime: (() => Promise<void>) | null = null;
let queueRuntimeActive = false;
let runtimeManager: RuntimeManager | null = null;
let queueModule: QueueModule | null = null;
let workerModule: WorkerModule | null = null;
let connectionModule: ConnectionModule | null = null;
let storage = createSqliteStorageRepository();
let activeReportDir = resolve(process.cwd(), 'data', 'reports');

function printHelp(): void {
  console.log([
    'Valor AI Service',
    '',
    'Usage:',
    '  npm run dev -- --target "Acme Holdings" --once',
    '  npm start -- --workers 3',
    '  npm start -- --investigation-id <id> --once',
    '',
    'Flags:',
    '  --target <value>            Create one new investigation',
    '  --investigation-id <id>    Watch or resume one existing investigation',
    '  --once                     Wait for the selected investigation and exit',
    '  --workers <n>              Override worker count',
    '  --redis-host <host>        Override Redis host',
    '  --redis-port <port>        Override Redis port',
    '  --db-path <path>           Override SQLite path',
    '  --report-dir <path>        Override report output directory',
    '  --help                     Show this help text',
    '',
    'Legacy compatibility:',
    '  A bare positional target still works for now, but is deprecated.',
  ].join('\n'));
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

function parseOptions(): StartOptions {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (getBooleanFlag(parsed, 'help')) {
    printHelp();
    process.exit(0);
  }

  const legacyTarget = getLegacyTarget(parsed);
  if (legacyTarget) {
    console.warn('[Valor AI] Positional targets are deprecated. Use --target "...".');
  }

  const target = getStringFlag(parsed, 'target') ?? legacyTarget ?? process.env.INVESTIGATION_TARGET?.trim();
  const investigationId = getStringFlag(parsed, 'investigation-id');
  if (target && investigationId) {
    throw new Error('Use either --target or --investigation-id, not both.');
  }

  const dataRoot = resolveDataRoot();
  const dbPath = getStringFlag(parsed, 'db-path')
    ? resolve(getStringFlag(parsed, 'db-path') as string)
    : (
        process.env.VALOR_DB_PATH?.trim()
          ? resolve(process.env.VALOR_DB_PATH)
          : join(
              process.env.VALOR_DB_DIR?.trim()
                ? resolve(process.env.VALOR_DB_DIR)
                : join(dataRoot, 'db'),
              'valor-ai.sqlite',
            )
      );
  const reportDir = getStringFlag(parsed, 'report-dir')
    ? resolve(getStringFlag(parsed, 'report-dir') as string)
    : (
        process.env.VALOR_REPORT_DIR?.trim()
          ? resolve(process.env.VALOR_REPORT_DIR)
          : join(dataRoot, 'reports')
      );

  return {
    target: target || undefined,
    investigationId,
    once: getBooleanFlag(parsed, 'once'),
    workers: getIntegerFlag(parsed, 'workers') ?? parsePositiveInteger(process.env.WORKER_COUNT, 1),
    redisHost: getStringFlag(parsed, 'redis-host') ?? process.env.REDIS_HOST?.trim() ?? '127.0.0.1',
    redisPort: getIntegerFlag(parsed, 'redis-port') ?? parsePositiveInteger(process.env.REDIS_PORT, 6379),
    dbPath,
    reportDir,
  };
}

function applyEnvironmentOverrides(options: StartOptions): void {
  process.env.REDIS_HOST = options.redisHost;
  process.env.REDIS_PORT = String(options.redisPort);
  process.env.VALOR_DB_PATH = options.dbPath;
  process.env.VALOR_REPORT_DIR = options.reportDir;
  process.env.WORKER_COUNT = String(options.workers);

  storage = createSqliteStorageRepository(options.dbPath);
  activeReportDir = options.reportDir;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
    const managerModule = require('./agents/manager') as typeof import('./agents/manager');
    runtimeManager = new managerModule.Manager(storage);
  }
}

async function ensureQueueRuntime(): Promise<void> {
  if (!connectionModule) {
    connectionModule = require('./queue/connection') as typeof import('./queue/connection');
  }

  if (!queueModule) {
    queueModule = require('./queue/queues') as typeof import('./queue/queues');
  }

  if (!workerModule) {
    workerModule = require('./queue/workers') as typeof import('./queue/workers');
  }
}

async function isRedisAvailable(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolveAvailability) => {
    let settled = false;
    const socket = createConnection({ host, port });

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
  const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
  const finalAttempt = job.attemptsMade + 1 >= attempts;
  if (result.failure?.retryable && !finalAttempt) {
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
  mkdirSync(activeReportDir, { recursive: true });

  const manager = requireRuntimeManager();
  const markdown = await manager.synthesizeReport(investigation, results);
  const leads = manager.deduplicateLeads(results.flatMap((result) => result.newLeads));
  const findingIds = results.flatMap((result) => result.findings.map((finding) => finding.id));
  const leadIds = leads.map((lead) => lead.id);
  const generatedAt = new Date().toISOString();
  const artifactPath = join(activeReportDir, `${investigation.id}.md`);
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
      failure: buildFailure('report_synthesis', reason, { investigationId }, false),
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

    if (queueRuntimeActive && queueModule && connectionModule) {
      closures.push(queueModule.closeQueues(), connectionModule.closeRedisConnection());
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
  const options = parseOptions();
  applyEnvironmentOverrides(options);

  await storage.initialize();
  mkdirSync(activeReportDir, { recursive: true });

  const runtimes: QueueWorkerRuntime[] = [];
  cleanupRuntime = createCleanup(runtimes);
  wireSignals();

  const providers = getAvailableProviders();
  const configuredTools = getAvailableTools();
  const redisAvailable = await isRedisAvailable(options.redisHost, options.redisPort);

  console.log(`[Valor AI] Data paths: db=${options.dbPath}, reports=${options.reportDir}`);

  if (!redisAvailable) {
    console.warn(
      `[Valor AI] Redis unavailable at ${options.redisHost}:${options.redisPort}. ` +
      'Queue-backed execution is disabled.',
    );

    if (!options.target && !options.investigationId) {
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

    if (options.target) {
      const investigation = await storage.createInvestigation({ target: options.target });
      const failure = buildFailure(
        'assignment_queue',
        `Redis unavailable at ${options.redisHost}:${options.redisPort}; assignments were not queued.`,
        { host: options.redisHost, port: options.redisPort, target: options.target },
        true,
      );
      await storage.updateInvestigation(investigation.id, { status: 'stalled', failure });
      console.error(`[Valor AI] Investigation ${investigation.id} stalled before queueing: ${failure.reason}`);
    } else {
      console.error(
        `[Valor AI] Investigation ${options.investigationId} could not be resumed because Redis is unavailable.`,
      );
    }

    await cleanupRuntime();
    process.exit(0);
  }

  await ensureRuntimeManager();
  await ensureQueueRuntime();
  queueRuntimeActive = true;

  const researchers = Array.from({ length: options.workers }, (_, index) => {
    const researcher = new Researcher(`researcher-${index + 1}`, storage);
    for (const tool of configuredTools) {
      researcher.registerTool(tool);
    }
    return researcher;
  });

  const workers = requireWorkerModule();
  const sharedRuntime = workers.createQueueWorkers(
    { handleWorkerResultIngested, handleReportSynthesisRequested },
    { workerResultConcurrency: 1, reportConcurrency: 1 },
  );
  const assignmentRuntimes = researchers.map((researcher) =>
    workers.createQueueWorkers(
      { handleAssignmentExecute: async (job) => handleAssignmentExecute(researcher, job) },
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

  if (!options.target && !options.investigationId) {
    console.log('[Valor AI] No investigation selected. Service is running in worker mode.');
    return;
  }

  if (options.investigationId) {
    const investigation = await storage.getInvestigation(options.investigationId);
    if (!investigation) {
      throw new Error(`Investigation ${options.investigationId} was not found.`);
    }

    console.log(
      `[Valor AI] Watching existing investigation ${investigation.id} with status ${investigation.status}.`,
    );

    if (options.once) {
      const completed = await waitForInvestigationCompletion(investigation.id);
      console.log(`[Valor AI] Investigation ${completed.id} ended with status ${completed.status}.`);
      await cleanupRuntime();
    }

    return;
  }

  const investigation = await requireRuntimeManager().createInvestigation(options.target as string);
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
