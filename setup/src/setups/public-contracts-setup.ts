import type { Abi } from 'abitype';
import { formatAbiItem } from 'abitype';
import { toFunctionSelector } from 'viem';

import {
  extractRes,
  getContractByAddress,
  getContractPermissions,
  postContractPermissions,
  postContracts
} from '../tools/api-client';
import type { Client } from '../tools/create-admin-client';

export type PublicContractSpec = {
  name: string;
  description: string;
  address: `0x${string}`;
  abi: Abi;
};

async function registerPublicContract(adminApiClient: Client, contract: PublicContractSpec) {
  const existingRes = await getContractByAddress(adminApiClient, contract.address);
  const registeredContract =
    existingRes.response.status === 404
      ? extractRes(
          await postContracts(adminApiClient, {
            abi: JSON.stringify(contract.abi),
            name: contract.name,
            contractAddress: contract.address,
            description: contract.description,
            discloseBytecode: false,
            discloseErc20Balance: false,
            erc20LockAddresses: []
          })
        )
      : extractRes(existingRes);

  for (const abiItem of contract.abi) {
    if (abiItem.type !== 'function') {
      continue;
    }

    const methodSelector = toFunctionSelector(abiItem);
    const existingPermission = extractRes(
      await getContractPermissions(adminApiClient, {
        contractAddress: registeredContract.contractAddress,
        methodSelector,
        limit: 1,
        offset: 0
      })
    );

    if (existingPermission.items.length > 0) {
      continue;
    }

    extractRes(
      await postContractPermissions(adminApiClient, {
        contractAddress: registeredContract.contractAddress,
        accessType:
          abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure'
            ? 'read'
            : 'write',
        argumentRestrictions: [],
        roles: [],
        functionSignature: formatAbiItem(abiItem),
        methodSelector,
        ruleType: 'public'
      })
    );
  }
}

export async function setupPublicContracts(
  adminApiClient: Client,
  contracts: PublicContractSpec[]
) {
  for (const contract of contracts) {
    await registerPublicContract(adminApiClient, contract);
  }
}
