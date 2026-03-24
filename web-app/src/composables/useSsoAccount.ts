import type { Address } from 'viem';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { loadExistingPasskey, saveAccountAddress } from '../utils/sso/passkeys';
import { usePrividium } from './usePrividium';

const ssoAccount = ref<Address | null>(null);
const ACCOUNT_STORAGE_EVENT = 'sso-account-storage-updated';

export function useSsoAccount() {
  const { userWallets, isAuthenticated } = usePrividium();

  const refresh = () => {
    const linkedWallets = (userWallets.value ?? []).map((wallet) => wallet.toLowerCase());
    const linkedWalletAddress = linkedWallets[0] as Address | undefined;
    const { savedAccount } = loadExistingPasskey();

    if (!savedAccount) {
      // Fallback to profile-linked wallet when local account state is not populated yet.
      ssoAccount.value = linkedWalletAddress ?? null;
      if (linkedWalletAddress) {
        saveAccountAddress(linkedWalletAddress);
      }
      return;
    }

    if (!linkedWallets.length) {
      // Keep the locally selected account visible if profile wallets are temporarily unavailable.
      ssoAccount.value = savedAccount;
      return;
    }

    const isLinked = linkedWallets.includes(savedAccount.toLowerCase());
    ssoAccount.value = isLinked ? savedAccount : linkedWalletAddress ?? savedAccount;
  };

  onMounted(() => {
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener(ACCOUNT_STORAGE_EVENT, refresh);
  });

  onUnmounted(() => {
    window.removeEventListener('storage', refresh);
    window.removeEventListener(ACCOUNT_STORAGE_EVENT, refresh);
  });

  watch([userWallets, isAuthenticated], () => {
    refresh();
  });

  return {
    account: computed(() => ssoAccount.value),
    refresh
  };
}
