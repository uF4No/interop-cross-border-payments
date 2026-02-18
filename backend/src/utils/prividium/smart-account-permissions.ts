import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toFunctionSelector } from 'viem';

import type { Hex } from 'viem';
import { getPrividiumAuthToken } from '../client';
import { env } from '../envConfig';

type AbiItem = {
  type?: string;
};

type AbiFunction = {
  type: 'function';
  name: string;
  inputs: Array<{
    type: string;
    components?: Array<{ type: string; components?: unknown[] }>;
  }>;
  outputs?: Array<{
    type: string;
    components?: Array<{ type: string; components?: unknown[] }>;
  }>;
  stateMutability: string;
};

type ContractRecord = {
  contractAddress: string;
};

function buildApiUrl(path: string) {
  const base = env.PRIVIDIUM_API_URL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function getModularSmartAccountArtifact(): { abi: unknown[]; functions: readonly AbiFunction[] } {
  const candidates = [
    resolve(process.cwd(), 'setup/src/system/contracts/ModularSmartAccount.json'),
    resolve(__dirname, '../../../../setup/src/system/contracts/ModularSmartAccount.json')
  ];

  const artifactPath = candidates.find((candidate) => existsSync(candidate));
  if (!artifactPath) {
    throw new Error('ModularSmartAccount artifact not found for permission setup');
  }

  const raw = JSON.parse(readFileSync(artifactPath, 'utf8')) as { abi?: unknown };
  if (!Array.isArray(raw.abi)) {
    throw new Error('ModularSmartAccount artifact is missing abi');
  }

  const abi = raw.abi as unknown[];
  const functions = abi.filter(
    (item): item is AbiFunction =>
      Boolean(item) &&
      typeof item === 'object' &&
      (item as AbiItem).type === 'function' &&
      'name' in (item as object) &&
      typeof (item as { name?: unknown }).name === 'string' &&
      'inputs' in (item as object) &&
      Array.isArray((item as { inputs?: unknown }).inputs) &&
      'stateMutability' in (item as object) &&
      typeof (item as { stateMutability?: unknown }).stateMutability === 'string'
  );
  return { abi, functions };
}

function formatParamType(param: {
  type: string;
  components?: Array<{ type: string; components?: unknown[] }>;
}): string {
  if (!param.type.startsWith('tuple')) {
    return param.type;
  }

  const suffix = param.type.slice('tuple'.length);
  const tupleMembers: string = (param.components ?? [])
    .map((component) => {
      return formatParamType({
        type: component.type,
        components: component.components as
          | Array<{ type: string; components?: unknown[] }>
          | undefined
      });
    })
    .join(',');

  return `(${tupleMembers})${suffix}`;
}

function formatFunctionSignature(abiItem: AbiFunction): string {
  const params = abiItem.inputs.map((input) => formatParamType(input)).join(',');
  return `${abiItem.name}(${params})`;
}

function formatFunctionSignatureForApi(abiItem: AbiFunction): string {
  const params = abiItem.inputs.map((input) => formatParamType(input)).join(',');
  const returns = (abiItem.outputs ?? []).map((output) => formatParamType(output)).join(', ');
  const mutability =
    abiItem.stateMutability === 'view' ||
    abiItem.stateMutability === 'pure' ||
    abiItem.stateMutability === 'payable'
      ? ` ${abiItem.stateMutability}`
      : '';
  const returnsPart = returns ? ` returns (${returns})` : '';
  return `function ${abiItem.name}(${params})${mutability}${returnsPart}`;
}

async function ensureContractRegistered(
  token: string,
  contractAddress: Hex
): Promise<ContractRecord | null> {
  const { abi } = getModularSmartAccountArtifact();

  const createResponse = await fetch(buildApiUrl('/contracts/'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      abi: JSON.stringify(abi),
      name: 'SSO Smart Account',
      contractAddress,
      description: 'Deployed SSO smart account',
      discloseBytecode: false,
      discloseErc20Balance: false,
      erc20LockAddresses: []
    })
  });

  if (createResponse.ok) {
    return (await createResponse.json()) as ContractRecord;
  }

  const existingResponse = await fetch(
    buildApiUrl(`/contracts/${encodeURIComponent(contractAddress)}`),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (existingResponse.ok) {
    return (await existingResponse.json()) as ContractRecord;
  }

  const createError = await createResponse.text().catch(() => '');
  const existingError = await existingResponse.text().catch(() => '');
  throw new Error(
    `Failed to register contract ${contractAddress}. create=${createResponse.status} ${createError}; get=${existingResponse.status} ${existingError}`
  );
}

export async function configureSmartAccountPermissions(contractAddress: Hex) {
  const token = await getPrividiumAuthToken();
  const contract = await ensureContractRegistered(token, contractAddress);
  const targetAddress = (contract?.contractAddress || contractAddress) as Hex;
  const { functions } = getModularSmartAccountArtifact();

  for (const abiItem of functions) {
    const accessType =
      abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure' ? 'read' : 'write';
    const selectorSignature = formatFunctionSignature(abiItem);
    const functionSignature = formatFunctionSignatureForApi(abiItem);
    const methodSelector = toFunctionSelector(selectorSignature);

    const response = await fetch(buildApiUrl('/contract-permissions/'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contractAddress: targetAddress,
        accessType,
        argumentRestrictions: [],
        roles: [],
        functionSignature,
        methodSelector,
        ruleType: 'public'
      })
    });

    if (response.ok) {
      continue;
    }

    const body = await response.text().catch(() => '');
    if (response.status === 409 || /already|exists/i.test(body)) {
      continue;
    }

    throw new Error(
      `Failed to configure permission for ${functionSignature} (${methodSelector}): ${response.status} ${response.statusText} ${body}`
    );
  }
}
