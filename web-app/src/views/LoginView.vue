<script setup lang="ts">
import { type Address, type Chain, type Transport, createPublicClient } from 'viem';
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseIcon from '../components/BaseIcon.vue';
import { usePrividium } from '../composables/usePrividium';
import { useRpcClient } from '../composables/useRpcClient';
import { DEPLOY_ACCOUNT_ENDPOINT } from '../utils/sso/constants';
import { createNewPasskey, saveAccountAddress, selectExistingPasskey } from '../utils/sso/passkeys';

const router = useRouter();
const route = useRoute();
const {
  isAuthenticated,
  isAuthenticating,
  authError,
  authenticate,
  getAuthHeaders,
  userProfile,
  refreshUserProfile,
  getChain,
  getTransport
} = usePrividium();
const rpcClient = useRpcClient();

type UserWallet = { walletAddress: string };

// Passkey State (post-auth)
const passkeyUsername = ref('');
const passkeyError = ref<string | null>(null);
const passkeyStep = ref<'idle' | 'checking' | 'creating' | 'deploying' | 'done'>('idle');
const setupMode = ref<'create' | 'existing' | null>(null);
const setupSelection = ref<'create' | 'existing'>('create');
const completedAccountAddress = ref<string | null>(null);

watch(isAuthenticated, (next) => {
  if (next) {
    passkeyError.value = null;
    passkeyStep.value = 'idle';
    setupMode.value = null;
    setupSelection.value = 'create';
    completedAccountAddress.value = null;
  }
});

async function ensureUserProfileReady(options?: { requireUserId?: boolean }) {
  const requireUserId = options?.requireUserId ?? false;
  if (userProfile.value && (!requireUserId || userProfile.value.userId)) return;

  await refreshUserProfile();

  if (userProfile.value && (!requireUserId || userProfile.value.userId)) return;
  if (!userProfile.value) {
    throw new Error('User profile not available');
  }
  if (requireUserId) {
    throw new Error('User profile missing id');
  }
}

const login = async () => {
  await authenticate();
};

async function redirectAfterAuth() {
  const redirectPath = (route.query.redirect as string) || '/';
  await router.push(redirectPath);
}

async function continueToApp() {
  await redirectAfterAuth();
}

const createPasskey = async () => {
  if (!passkeyUsername.value) return;
  passkeyError.value = null;
  completedAccountAddress.value = null;
  setupMode.value = 'create';
  passkeyStep.value = 'creating';

  try {
    await ensureUserProfileReady({ requireUserId: true });
    const userId = userProfile.value?.userId;
    if (!userId) {
      throw new Error('User profile missing id');
    }

    // 1. Create Passkey
    const creds = await createNewPasskey(passkeyUsername.value);

    // 2. Deploy Account
    passkeyStep.value = 'deploying';

    const response = await fetch(DEPLOY_ACCOUNT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        originDomain: window.location.origin,
        credentialId: creds.credentialId,
        credentialPublicKey: creds.credentialPublicKey
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'Failed to deploy smart account');
    }

    const data = (await response.json()) as {
      responseObject?: {
        accountAddress?: string;
        walletAssociated?: boolean;
        walletAssociationError?: string;
      };
      accountAddress?: string;
    };
    const accountAddress = data?.responseObject?.accountAddress ?? data?.accountAddress;
    if (!accountAddress || !accountAddress.startsWith('0x')) {
      throw new Error('No account address returned from backend');
    }
    if (data?.responseObject?.walletAssociated === false) {
      throw new Error(
        data?.responseObject?.walletAssociationError || 'Backend failed to link wallet to user'
      );
    }
    const accountAddressHex = accountAddress as `0x${string}`;

    // 3. Save account and refresh the profile with linked wallets from backend.
    saveAccountAddress(accountAddressHex);
    await refreshUserProfile();
    completedAccountAddress.value = accountAddressHex;
    passkeyStep.value = 'done';
  } catch (e) {
    console.error(e);
    passkeyError.value = e instanceof Error ? e.message : 'Unknown error during passkey creation';
    passkeyStep.value = 'idle';
    setupMode.value = null;
  }
};

