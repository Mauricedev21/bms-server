import { isProd } from '../config/env';

type Level = 'info' | 'warn' | 'error';

function log(level: Level, message: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (level === 'error') console.error(line, meta !== undefined ? meta : '');
  else if (level === 'warn') console.warn(line, meta !== undefined ? meta : '');
  else console.log(line, meta !== undefined ? meta : '');
}

export const logger = {
  info: (message: string, meta?: unknown) => log('info', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  error: (message: string, meta?: unknown) => log('error', message, meta),
  /** Disable verbose logging outside development. */
  debug: (message: string, meta?: unknown) => {
    if (!isProd) log('info', '[DEBUG] ' + message, meta);
  },
};