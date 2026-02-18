<template>
  <div class="max-w-6xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 pt-8">
    
    <!-- Hero / Balance Section (Matching Image 0) -->
    <div class="flex flex-col items-center justify-center text-center py-12 space-y-6">
      <div class="space-y-2">
        <p class="text-sm font-semibold text-slate-500">Your Counter Value</p>
        <h2 class="text-6xl font-bold text-slate-900 tracking-tight transition-all tabular-nums">
          {{ counterValue || '0' }} <span class="text-3xl text-slate-400 font-medium ml-1">UNITS</span>
        </h2>
        <div class="flex items-center gap-2 justify-center bg-white px-4 py-1.5 rounded-full border border-slate-100 shadow-sm mt-4 group cursor-pointer hover:border-accent/30 transition-all" @click="copyContractAddress">
          <span class="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2">Target Contract</span>
          <span class="text-xs font-mono text-slate-500">{{ currentContractAddress?.slice(0, 10) }}...{{ currentContractAddress?.slice(-8) }}</span>
          <BaseIcon :name="copied ? 'CheckIcon' : 'DocumentDuplicateIcon'" :class="copied ? 'text-green-500' : 'text-slate-300 group-hover:text-accent'" class="w-3.5 h-3.5 transition-colors" />
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-center gap-4 pt-4">
        <button 
          @click="incrementCounter"
          :disabled="isLoading"
          class="enterprise-button-primary min-w-[180px] h-14 text-base font-semibold"
        >
          <BaseIcon name="PlusCircleIcon" class="w-5 h-5" />
          Increment
        </button>
        <button 
          @click="getCounterValue"
          :disabled="isLoading"
          class="enterprise-button-secondary min-w-[180px] h-14 text-base font-semibold"
        >
          <BaseIcon name="ArrowPathIcon" :class="{ 'animate-spin': isLoading }" class="w-5 h-5" />
          Refresh
        </button>
      </div>
    </div>

    <!-- Error Banner -->
    <div v-if="errorMessage" class="mx-auto w-full max-w-2xl px-5 py-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 animate-in slide-in-from-top-2 duration-300">
      <BaseIcon name="ExclamationTriangleIcon" class="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <p class="min-w-0 flex-1 text-red-800 font-semibold text-xs leading-relaxed" style="overflow-wrap:anywhere;">
        {{ errorMessage }}
      </p>
      <button @click="errorMessage = ''" class="text-red-400 hover:text-red-600 transition-colors shrink-0">&times;</button>
    </div>

    <!-- Secondary Actions & Info -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <!-- Batch Operation Card -->
      <div class="enterprise-card p-8 space-y-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-bold text-slate-900">Operation</h3>
          <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
            <BaseIcon name="BoltIcon" class="w-5 h-5 text-slate-400" />
          </div>
        </div>
        <p class="text-slate-500 text-sm">Update the counter by a specific amount in a single transaction.</p>
        
        <div class="flex gap-3 mt-4">
          <input 
            v-model="incrementAmount"
            type="number"
            min="1"
            placeholder="Amount"
            class="enterprise-input flex-grow h-12"
          />
          <button 
            @click="incrementCounterBy"
            :disabled="!incrementAmount || parseInt(incrementAmount) <= 0 || isLoading"
            class="bg-slate-900 text-white px-8 rounded-full font-bold text-sm hover:opacity-90 transition-all disabled:opacity-30 active:scale-95"
          >
            SEND TRANSACTION
          </button>
        </div>
      </div>

      <!-- System Status Card -->
      <div class="enterprise-card p-8 space-y-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-bold text-slate-900">System Status</h3>
          <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
            <BaseIcon name="ShieldCheckIcon" class="w-5 h-5 text-slate-400" />
          </div>
        </div>
        
        <div class="space-y-4">
          <div class="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
            <span class="text-sm font-medium text-slate-600">Network Connector</span>
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold" :class="isConnected ? 'text-green-600' : 'text-red-500'">
                {{ isConnected ? 'Operational' : 'Disconnected' }}
              </span>
              <div class="w-2 h-2 rounded-full" :class="isConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500'"></div>
            </div>
          </div>
          
          <div class="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
            <span class="text-sm font-medium text-slate-600">Wallet Link</span>
            <span class="text-xs font-mono text-slate-500" v-if="ssoAccount">0x...{{ ssoAccount?.slice(-4) }}</span>
            <span class="text-xs font-bold text-slate-400" v-else>Not Linked</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Activity -->
    <div class="enterprise-card overflow-hidden">
      <div class="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
        <h4 class="text-lg font-bold text-slate-900">Latest Activity</h4>
        <span class="text-xs font-bold text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">{{ transactions.length }} total</span>
      </div>
      
      <div class="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
        <div v-if="transactions.length === 0" class="px-8 py-16 text-center">
          <BaseIcon name="InboxIcon" class="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <p class="text-slate-400 text-sm font-medium">No recent transactions</p>
        </div>
        
        <div 
          v-for="tx in transactions" 
          :key="tx.id" 
          class="px-8 py-5 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
        >
          <div class="flex items-center gap-4">
            <div 
              class="w-10 h-10 rounded-full flex items-center justify-center border"
              :class="{
                'bg-green-50 border-green-100 text-green-600': tx.status === 'success',
                'bg-amber-50 border-amber-100 text-amber-600': tx.status === 'pending',
                'bg-red-50 border-red-100 text-red-600': tx.status === 'failed'
              }"
            >
              <BaseIcon v-if="tx.status === 'success'" name="CheckIcon" class="w-5 h-5" />
              <BaseIcon v-else-if="tx.status === 'pending'" name="ArrowPathIcon" class="w-5 h-5 animate-spin" />
              <BaseIcon v-else name="XMarkIcon" class="w-5 h-5" />
            </div>
            <div>
              <h5 class="text-sm font-bold text-slate-900">{{ tx.function }}</h5>
              <p class="text-xs font-mono text-slate-400 mt-1">{{ tx.hash }}</p>
            </div>
          </div>
          <p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{{ tx.timestamp }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRpcClient } from '@/composables/useRpcClient';