const useExistingPasskey = async () => {
  passkeyError.value = null;
  completedAccountAddress.value = null;
  setupMode.value = 'existing';
  passkeyStep.value = 'checking';

  try {
    const displayName = passkeyUsername.value || userProfile.value?.displayName || 'User';
    const headers = getAuthHeaders();
    if (!headers) {
      throw new Error('Authentication required');
    }
    if (!userProfile.value) {
      await refreshUserProfile();
    }
    if (!userProfile.value) {
      throw new Error('User profile not available');
    }
    console.debug('[passkeys] profile loaded', userProfile.value);
    const profileWallets = userProfile.value as {
      walletAddresses?: string[];
      wallets?: UserWallet[];
    } | null;
    console.debug('[passkeys] profile wallets (raw)', {
      walletAddresses: profileWallets?.walletAddresses,
      wallets: profileWallets?.wallets
    });
    const profileWalletList = (profileWallets?.wallets ?? []).map((w) => w.walletAddress);
    const linkedWallets = (userProfile.value.walletAddresses ?? profileWalletList).map((w) =>
      w.toLowerCase()
    );
    console.debug('[passkeys] linked wallets (normalized)', linkedWallets);
    if (!linkedWallets.length) {
      throw new Error(
        'No linked wallets found for this user. Create a new passkey first or link a wallet to your profile.'
      );
    }
    const authClient =
      rpcClient.value ??
      createPublicClient({
        chain: getChain() as unknown as Chain,
        transport: getTransport() as unknown as Transport
      });
    console.debug('[passkeys] rpc client', {
      chain: getChain(),
      transport: getTransport()
    });
    const fromAddress = linkedWallets[0] as Address;
    console.debug('[passkeys] using from address', fromAddress);
    const result = await selectExistingPasskey(displayName, authClient, fromAddress);
    console.debug('[passkeys] selectExistingPasskey result', result);
    const accountAddress = result.accountAddress?.toLowerCase();
    console.debug('[passkeys] passkey account address', accountAddress);
    console.debug(
      '[passkeys] passkey linked?',
      accountAddress ? linkedWallets.includes(accountAddress) : false
    );
    if (accountAddress && !linkedWallets.includes(accountAddress)) {
      throw new Error(
        'This passkey account is not linked to your profile. Create it again to link automatically.'
      );
    }
    completedAccountAddress.value = result.accountAddress;
    passkeyStep.value = 'done';
  } catch (e) {
    console.error(e);
    passkeyError.value = e instanceof Error ? e.message : 'Unknown error during passkey selection';
    passkeyStep.value = 'idle';
    setupMode.value = null;
  }
};

const resetSetup = () => {
  if (['checking', 'creating', 'deploying'].includes(passkeyStep.value)) return;
  passkeyUsername.value = '';
  passkeyError.value = null;
  passkeyStep.value = 'idle';
  setupMode.value = null;
  setupSelection.value = 'create';
  completedAccountAddress.value = null;
};
</script>

