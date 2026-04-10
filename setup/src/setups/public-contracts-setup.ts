import type { Abi } from 'abitype';
import { formatAbiItem } from 'abitype';
import { type Hex, toFunctionSelector } from 'viem';

import {
  deleteContract,
  type ContractPermission,
  extractRes,
  type Contract,
  getContractByAddress,
  getContractPermissions,
  postContractPermissions,
  postContracts,
  putContract
} from '../tools/api-client';
import type { Client } from '../tools/create-admin-client';

export type PublicContractSpec = {
  name: string;
  description: string;
  address: `0x${string}`;
  abi: Abi;
};

type DesiredPermission = {
  accessType: 'read' | 'write';
  ruleType: 'public' | 'restrictArgument';
  argumentRestrictions: Array<{ argumentIndex: number }>;
};

const ERC20_RESTRICTED_METHODS: Record<
  Hex,
  { ruleType: 'restrictArgument'; argumentRestrictions: Array<{ argumentIndex: number }> }
> = {
  '0xdd62ed3e': { ruleType: 'restrictArgument', argumentRestrictions: [{ argumentIndex: 0 }] }, // allowance(address,address)
  '0x70a08231': { ruleType: 'restrictArgument', argumentRestrictions: [{ argumentIndex: 0 }] }, // balanceOf(address)
  '0x40c10f19': { ruleType: 'restrictArgument', argumentRestrictions: [{ argumentIndex: 0 }] }, // mint(address,uint256)
  '0x23b872dd': { ruleType: 'restrictArgument', argumentRestrictions: [{ argumentIndex: 0 }] } // transferFrom(address,address,uint256)
};

function isLikelyErc20Contract(contract: PublicContractSpec) {
  const selectors = new Set(
    contract.abi
      .filter((item) => item.type === 'function')
      .map((item) => toFunctionSelector(item))
  );

  return (
    selectors.has('0x70a08231') && // balanceOf(address)
    selectors.has('0x313ce567') && // decimals()
    selectors.has('0x95d89b41') // symbol()
  );
}

function buildContractBody(contract: PublicContractSpec) {
  return {
    abi: JSON.stringify(contract.abi),
    name: contract.name,
    contractAddress: contract.address,
    description: contract.description,
    discloseBytecode: false,
    discloseErc20Balance: isLikelyErc20Contract(contract),
    erc20LockAddresses: []
  };
}

function normalizeAbiJson(abi: Abi | string) {
  if (typeof abi !== 'string') {
    return JSON.stringify(abi);
  }

  try {
    return JSON.stringify(JSON.parse(abi));
  } catch {
    return abi.trim();
  }
}

function fallbackRegisteredContract(contract: PublicContractSpec): Contract {
  return {
    id: contract.address,
    contractAddress: contract.address,
    name: contract.name,
    description: contract.description,
    abi: JSON.stringify(contract.abi)
  };
}

async function recreateContract(
  adminApiClient: Client,
  existingContract: Contract,
  contract: PublicContractSpec
) {
  const contractBody = buildContractBody(contract);
  const deleteTargets = [existingContract.id, existingContract.contractAddress];

  for (const deleteTarget of deleteTargets) {
    const deleteRes = await deleteContract(adminApiClient, deleteTarget);
    if (deleteRes.error === undefined || deleteRes.response.status === 404) {
      return extractRes(await postContracts(adminApiClient, contractBody));
    }
  }

  throw new Error(
    `Unable to refresh contract registration for ${contract.address}; delete failed for both contract id and address`
  );
}

async function syncRegisteredContract(
  adminApiClient: Client,
  existingContract: Contract,
  contract: PublicContractSpec
) {
  const contractBody = buildContractBody(contract);
  const desiredAbi = normalizeAbiJson(contract.abi);
  const currentAbi = normalizeAbiJson(existingContract.abi);
  const needsRefresh =
    currentAbi !== desiredAbi ||
    existingContract.name !== contract.name ||
    existingContract.description !== contract.description;

  if (!needsRefresh) {
    return existingContract;
  }

  const updateTargets = [existingContract.id, existingContract.contractAddress];

  for (const updateTarget of updateTargets) {
    const updateRes = await putContract(adminApiClient, updateTarget, contractBody);
    if (updateRes.error === undefined) {
      return extractRes(updateRes);
    }
  }

  return recreateContract(adminApiClient, existingContract, contract);
}

