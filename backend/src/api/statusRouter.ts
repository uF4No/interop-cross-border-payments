import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Request, type Response, type Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { loadFinalizedTxs, loadPendingTxs } from '@/utils/relayer/state';
import { createApiResponse } from '@/utils/response/openAPIResponseBuilders';
import { ServiceResponse } from '@/utils/response/serviceResponse';

export const statusRegistry = new OpenAPIRegistry();
export const statusRouter: Router = express.Router();

statusRegistry.registerPath({
  method: 'post',
  path: '/status',
  tags: ['Status'],
  responses: {
    ...createApiResponse(z.null(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.null(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

statusRouter.post('/', async (req: Request, res: Response) => {
  const args = req.body;
  console.log('getting status for account:', args);
  let serviceResponse: ServiceResponse<unknown>;
  const BodySchema = z.object({ accountAddress: z.string().length(42) });
  const parsed = BodySchema.safeParse(args);
  if (!parsed.success) {
    serviceResponse = ServiceResponse.failure('Missing account address', null);
  } else {
    const pending = loadPendingTxs(args.accountAddress);
    const finalized = loadFinalizedTxs(args.accountAddress);
    serviceResponse = ServiceResponse.success('Fetched status:', { pending, finalized });
  }
  res.status(serviceResponse.statusCode).send(serviceResponse);
});
