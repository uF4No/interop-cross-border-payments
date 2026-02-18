import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Request, type Response, type Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { client } from '@/utils/client';
import { extractTxMetadata } from '@/utils/relayer/metadata';
import { addPendingTx } from '@/utils/relayer/state';
import { createApiResponse } from '@/utils/response/openAPIResponseBuilders';
import { ServiceResponse } from '@/utils/response/serviceResponse';

export const interopTxRegistry = new OpenAPIRegistry();
export const interopTxRouter: Router = express.Router();

interopTxRegistry.registerPath({
  method: 'post',
  path: '/new-l1-interop-tx',
  tags: ['New Interop Tx'],
  responses: {
    ...createApiResponse(z.null(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.null(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

interopTxRouter.post('/', async (req: Request, res: Response) => {
  const args = req.body;
  console.log('Adding new interop tx:', args);
  let serviceResponse: ServiceResponse<unknown>;
  const BodySchema = z.object({
    txHash: z.string().length(66),
    accountAddress: z.string().length(42)
  });
  const parsed = BodySchema.safeParse(args);
  if (!parsed.success) {
    serviceResponse = ServiceResponse.failure('Missing transaction hash', null);
  } else {
    try {
      const receipt = await client.zks.getReceiptWithL2ToL1(args.txHash);
      const metadata = await extractTxMetadata(receipt);
      // check if tx has correct logs
      if (metadata.action !== 'Deposit' && metadata.action !== 'Withdrawal') {
        serviceResponse = ServiceResponse.failure('Invalid transaction', null);
      } else {
        console.log('ADDING PENDING TX..');
        addPendingTx(args.txHash, metadata, args.accountAddress);
        serviceResponse = ServiceResponse.success('Transaction added.', null);
      }
    } catch (error) {
      serviceResponse = ServiceResponse.failure('Error fetching transaction', { error });
    }
  }
  res.status(serviceResponse.statusCode).send(serviceResponse);
});
