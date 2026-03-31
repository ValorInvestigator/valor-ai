import * as dotenv from 'dotenv';
import { Queue } from 'bullmq';
import { closeRedisConnection, getRedisEndpoint } from '../src/queue/connection';

dotenv.config({ path: __dirname + '/../.env' });

async function purge() {
  const io = require('ioredis');
  const redis = new io(getRedisEndpoint(), { maxRetriesPerRequest: null });
  
  const q = new Queue('assignments', { connection: redis });
  await q.obliterate({ force: true });
  console.log('Assignments Queue Obliterated (Garbage Carlyle/SAGE leads purged).');

  const iq = new Queue('investigations', { connection: redis });
  await iq.obliterate({ force: true });
  console.log('Investigations Queue Obliterated.');

  await closeRedisConnection();
  process.exit(0);
}

purge().catch(console.error);
