import { type Address, parseEther } from 'viem';
import { entryPoint08Abi } from 'viem/account-abstraction';

import L2_INTEROP_CENTER_JSON from '../abis/L2InteropCenter.json';
import { client, l1Wallet, l2Wallet } from '../client';
import { L2_INTEROP_CENTER, SSO_CONTRACTS } from '../constants';

const FAUCET_AMOUNT = parseEther('0.03');
const MIN_BALANCE = parseEther('0.005');

export async function sendFaucetFunds(accountAddress: Address) {
  const funded = {
    entryPoint: false,
    ssoAccount: false,
    shadowAccount: false
  };

  const shadowAccount = await getShadowAccount(accountAddress);

  // check balances
  const entryPointBalance = await client.l2.readContract({
    address: SSO_CONTRACTS.entryPoint,
    abi: entryPoint08Abi,
    functionName: 'balanceOf',
    args: [accountAddress]
  });
  const accountBalance = await client.l2.getBalance({ address: accountAddress });
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

  // if balances are low, send funds
  if (entryPointBalance < MIN_BALANCE) {
    await fundEntryPoint(accountAddress);
    funded.entryPoint = true;
  }

  if (accountBalance < MIN_BALANCE) {
    await fundAccount(accountAddress);
    funded.ssoAccount = true;
  }

  if (shadowAccount && shadowAccountBalance < MIN_BALANCE) {
    await fundShadowAccount(shadowAccount);
    funded.shadowAccount = true;
  }

  console.log('🎉 Faucet complete! Funded:', funded);
  return funded;
}

async function fundEntryPoint(accountAddress: Address) {
  console.log('📥 Depositing to EntryPoint...');
  const depositHash = await l2Wallet.writeContract({
    address: SSO_CONTRACTS.entryPoint,
    abi: entryPoint08Abi,
    functionName: 'depositTo',
    args: [accountAddress],
    value: FAUCET_AMOUNT
  });

  console.log(`✅ EntryPoint deposit tx: ${depositHash}`);
  await client.l2.waitForTransactionReceipt({ hash: depositHash });
}

async function fundAccount(accountAddress: Address) {
  console.log('💸 Sending ETH to account...');
  const transferHash = await l2Wallet.sendTransaction({
    to: accountAddress,
    value: FAUCET_AMOUNT
  });

  console.log(`✅ Direct transfer tx: ${transferHash}`);
  await client.l2.waitForTransactionReceipt({ hash: transferHash });
}

async function fundShadowAccount(shadowAccount: Address) {
  console.log('🌉 Funding shadow account on Sepolia...');
  const SHADOW_AMOUNT = parseEther('0.01');
  const shadowTransferHash = await l1Wallet.sendTransaction({
    to: shadowAccount,
    value: SHADOW_AMOUNT
  });

  console.log(`✅ Shadow account funding tx: ${shadowTransferHash}`);
  await client.l1.waitForTransactionReceipt({ hash: shadowTransferHash });
}

async function getShadowAccount(l2Address: `0x${string}`) {
  const code = await client.l2.getBytecode({ address: L2_INTEROP_CENTER });
  if (!code || code === '0x') {
    console.warn(`⚠️  No code at L2_INTEROP_CENTER ${L2_INTEROP_CENTER}.`);
    return null;
  }

  try {
    const shadowAccount = await client.l2.readContract({
      address: L2_INTEROP_CENTER,
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
