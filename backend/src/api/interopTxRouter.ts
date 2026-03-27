import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Request, type Response, type Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { getChainScopedClients } from '@/utils/client';
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
    accountAddress: z.string().length(42),
    sourceChainId: z.number().int().positive()
  });
  const parsed = BodySchema.safeParse(args);
  if (!parsed.success) {
    serviceResponse = ServiceResponse.failure('Missing transaction hash', null);
  } else {
    try {
      const { client } = getChainScopedClients(args.sourceChainId);
      const receipt = await client.zks.getReceiptWithL2ToL1(args.txHash);
      if (!receipt?.l2ToL1Logs?.length) {
        serviceResponse = ServiceResponse.failure('Invalid transaction', null);
        res.status(serviceResponse.statusCode).send(serviceResponse);
        return;
      }

      const metadata = await extractTxMetadata(receipt);
      const normalizedMetadata =
        metadata.action === 'Unknown' ? { action: 'Interop', amount: metadata.amount } : metadata;
      console.log('ADDING PENDING TX..');
      addPendingTx(args.txHash, normalizedMetadata, args.accountAddress, args.sourceChainId);
      serviceResponse = ServiceResponse.success('Transaction added.', null);
    } catch (error) {
      serviceResponse = ServiceResponse.failure('Error fetching transaction', { error });
    }
  }
  res.status(serviceResponse.statusCode).send(serviceResponse);
});
