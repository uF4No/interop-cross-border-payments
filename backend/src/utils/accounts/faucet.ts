import { type Address, parseEther } from 'viem';
import { entryPoint08Abi } from 'viem/account-abstraction';

import L2_INTEROP_CENTER_JSON from '../abis/L2InteropCenter.json';
import { client, executorAccount, l1Wallet, l2Wallet } from '../client';
import { L2_INTEROP_CENTER, SSO_CONTRACTS } from '../constants';
import type { ChainRuntime } from '../prividium/chainRuntime';

const ENTRYPOINT_TARGET_BALANCE = parseEther('0.25');
const ACCOUNT_TARGET_BALANCE = parseEther('0.25');
const SHADOW_TARGET_BALANCE = parseEther('0.01');

export async function sendFaucetFunds(accountAddress: Address, runtime?: ChainRuntime) {
  const l2PublicClient = runtime?.publicClient ?? client.l2;
  const l2WalletClient = runtime?.walletClient ?? l2Wallet;
  const entryPoint = (runtime?.ssoContracts.entryPoint ?? SSO_CONTRACTS.entryPoint) as Address;
  const interopCenter = (runtime?.interopCenter ?? L2_INTEROP_CENTER) as Address;
  const funded = {
    entryPoint: false,
    ssoAccount: false,
    shadowAccount: false
  };

  const shadowAccount = await getShadowAccount(accountAddress, l2PublicClient, interopCenter);

  // check balances
  const entryPointBalance = await l2PublicClient.readContract({
    address: entryPoint,
    abi: entryPoint08Abi,
    functionName: 'balanceOf',
    args: [accountAddress]
  });
  const accountBalance = await l2PublicClient.getBalance({ address: accountAddress });
  const shadowAccountBalance = shadowAccount
    ? await client.l1.getBalance({ address: shadowAccount })
    : 0n;

  console.log('Entry point balance:', entryPointBalance);
  console.log('accountBalance:', accountBalance);
  if (shadowAccount) {
    console.log('shadowAccountBalance:', shadowAccountBalance);
  } else {
    console.warn('⚠️  Skipping shadow account funding (L2 Interop Center unavailable).');
  }

  if (entryPointBalance < ENTRYPOINT_TARGET_BALANCE) {
    await fundEntryPoint(
      accountAddress,
      l2WalletClient,
      l2PublicClient,
      entryPoint,
      ENTRYPOINT_TARGET_BALANCE - entryPointBalance,
      runtime?.executorAccount ?? executorAccount
    );
    funded.entryPoint = true;
  }

  if (accountBalance < ACCOUNT_TARGET_BALANCE) {
    await fundAccount(
      accountAddress,
      l2WalletClient,
      l2PublicClient,
      ACCOUNT_TARGET_BALANCE - accountBalance,
      runtime?.executorAccount ?? executorAccount
    );
    funded.ssoAccount = true;
  }

  if (shadowAccount && shadowAccountBalance < SHADOW_TARGET_BALANCE) {
    await fundShadowAccount(shadowAccount, SHADOW_TARGET_BALANCE - shadowAccountBalance);
    funded.shadowAccount = true;
  }

  console.log('🎉 Faucet complete! Funded:', funded);
  return funded;
}

async function fundEntryPoint(
  accountAddress: Address,
  walletClient: ChainRuntime['walletClient'],
  publicClient: ChainRuntime['publicClient'],
  entryPoint: Address,
  amount: bigint,
  account = executorAccount
) {
  if (amount <= 0n) {
    return;
  }

  console.log('📥 Depositing to EntryPoint...');
  const depositHash = await walletClient.writeContract({
    account,
    chain: walletClient.chain ?? undefined,
    address: entryPoint,
    abi: entryPoint08Abi,
    functionName: 'depositTo',
    args: [accountAddress],
    value: amount
  });

  console.log(`✅ EntryPoint deposit tx: ${depositHash}`);
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
}

async function fundAccount(
  accountAddress: Address,
  walletClient: ChainRuntime['walletClient'],
  publicClient: ChainRuntime['publicClient'],
  amount: bigint,
  account = executorAccount
) {
  if (amount <= 0n) {
    return;
  }

  console.log('💸 Sending ETH to account...');
  const transferHash = await walletClient.sendTransaction({
    account,
    chain: walletClient.chain ?? undefined,
    to: accountAddress,
    value: amount
  });

  console.log(`✅ Direct transfer tx: ${transferHash}`);
  await publicClient.waitForTransactionReceipt({ hash: transferHash });
}

async function fundShadowAccount(shadowAccount: Address, amount: bigint) {
  if (amount <= 0n) {
    return;
  }

  console.log('🌉 Funding shadow account on Sepolia...');
  const shadowTransferHash = await l1Wallet.sendTransaction({
    to: shadowAccount,
    value: amount
  });

  console.log(`✅ Shadow account funding tx: ${shadowTransferHash}`);
  await client.l1.waitForTransactionReceipt({ hash: shadowTransferHash });
}

async function getShadowAccount(
  l2Address: `0x${string}`,
  publicClient: ChainRuntime['publicClient'],
  interopCenter: Address
) {
  const code = await publicClient.getBytecode({ address: interopCenter });
  if (!code || code === '0x') {
    console.warn(`⚠️  No code at L2_INTEROP_CENTER ${interopCenter}.`);
    return null;
  }

  try {
    const shadowAccount = await publicClient.readContract({
      address: interopCenter,
      abi: L2_INTEROP_CENTER_JSON.abi,
      functionName: 'l1ShadowAccount',
      args: [l2Address]
    });

    return shadowAccount as `0x${string}`;
  } catch (error) {
    console.warn('⚠️  Failed to resolve shadow account:', error);
    return null;
  }
}
