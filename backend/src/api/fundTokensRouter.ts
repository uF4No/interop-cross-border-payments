import { randomUUID } from 'node:crypto';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Request, type Response, type Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { fundAccountTokens } from '@/utils/accounts/deploy-account';
import { createApiResponse } from '@/utils/response/openAPIResponseBuilders';
import { ServiceResponse } from '@/utils/response/serviceResponse';

type TokenFundingJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

type TokenFundingJob = {
  id: string;
  accountAddress: `0x${string}`;
  status: TokenFundingJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  tokenMintResults?: unknown;
  error?: string;
};

export const fundTokensRegistry = new OpenAPIRegistry();
export const fundTokensRouter: Router = express.Router();
const jobs = new Map<string, TokenFundingJob>();
const queuedJobIds: string[] = [];
let isWorkerRunning = false;

fundTokensRegistry.registerPath({
  method: 'post',
  path: '/fund-tokens',
  tags: ['Faucet'],
  responses: {
    ...createApiResponse(z.null(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.null(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

fundTokensRegistry.registerPath({
  method: 'get',
  path: '/fund-tokens/{jobId}',
  tags: ['Faucet'],
  responses: {
    ...createApiResponse(z.null(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.null(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

function findActiveJobForAccount(accountAddress: string): TokenFundingJob | null {
  const normalized = accountAddress.toLowerCase();
  for (const job of jobs.values()) {
    if (
      job.accountAddress.toLowerCase() === normalized &&
      (job.status === 'queued' || job.status === 'running')
    ) {
      return job;
    }
  }
  return null;
}

async function runTokenFundingWorker() {
  if (isWorkerRunning) {
    return;
  }
  isWorkerRunning = true;

  try {
    while (queuedJobIds.length > 0) {
      const nextJobId = queuedJobIds.shift();
      if (!nextJobId) {
        continue;
      }

      const job = jobs.get(nextJobId);
      if (!job) {
        continue;
      }

      job.status = 'running';
      job.startedAt = new Date().toISOString();
      console.log(
        `[fund-tokens] ▶️ job ${job.id} started for ${job.accountAddress} at ${job.startedAt}`
      );

      try {
        const tokenMintResults = await fundAccountTokens(job.accountAddress);
        job.tokenMintResults = tokenMintResults;

        const failedCount = tokenMintResults.filter(
          (entry) => entry && typeof entry === 'object' && 'minted' in entry && !entry.minted
        ).length;
        job.status = failedCount > 0 ? 'failed' : 'succeeded';
        job.finishedAt = new Date().toISOString();

        console.log(
          `[fund-tokens] ✅ job ${job.id} completed for ${job.accountAddress} with status=${job.status} failed=${failedCount}/${tokenMintResults.length}`
        );
      } catch (error) {
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.error = error instanceof Error ? error.message : String(error);
        console.error(
          `[fund-tokens] ❌ job ${job.id} failed for ${job.accountAddress}: ${job.error}`
        );
      }
    }
  } finally {
    isWorkerRunning = false;
    console.log('[fund-tokens] worker idle');
  }
}

fundTokensRouter.post('/', async (req: Request, res: Response) => {
  const args = req.body;
  console.log('[fund-tokens] request received:', args);

  let serviceResponse: ServiceResponse<unknown>;
  const BodySchema = z.object({
    accountAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
  });
  const parsed = BodySchema.safeParse(args);
  if (!parsed.success) {
    serviceResponse = ServiceResponse.failure('Missing account address', null);
  } else {
    const accountAddress = parsed.data.accountAddress as `0x${string}`;
    const existingJob = findActiveJobForAccount(accountAddress);
    if (existingJob) {
      console.log(
        `[fund-tokens] reusing existing job ${existingJob.id} for ${existingJob.accountAddress} (status=${existingJob.status})`
      );
      serviceResponse = ServiceResponse.success('Token funding already in progress.', {
        jobId: existingJob.id,
        status: existingJob.status,
        accountAddress: existingJob.accountAddress
      });
    } else {
      const jobId = randomUUID();
      const job: TokenFundingJob = {
        id: jobId,
        accountAddress,
        status: 'queued',
        createdAt: new Date().toISOString()
      };
      jobs.set(job.id, job);
      queuedJobIds.push(job.id);

      console.log(
        `[fund-tokens] enqueued job ${job.id} for ${job.accountAddress}. queue_length=${queuedJobIds.length}`
      );
      void runTokenFundingWorker();

      serviceResponse = ServiceResponse.success('Token funding queued.', {
        jobId: job.id,
        status: job.status,
        accountAddress: job.accountAddress
      });
    }
  }

  res.status(serviceResponse.statusCode).send(serviceResponse);
});

fundTokensRouter.get('/:jobId', (req: Request, res: Response) => {
  const rawJobId = req.params.jobId;
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
  if (!jobId) {
    const invalidResponse = ServiceResponse.failure(
      'Token funding job id is required.',
      null,
      StatusCodes.BAD_REQUEST
    );
    res.status(invalidResponse.statusCode).send(invalidResponse);
    return;
  }
  const job = jobs.get(jobId);

  let serviceResponse: ServiceResponse<unknown>;
  if (!job) {
    serviceResponse = ServiceResponse.failure('Token funding job not found.', null, StatusCodes.NOT_FOUND);
  } else {
    serviceResponse = ServiceResponse.success('Token funding job status.', job);
  }

  res.status(serviceResponse.statusCode).send(serviceResponse);
});
