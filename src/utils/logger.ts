// Valor AI -- Logger Utility
// Owner: Claude Code
// Simple structured logging. Can be swapped for winston/pino later.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export function log(level: LogLevel, component: string, message: string, data?: any): void {
  if (!shouldLog(level)) return;

  const prefix = `[${timestamp()}] [${level.toUpperCase()}] [${component}]`;
  const line = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  debug: (component: string, msg: string, data?: any) => log('debug', component, msg, data),
  info: (component: string, msg: string, data?: any) => log('info', component, msg, data),
  warn: (component: string, msg: string, data?: any) => log('warn', component, msg, data),
  error: (component: string, msg: string, data?: any) => log('error', component, msg, data),
};
