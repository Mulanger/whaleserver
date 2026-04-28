import pino from 'pino';
import { config } from './config.js';

const pinoConfig: pino.LoggerOptions = {
  level: config.LOG_LEVEL,
};

export const logger = pino(pinoConfig);

export type Logger = typeof logger;