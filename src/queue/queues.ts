// Valor AI -- Typed BullMQ Queue Definitions

import { Queue, type JobsOptions } from 'bullmq';
import type {
  AssignmentJobPayload,
  InvestigationRequestedPayload,
  LeadDiscoveredPayload,
  QueueSnapshot,
  ReportSynthesisJobPayload,
  WorkerResultJobPayload,
} from '../agents/types';
import { redisOptions } from './connection';

export const QUEUE_NAMES = {
  investigations: 'investigations',
  assignments: 'assignments',
  workerResults: 'worker-results',
  leads: 'leads',
  reports: 'reports',
  deadLetters: 'dead-letters',
} as const;

export interface DeadLetterPayload {
  sourceQueue: string;
  jobName: string;
  jobId?: string;
  failedAt: string;
  attemptsMade: number;
  reason: string;
  payload?: unknown;
}

const assignmentJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 500 },
};

const standardJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 250 },
};

export const investigationQueue = new Queue<
  InvestigationRequestedPayload,
  void,
  'investigation_requested'
>(QUEUE_NAMES.investigations, {
  connection: redisOptions,
  defaultJobOptions: assignmentJobOptions,
});

export const assignmentQueue = new Queue<AssignmentJobPayload, void, 'assignment_execute'>(
  QUEUE_NAMES.assignments,
  {
    connection: redisOptions,
    defaultJobOptions: assignmentJobOptions,
  },
);

export const workerResultQueue = new Queue<
  WorkerResultJobPayload,
  void,
  'worker_result_ingested'
>(QUEUE_NAMES.workerResults, {
  connection: redisOptions,
  defaultJobOptions: standardJobOptions,
});

export const leadQueue = new Queue<LeadDiscoveredPayload, void, 'lead_discovered'>(
  QUEUE_NAMES.leads,
  {
    connection: redisOptions,
    defaultJobOptions: standardJobOptions,
  },
);

export const reportQueue = new Queue<
  ReportSynthesisJobPayload,
  void,
  'report_synthesis_requested'
>(QUEUE_NAMES.reports, {
  connection: redisOptions,
  defaultJobOptions: standardJobOptions,
});

export const deadLetterQueue = new Queue<DeadLetterPayload, void, 'dead_letter'>(
  QUEUE_NAMES.deadLetters,
  {
    connection: redisOptions,
    defaultJobOptions: standardJobOptions,
  },
);

export function enqueueInvestigationRequested(payload: InvestigationRequestedPayload) {
  return investigationQueue.add('investigation_requested', payload);
}

export function enqueueAssignmentJob(payload: AssignmentJobPayload) {
  return assignmentQueue.add('assignment_execute', payload);
}

export function enqueueWorkerResultJob(payload: WorkerResultJobPayload) {
  return workerResultQueue.add('worker_result_ingested', payload);
}

export function enqueueLeadDiscoveredJob(payload: LeadDiscoveredPayload) {
  return leadQueue.add('lead_discovered', payload);
}

export function enqueueReportSynthesisJob(payload: ReportSynthesisJobPayload) {
  return reportQueue.add('report_synthesis_requested', payload);
}

export function enqueueDeadLetter(payload: DeadLetterPayload) {
  return deadLetterQueue.add('dead_letter', payload);
}

export async function getQueueSnapshot(): Promise<QueueSnapshot> {
  const [
    assignmentsPending,
    assignmentsActive,
    leadsPending,
    reportsPending,
    deadLetters,
  ] = await Promise.all([
    assignmentQueue.getWaitingCount(),
    assignmentQueue.getActiveCount(),
    leadQueue.getWaitingCount(),
    reportQueue.getWaitingCount(),
    deadLetterQueue.count(),
  ]);

  return {
    assignmentsPending,
    assignmentsActive,
    leadsPending,
    reportsPending,
    deadLetters,
  };
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    investigationQueue.close(),
    assignmentQueue.close(),
    workerResultQueue.close(),
    leadQueue.close(),
    reportQueue.close(),
    deadLetterQueue.close(),
  ]);
}

console.log('[Queues] BullMQ queues initialized with typed payloads');
