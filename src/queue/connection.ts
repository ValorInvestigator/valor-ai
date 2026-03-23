// Valor AI -- Redis Connection for BullMQ

import { Redis } from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

export const redisConnection = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null, // required by BullMQ
});

redisConnection.on('connect', () => {
  console.log('[Redis] Connected to Redis');
});

redisConnection.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});