<template>
  <div class="min-h-[70vh] flex items-center justify-center p-6">
    <div :class="['w-full enterprise-card overflow-hidden', isAuthenticated ? 'max-w-4xl' : 'max-w-md']">
      <div class="p-8 md:p-10">
        <div class="text-center mb-10 md:mb-12">
          <h2 :class="isAuthenticated ? 'text-4xl md:text-5xl font-bold text-slate-900 mb-3' : 'text-lg font-semibold text-slate-800 mb-2'">
            {{ isAuthenticated ? 'Get Started' : 'Secure Access' }}
          </h2>
          <p class="text-slate-500 text-sm">
            {{
              isAuthenticated
                ? 'Set up your secure smart wallet to deploy and link it with your Prividium profile.'
                : 'Please authenticate to access your dashboard.'
            }}
          </p>
        </div>

        <!-- AUTHENTICATING STATE -->
        <div v-if="isAuthenticating" class="flex flex-col items-center py-8">
          <div class="w-10 h-10 border-4 border-accent/10 border-t-accent rounded-full animate-spin mb-4"></div>
          <p class="text-slate-500 text-xs font-bold uppercase tracking-widest animate-pulse">Authenticating...</p>
        </div>

        <!-- POST-AUTH PASSKEY FLOW -->
        <div v-else-if="isAuthenticated" class="space-y-4">
          <div class="rounded-3xl border border-slate-200 bg-white px-5 py-5 md:px-6">
            <div class="flex flex-col gap-4 md:flex-row md:items-start">
              <div class="shrink-0">
                <div
                  v-if="passkeyStep === 'checking' || passkeyStep === 'creating'"
                  class="w-11 h-11 rounded-full border-2 border-accent/20 border-t-accent animate-spin"
                ></div>
                <div
                  v-else-if="passkeyStep === 'deploying' || passkeyStep === 'done'"
                  class="w-11 h-11 rounded-full bg-green-100 text-green-700 flex items-center justify-center"
                >
                  <BaseIcon name="CheckIcon" class="w-6 h-6" />
                </div>
                <div
                  v-else
                  class="w-11 h-11 rounded-full border border-dashed border-slate-300 text-slate-500 text-sm font-semibold flex items-center justify-center"
                >
                  1
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="text-2xl font-semibold text-slate-900 leading-tight">Security Key Setup</p>
                    <p class="text-sm text-slate-500 mt-1">
                      {{
                        passkeyStep === 'checking'
                          ? 'Validating your existing passkey.'
                          : passkeyStep === 'creating'
                            ? 'Creating your new passkey on this device.'
                            : passkeyStep === 'deploying' || passkeyStep === 'done'
                              ? 'Security key ready for account setup.'
                              : 'Choose how you want to proceed.'
                      }}
                    </p>
                  </div>
                  <button
                    v-if="passkeyStep === 'done'"
                    @click="resetSetup"
                    class="enterprise-button-secondary px-5 py-2.5 text-sm"
                  >
                    Reset
                  </button>
                </div>

                <div class="mt-4 inline-flex items-center rounded-xl bg-slate-100 p-1">
                  <button
                    @click="setupSelection = 'create'"
                    :disabled="passkeyStep !== 'idle'"
                    :class="[
                      'px-4 py-2 text-sm font-semibold rounded-lg transition',
                      setupSelection === 'create'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500',
                      passkeyStep !== 'idle' ? 'opacity-60 cursor-not-allowed' : ''
                    ]"
                  >
                    Create New Passkey
                  </button>
                  <button
                    @click="setupSelection = 'existing'"
                    :disabled="passkeyStep !== 'idle'"
                    :class="[
                      'px-4 py-2 text-sm font-semibold rounded-lg transition',
                      setupSelection === 'existing'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500',
                      passkeyStep !== 'idle' ? 'opacity-60 cursor-not-allowed' : ''
                    ]"
                  >
                    Use Existing
                  </button>
                </div>

                <div v-if="setupSelection === 'create' && passkeyStep === 'idle'" class="mt-4">
                  <label class="text-xs font-bold text-slate-700 uppercase tracking-wide">Username</label>
                  <input
                    v-model="passkeyUsername"
                    type="text"
                    placeholder="ex. alice"
                    class="mt-2 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
                    @keyup.enter="createPasskey"
                  />
                </div>

                <p v-else-if="setupSelection === 'existing' && passkeyStep === 'idle'" class="mt-4 text-sm text-slate-500">
                  Select your existing passkey to continue with the wallet already linked to your profile.
                </p>
                <div class="mt-5 flex md:justify-end">
                <button
                  v-if="passkeyStep === 'idle'"
                  @click="setupSelection === 'create' ? createPasskey() : useExistingPasskey()"
                  :disabled="setupSelection === 'create' && !passkeyUsername"
                    class="enterprise-button-primary w-full md:w-64 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {{ setupSelection === 'create' ? 'Create Passkey' : 'Use Existing Passkey' }}
                </button>
                <button
                  v-else-if="passkeyStep === 'checking' || passkeyStep === 'creating'"
                  disabled
                    class="enterprise-button-secondary w-full md:w-64 py-3 opacity-70 cursor-not-allowed"
                >
                  Processing...
                </button>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-3xl border border-slate-200 bg-white px-5 py-5 md:px-6">
            <div class="flex flex-col gap-4 md:flex-row md:items-center">
              <div class="shrink-0">
                <div
                  v-if="passkeyStep === 'deploying'"
                  class="w-11 h-11 rounded-full border-2 border-accent/20 border-t-accent animate-spin"
                ></div>
                <div
                  v-else-if="passkeyStep === 'done' && setupMode === 'create'"
                  class="w-11 h-11 rounded-full bg-green-100 text-green-700 flex items-center justify-center"
                >
                  <BaseIcon name="CheckIcon" class="w-6 h-6" />
                </div>
                <div
                  v-else-if="passkeyStep === 'done' && setupMode === 'existing'"
                  class="w-11 h-11 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-lg font-semibold"
                >
                  -
                </div>
                <div
                  v-else
                  class="w-11 h-11 rounded-full border border-dashed border-slate-300 text-slate-500 text-sm font-semibold flex items-center justify-center"
                >
                  2
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <p class="text-2xl font-semibold text-slate-900 leading-tight">Deploy & Link Smart Wallet</p>
                <p class="text-sm text-slate-500 mt-1">
                  {{
                    passkeyStep === 'deploying'
                      ? 'Deploying wallet, funding it, and linking it to your Prividium profile.'
                      : passkeyStep === 'done' && setupMode === 'create'
                        ? 'Smart wallet deployed and linked.'
                        : passkeyStep === 'done' && setupMode === 'existing'
                          ? 'Skipped. Existing linked passkey selected.'
                          : 'This step starts after passkey setup.'
                  }}
                </p>
              </div>

            </div>
          </div>

          <div
            v-if="passkeyStep === 'done'"
            class="rounded-3xl border border-green-200 bg-green-50 px-5 py-5 md:px-6"
          >
            <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p class="text-base font-semibold text-green-900">
                  {{
                    setupMode === 'create'
                      ? 'Smart account deployed and linked to your Prividium profile.'
                      : 'Passkey selected successfully.'
                  }}
                </p>
                <p v-if="completedAccountAddress" class="mt-1 text-sm text-green-800 break-all">
                  Account: {{ completedAccountAddress }}
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  @click="continueToApp"
                  class="enterprise-button-primary px-5 py-3"
                >
                  Continue to App
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- STANDARD LOGIN STATE -->
        <div v-else class="space-y-6">
          <button 
            @click="login"
            class="enterprise-button-primary w-full py-4 text-base"
          >
            Authenticate via Prividium
          </button>
        </div>

        <div v-if="authError || passkeyError" class="mt-8 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
          <BaseIcon name="ExclamationTriangleIcon" class="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p class="text-xs text-red-700 font-bold leading-relaxed">{{ authError || passkeyError }}</p>
        </div>
      </div>
      
      <div class="bg-slate-50/50 px-8 py-5 flex justify-center items-center gap-2 border-t border-slate-100">
        <p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Powered by ZKsync Prividium™</p>
      </div>
    </div>
  </div>
</template>
