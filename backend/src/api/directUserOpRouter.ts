import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Request, type Response, type Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { createApiResponse } from '@/utils/response/openAPIResponseBuilders';
import { ServiceResponse } from '@/utils/response/serviceResponse';
import {
  submitUserOpDirectHandleOps,
  type DirectHandleOpsRequest
} from '@/utils/userops/direct-handle-ops';

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/);

const userOpSchema = z.object({
  sender: addressSchema,
  nonce: hexSchema,
  factory: addressSchema.nullable(),
  factoryData: hexSchema.nullable(),
  callData: hexSchema,
  callGasLimit: hexSchema,
  verificationGasLimit: hexSchema,
  preVerificationGas: hexSchema,
  maxFeePerGas: hexSchema,
  maxPriorityFeePerGas: hexSchema,
  paymaster: addressSchema.nullable(),
  paymasterVerificationGasLimit: hexSchema.nullable(),
  paymasterPostOpGasLimit: hexSchema.nullable(),
  paymasterData: hexSchema.nullable(),
  signature: hexSchema
});

const bodySchema = z.object({
  chainId: z.number().int().positive(),
  entryPoint: addressSchema,
  userOp: userOpSchema,
  beneficiary: addressSchema.optional()
});

const responseSchema = z.object({
  chainId: z.number().int().positive(),
  txHash: hexSchema,
  userOpHash: hexSchema,
  receiptStatus: z.enum(['success', 'reverted']),
  beneficiary: addressSchema,
  executor: addressSchema,
  bundleHash: hexSchema.optional(),
  relayQueued: z.boolean()
});

export const directUserOpRegistry = new OpenAPIRegistry();
export const directUserOpRouter: Router = express.Router();

directUserOpRegistry.registerPath({
  method: 'post',
  path: '/userops/direct-handle-ops',
  tags: ['UserOps'],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: bodySchema
        }
      }
    }
  },
  responses: {
    ...createApiResponse(responseSchema, 'Success', StatusCodes.OK),
    ...createApiResponse(z.null(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

directUserOpRouter.post('/direct-handle-ops', async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const serviceResponse = ServiceResponse.failure('Invalid direct handleOps request', null);
    res.status(serviceResponse.statusCode).send(serviceResponse);
    return;
  }

  try {
    const result = await submitUserOpDirectHandleOps(parsed.data as DirectHandleOpsRequest);
    const serviceResponse = ServiceResponse.success('Direct handleOps submitted', result);
    res.status(serviceResponse.statusCode).send(serviceResponse);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Direct handleOps fallback failed';
    const serviceResponse = ServiceResponse.failure(
      message,
      null,
      StatusCodes.INTERNAL_SERVER_ERROR
    );
    res.status(serviceResponse.statusCode).send(serviceResponse);
  }
});
