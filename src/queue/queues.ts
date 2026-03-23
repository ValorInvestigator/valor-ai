// Valor AI -- BullMQ Queue Definitions

import { Queue } from 'bullmq';
import { redisConnection } from './connection';

// Main assignment queue -- Manager drops tasks, Workers pull them
export const assignmentQueue = new Queue('assignments', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

// Lead queue -- Workers push discovered leads, Manager processes them
export const leadQueue = new Queue('leads', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 5000 },
  },
});

// Report queue -- completed reports ready for synthesis
export const reportQueue = new Queue('reports', {
  connection: redisConnection,
});

console.log('[Queues] BullMQ queues initialized: assignments, leads, reports');
