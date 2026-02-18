import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Request, type Response, type Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { sendFaucetFunds } from '@/utils/accounts/faucet';
import { createApiResponse } from '@/utils/response/openAPIResponseBuilders';
import { ServiceResponse } from '@/utils/response/serviceResponse';

export const faucetRegistry = new OpenAPIRegistry();
export const faucetRouter: Router = express.Router();

faucetRegistry.registerPath({
  method: 'post',
  path: '/faucet',
  tags: ['Faucet'],
  responses: {
    ...createApiResponse(z.null(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.null(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

faucetRouter.post('/', async (req: Request, res: Response) => {
  const args = req.body;
  console.log('sending funds to:', args);
  let serviceResponse: ServiceResponse<unknown>;
  const BodySchema = z.object({ accountAddress: z.string().length(42) });
  const parsed = BodySchema.safeParse(args);
  if (!parsed.success) {
    serviceResponse = ServiceResponse.failure('Missing account address', null);
  } else {
    const funded = await sendFaucetFunds(args.accountAddress);
    serviceResponse = ServiceResponse.success('Accounts funded.', { funded });
  }
  res.status(serviceResponse.statusCode).send(serviceResponse);
});
