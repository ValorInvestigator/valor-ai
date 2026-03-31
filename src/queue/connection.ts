// Valor AI -- Redis Connection Helpers for BullMQ

import Redis, { type RedisOptions } from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

export type RedisConnection = Redis;

export const redisOptions: RedisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    if (times > 3) return null;
    return Math.min(times * 500, 2000);
  },
};

function wireRedisLogging(connection: RedisConnection, label: string): void {
  let lastErrorMessage = '';
  let lastErrorAt = 0;

  connection.on('connect', () => {
    console.log(`[Redis:${label}] Connected`);
  });

  connection.on('error', (err: Error) => {
    const now = Date.now();
    if (err.message === lastErrorMessage && now - lastErrorAt < 5000) {
      return;
    }

    lastErrorMessage = err.message;
    lastErrorAt = now;
    console.error(`[Redis:${label}] Connection error: ${err.message}`);
  });
}

export function createRedisConnection(label = 'shared', quiet = false): RedisConnection {
  const connection = new Redis(redisOptions);

  if (quiet) {
    connection.on('error', () => undefined);
  } else {
    wireRedisLogging(connection, label);
  }

  return connection;
}

export function getRedisEndpoint(): { host: string; port: number } {
  return {
    host: String(redisOptions.host ?? '127.0.0.1'),
    port: Number(redisOptions.port ?? 6379),
  };
}

// Lazy singleton -- only created when something actually needs it
let _redisConnection: RedisConnection | null = null;

export function getRedisConnection(): RedisConnection {
  if (!_redisConnection) {
    _redisConnection = createRedisConnection();
  }
  return _redisConnection;
}

// Keep backward compat as a getter so existing imports still work
export const redisConnection: RedisConnection = new Proxy({} as RedisConnection, {
  get(_target, prop, receiver) {
    return Reflect.get(getRedisConnection(), prop, receiver);
  },
});

export async function closeRedisConnection(
  connection?: RedisConnection,
): Promise<void> {
  const conn = connection ?? _redisConnection;
  if (!conn || conn.status === 'end') {
    return;
  }

  try {
    await conn.quit();
  } catch {
    conn.disconnect();
  }
}

