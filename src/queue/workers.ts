import { Job, Worker } from 'bullmq';
import type {
  AssignmentJobPayload,
  InvestigationRequestedPayload,
  LeadDiscoveredPayload,
  ReportSynthesisJobPayload,
  WorkerResultJobPayload,
} from '../agents/types';
import { redisOptions } from './connection';
import { enqueueDeadLetter, QUEUE_NAMES } from './queues';

type InvestigationJob = Job<InvestigationRequestedPayload, void, 'investigation_requested'>;
type AssignmentJob = Job<AssignmentJobPayload, void, 'assignment_execute'>;
type WorkerResultJob = Job<WorkerResultJobPayload, void, 'worker_result_ingested'>;
type LeadJob = Job<LeadDiscoveredPayload, void, 'lead_discovered'>;
type ReportJob = Job<ReportSynthesisJobPayload, void, 'report_synthesis_requested'>;

export interface QueueWorkerHandlers {
  handleInvestigationRequested?: (job: InvestigationJob) => Promise<void>;
  handleAssignmentExecute?: (job: AssignmentJob) => Promise<void>;
  handleWorkerResultIngested?: (job: WorkerResultJob) => Promise<void>;
  handleLeadDiscovered?: (job: LeadJob) => Promise<void>;
  handleReportSynthesisRequested?: (job: ReportJob) => Promise<void>;
}

export interface QueueWorkerOptions {
  investigationConcurrency?: number;
  assignmentConcurrency?: number;
  workerResultConcurrency?: number;
  leadConcurrency?: number;
  reportConcurrency?: number;
}

export interface QueueWorkerRuntime {
  investigationWorker?: Worker<InvestigationRequestedPayload, void, 'investigation_requested'>;
  assignmentWorker?: Worker<AssignmentJobPayload, void, 'assignment_execute'>;
  workerResultWorker?: Worker<WorkerResultJobPayload, void, 'worker_result_ingested'>;
  leadWorker?: Worker<LeadDiscoveredPayload, void, 'lead_discovered'>;
  reportWorker?: Worker<ReportSynthesisJobPayload, void, 'report_synthesis_requested'>;
  close(): Promise<void>;
}

async function forwardToDeadLetter(job: Job | undefined, error: Error, sourceQueue: string): Promise<void> {
  if (!job) {
    return;
  }

  const configuredAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
  if (job.attemptsMade < configuredAttempts) {
    return;
  }

  await enqueueDeadLetter({
    sourceQueue,
    jobName: job.name,
    jobId: job.id?.toString(),
    failedAt: new Date().toISOString(),
    attemptsMade: job.attemptsMade,
    reason: error.message,
    payload: job.data,
  });
}

function attachWorkerLogging<TPayload, TName extends string>(
  worker: Worker<TPayload, void, TName>,
  label: string,
): void {
  worker.on('completed', (job) => {
    console.log(`[QueueWorker:${label}] Completed ${job.name} (${job.id})`);
  });

  worker.on('failed', (job, error) => {
    console.error(
      `[QueueWorker:${label}] Failed ${job?.name ?? 'unknown'} (${job?.id ?? 'n/a'}): ${error.message}`,
    );
    void forwardToDeadLetter(job, error, label);
  });
}

function createLoggedWorker<TPayload, TName extends string>(
  queueName: string,
  label: string,
  concurrency: number,
  handler: (job: Job<TPayload, void, TName>) => Promise<void>,
): Worker<TPayload, void, TName> {
  const worker = new Worker<TPayload, void, TName>(
    queueName,
    async (job) => {
      await handler(job as Job<TPayload, void, TName>);
    },
    {
      connection: redisOptions,
      concurrency,
    },
  );

  attachWorkerLogging(worker, label);
  return worker;
}

export function createQueueWorkers(
  handlers: QueueWorkerHandlers,
  options: QueueWorkerOptions = {},
): QueueWorkerRuntime {
  const workers: Array<Worker<any, void, any>> = [];

  const runtime: QueueWorkerRuntime = {
    investigationWorker: handlers.handleInvestigationRequested
      ? createLoggedWorker(
          QUEUE_NAMES.investigations,
          QUEUE_NAMES.investigations,
          options.investigationConcurrency ?? 1,
          handlers.handleInvestigationRequested,
        )
      : undefined,
    assignmentWorker: handlers.handleAssignmentExecute
      ? createLoggedWorker(
          QUEUE_NAMES.assignments,
          QUEUE_NAMES.assignments,
          options.assignmentConcurrency ?? 1,
          handlers.handleAssignmentExecute,
        )
      : undefined,
    workerResultWorker: handlers.handleWorkerResultIngested
      ? createLoggedWorker(
          QUEUE_NAMES.workerResults,
          QUEUE_NAMES.workerResults,
          options.workerResultConcurrency ?? 1,
          handlers.handleWorkerResultIngested,
        )
      : undefined,
    leadWorker: handlers.handleLeadDiscovered
      ? createLoggedWorker(
          QUEUE_NAMES.leads,
          QUEUE_NAMES.leads,
          options.leadConcurrency ?? 1,
          handlers.handleLeadDiscovered,
        )
      : undefined,
    reportWorker: handlers.handleReportSynthesisRequested
      ? createLoggedWorker(
          QUEUE_NAMES.reports,
          QUEUE_NAMES.reports,
          options.reportConcurrency ?? 1,
          handlers.handleReportSynthesisRequested,
        )
      : undefined,
    async close(): Promise<void> {
      await Promise.all(workers.map((worker) => worker.close()));
    },
  };

  if (runtime.investigationWorker) workers.push(runtime.investigationWorker);
  if (runtime.assignmentWorker) workers.push(runtime.assignmentWorker);
  if (runtime.workerResultWorker) workers.push(runtime.workerResultWorker);
  if (runtime.leadWorker) workers.push(runtime.leadWorker);
  if (runtime.reportWorker) workers.push(runtime.reportWorker);

  return runtime;
}