import type { Address, PublicClient } from 'viem';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseIcon from '../components/BaseIcon.vue';
import { usePrividium } from '../composables/usePrividium';
import { useSsoAccount } from '../composables/useSsoAccount';

import { useCounterContract } from '../composables/useCounterContract';

const router = useRouter();
const {
  isAuthenticated,
  userName,
  userEmail,
  signOut: prividiumSignOut,
  enableWalletToken
} = usePrividium();

// SSO account
const { account: ssoAccount } = useSsoAccount();

// Contract connection data
const counterValue = ref('');
const contractAddressInput = ref(import.meta.env.VITE_COUNTER_CONTRACT_ADDRESS || '');
const currentContractAddress = ref(import.meta.env.VITE_COUNTER_CONTRACT_ADDRESS as Address);

// Form inputs
const incrementAmount = ref('');
const copied = ref(false);

const copyContractAddress = () => {
  if (currentContractAddress.value) {
    void navigator.clipboard.writeText(currentContractAddress.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
};

// Transaction history
const transactions = ref<
  Array<{
    id: string;
    function: string;
    status: 'pending' | 'success' | 'failed';
    hash: string;
    timestamp: string;
  }>
>([]);

// RPC Client
const rpcClient = useRpcClient();

// Contract instance
const isConnected = ref(false);
const isLoading = ref(false);
const errorMessage = ref('');
const MAX_ERROR_MESSAGE_LENGTH = 220;

const truncateError = (message: string, maxLength = MAX_ERROR_MESSAGE_LENGTH) => {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 1).trimEnd()}…`;
};

const formatTransactionError = (
  error: unknown,
  fallback = 'Failed to send transaction'
): string => {
  const rawMessage = error instanceof Error ? error.message : '';
  if (!rawMessage) return fallback;

  const detailsMatch = rawMessage.match(/details:\s*(.+)$/i);
  if (detailsMatch?.[1]) {
    return truncateError(detailsMatch[1]);
  }

  const firstLine = rawMessage.split('\n')[0]?.trim();
  if (firstLine) {
    return truncateError(firstLine);
  }

  return fallback;
};

// Initialize Counter Hook
const counterContract = computed(() => {
  if (!rpcClient.value || !currentContractAddress.value) return null;
  return useCounterContract(
    currentContractAddress.value,
    rpcClient.value as PublicClient,
    enableWalletToken
  );
});

// Initialize contract
const initializeContract = async () => {
  try {
    await loadContractInfo();
    isConnected.value = true;
    errorMessage.value = '';
  } catch (error) {
    console.error('Failed to initialize contract:', error);
    errorMessage.value = 'Failed to connect to contract. Verify the address.';
    isConnected.value = false;
  }
};

// Update contract address
const updateContractAddress = () => {
  if (contractAddressInput.value?.startsWith('0x')) {
    currentContractAddress.value = contractAddressInput.value as Address;
    void initializeContract();
  } else {
    errorMessage.value = 'Invalid contract address';
  }
};

// Load contract information
const loadContractInfo = async () => {
  try {
    if (!counterContract.value) return;
    isLoading.value = true;
    const value = await counterContract.value.getValue();
    counterValue.value = value.toString();
  } catch (error) {
    console.error('Failed to load contract info:', error);
    throw error;
  } finally {
    isLoading.value = false;
  }
};

// Read function handlers
const getCounterValue = async () => {
  try {
    if (!counterContract.value) return;
    isLoading.value = true;
    const value = await counterContract.value.getValue();
    counterValue.value = value.toString();
    addTransaction('Read: x()', 'success', '0x', 'Counter refreshed');
  } catch (error) {
    console.error('Failed to get counter value:', error);
    addTransaction('Read: x()', 'failed', '0x', 'Refresh failed');
    errorMessage.value = 'Failed to get counter value';
  } finally {
    isLoading.value = false;
  }
};

// Write function handlers
const incrementCounter = async () => {
  try {
    if (!counterContract.value) return;

    isLoading.value = true;
    const txId = addTransaction('inc()', 'pending', 'Waiting for confirmation...', '');

    const hash = await counterContract.value.increment();

    updateTransaction(txId, 'success', hash);
    await loadContractInfo();
  } catch (error) {
    console.error('Failed to increment counter:', error);
    errorMessage.value = formatTransactionError(error, 'Failed to increment counter');
    const pendingTx = transactions.value.find(
      (t) => t.status === 'pending' && t.function === 'inc()'
    );
    if (pendingTx) updateTransaction(pendingTx.id, 'failed', 'Error');
  } finally {
    isLoading.value = false;
  }
};

const incrementCounterBy = async () => {
  try {
    if (!counterContract.value) return;
    const amount = BigInt(incrementAmount.value);

    isLoading.value = true;
    const txId = addTransaction(`incBy(${amount})`, 'pending', 'Waiting...', '');

    const hash = await counterContract.value.incrementBy(amount);

    updateTransaction(txId, 'success', hash);
    incrementAmount.value = '';
    await loadContractInfo();
  } catch (error) {
    console.error('Failed to increment counter by amount:', error);
    errorMessage.value = formatTransactionError(error, 'Failed to increment counter');
    const pendingTx = transactions.value.find(
      (t) => t.status === 'pending' && t.function.startsWith('incBy')
    );
    if (pendingTx) updateTransaction(pendingTx.id, 'failed', 'Error');
  } finally {
    isLoading.value = false;
  }
};

// Helper function to add transactions to history
const addTransaction = (
  func: string,
  status: 'pending' | 'success' | 'failed',
  hash: string,
  _description: string
) => {
  const id = Date.now().toString();
  transactions.value.unshift({
    id,
    function: func,
    status,
    hash: hash || 'Processing...',
    timestamp: new Date().toLocaleTimeString()
  });
  return id;
};

const updateTransaction = (id: string, status: 'success' | 'failed', hash: string) => {
  const tx = transactions.value.find((t) => t.id === id);
  if (tx) {
    tx.status = status;
    tx.hash = hash;
  }
};

// Initialize on mount
onMounted(async () => {
  if (isAuthenticated.value) {
    try {
      await initializeContract();
    } catch (error) {
      console.error('Error initializing contract:', error);
    }
  } else {
    void router.push('/login');
  }
});

const logout = () => {
  try {
    prividiumSignOut();
    void router.push('/login');
  } catch (error) {
    console.error('Logout error:', error);
  }
};
</script>
