import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.x-api-key', '*.key', '*.secret', '*.credentials'],
    censor: '[REDACTED]',
  },
});