function desiredPermissionForAbiItem(abiItem: Abi[number]): DesiredPermission {
  if (abiItem.type !== 'function') {
    throw new Error('Expected function ABI item.');
  }

  const methodSelector = toFunctionSelector(abiItem);
  const restricted = ERC20_RESTRICTED_METHODS[methodSelector];
  if (restricted) {
    return {
      accessType:
        abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure'
          ? 'read'
          : 'write',
      ruleType: restricted.ruleType,
      argumentRestrictions: restricted.argumentRestrictions
    };
  }

  return {
    accessType:
      abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure'
        ? 'read'
        : 'write',
    ruleType: 'public',
    argumentRestrictions: []
  };
}

function permissionMatchesDesired(
  permission: ContractPermission,
  desired: DesiredPermission
): boolean {
  if (permission.accessType !== desired.accessType || permission.ruleType !== desired.ruleType) {
    return false;
  }

  const existingRestrictions = permission.argumentRestrictions
    .map((restriction) => restriction.argumentIndex)
    .sort((left, right) => left - right);
  const desiredRestrictions = desired.argumentRestrictions
    .map((restriction) => restriction.argumentIndex)
    .sort((left, right) => left - right);

  return JSON.stringify(existingRestrictions) === JSON.stringify(desiredRestrictions);
}

async function contractPermissionsNeedRefresh(
  adminApiClient: Client,
  contract: Contract,
  abi: Abi
) {
  for (const abiItem of abi) {
    if (abiItem.type !== 'function') {
      continue;
    }

    const methodSelector = toFunctionSelector(abiItem);
    let existingPermission: Awaited<ReturnType<typeof getContractPermissions>> extends infer T
      ? T extends { data?: infer D }
        ? D
        : never
      : never;
    try {
      existingPermission = extractRes(
        await getContractPermissions(adminApiClient, {
          contractAddress: contract.contractAddress,
          methodSelector,
          limit: 20,
          offset: 0
        })
      );
    } catch {
      return true;
    }

    if (existingPermission.items.length === 0) {
      continue;
    }

    const desired = desiredPermissionForAbiItem(abiItem);
    if (!existingPermission.items.some((item) => permissionMatchesDesired(item, desired))) {
      return true;
    }
  }

  return false;
}

async function registerPublicContract(adminApiClient: Client, contract: PublicContractSpec) {
  const contractBody = buildContractBody(contract);
  let registeredContract = fallbackRegisteredContract(contract);

  try {
    const existingRes = await getContractByAddress(adminApiClient, contract.address);
    registeredContract =
      existingRes.response.status === 404
        ? extractRes(await postContracts(adminApiClient, contractBody))
        : await syncRegisteredContract(adminApiClient, extractRes(existingRes), contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      registeredContract = extractRes(await postContracts(adminApiClient, contractBody));
      console.warn(
        `Warning: contract lookup/update failed for ${contract.address}; recovered by creating the registration directly. ${message}`
      );
    } catch (postError) {
      const postMessage = postError instanceof Error ? postError.message : String(postError);
      console.warn(
        `Warning: could not fully sync public contract registration for ${contract.address}; continuing with address-based permission sync. lookup/update=${message}; create=${postMessage}`
      );
    }
  }

  if (await contractPermissionsNeedRefresh(adminApiClient, registeredContract, contract.abi)) {
    try {
      registeredContract = await recreateContract(adminApiClient, registeredContract, contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Warning: could not recreate contract registration for ${contract.address}; continuing with existing registration. ${message}`
      );
    }
  }

  for (const abiItem of contract.abi) {
    if (abiItem.type !== 'function') {
      continue;
    }

    const methodSelector = toFunctionSelector(abiItem);
    const desiredPermission = desiredPermissionForAbiItem(abiItem);
    let existingPermission;
    try {
      existingPermission = extractRes(
        await getContractPermissions(adminApiClient, {
          contractAddress: registeredContract.contractAddress,
          methodSelector,
          limit: 20,
          offset: 0
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Warning: could not inspect existing permissions for ${registeredContract.contractAddress} ${methodSelector}; attempting to post desired permission anyway. ${message}`
      );
      existingPermission = { items: [] };
    }

    if (
      existingPermission.items.some((item) => permissionMatchesDesired(item, desiredPermission))
    ) {
      continue;
    }

    try {
      extractRes(
        await postContractPermissions(adminApiClient, {
          contractAddress: registeredContract.contractAddress,
          accessType: desiredPermission.accessType,
          argumentRestrictions: desiredPermission.argumentRestrictions,
          roles: [],
          functionSignature: formatAbiItem(abiItem),
          methodSelector,
          ruleType: desiredPermission.ruleType
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Warning: could not post permission for ${registeredContract.contractAddress} ${methodSelector}. ${message}`
      );
    }
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
