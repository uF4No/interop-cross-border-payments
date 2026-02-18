import { mkdirSync } from 'node:fs';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pino } from 'pino';

import errorHandler from '@/middleware/errorHandler';
import rateLimiter from '@/middleware/rateLimiter';
import requestLogger from '@/middleware/requestLogger';

import { deployAccountRouter } from './api/deployAccountRouter';
import { faucetRouter } from './api/faucetRouter';
import { healthCheckRouter } from './api/healthCheckRouter';
import { interopTxRouter } from './api/interopTxRouter';
import { statusRouter } from './api/statusRouter';
import { ensureFactoryDeployed } from './utils/accounts/factory';
import { TXNS_STATE_FOLDER } from './utils/constants';
import { env } from './utils/envConfig';
import { processQueue } from './utils/relayer/relayer';

const logger = pino({ name: 'server start' });
const app: Express = express();

// Set the application to trust the reverse proxy
app.set('trust proxy', true);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(helmet());
app.use(rateLimiter);

// Request logging
app.use(requestLogger);

// Routes
app.use('/health-check', healthCheckRouter);
app.use('/deploy-account', deployAccountRouter);
app.use('/faucet', faucetRouter);
app.use('/status', statusRouter);
app.use('/new-l1-interop-tx', interopTxRouter);

// Error handlers
app.use(errorHandler());

function startBackgroundWorker() {
  mkdirSync(TXNS_STATE_FOLDER, { recursive: true });
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      await processQueue();
    } catch (err) {
      logger.error({ err }, 'processQueue failed');
    } finally {
      running = false;
    }
  };

  // run immediately
  void tick();

  // schedule future runs
  const id = setInterval(() => void tick(), env.POLL_INTERVAL);

  return () => clearInterval(id);
}

const stopWorker = startBackgroundWorker();

// Check factory once on startup (do not block server start)
setTimeout(() => {
  ensureFactoryDeployed().catch((err) => {
    logger.error({ err }, 'ensureFactoryDeployed failed');
  });
}, 0);

export { app, logger, stopWorker };
