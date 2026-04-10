import { computed, ref, watchEffect } from 'vue';

export type InteropMode = 'public' | 'private';

const STORAGE_KEY = 'prividium.interopMode';
const env = import.meta.env as Record<string, string | undefined>;

function readStoredMode(): InteropMode {
  if (typeof window === 'undefined') {
    return 'public';
  }

  return window.localStorage.getItem(STORAGE_KEY) === 'private' ? 'private' : 'public';
}

function readPrivateAvailability() {
  return env.VITE_PRIVATE_INTEROP_ENABLED?.trim() === '1';
}

const isPrivateAvailable = ref(readPrivateAvailability());
const selectedMode = ref<InteropMode>(readStoredMode());

watchEffect(() => {
  isPrivateAvailable.value = readPrivateAvailability();
  if (!isPrivateAvailable.value && selectedMode.value !== 'public') {
    selectedMode.value = 'public';
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, 'public');
    }
  }
});

export function useInteropMode() {
  const setMode = (mode: InteropMode) => {
    const nextMode = mode === 'private' && !isPrivateAvailable.value ? 'public' : mode;
    selectedMode.value = nextMode;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, nextMode);
    }
  };

  return {
    mode: computed(() => selectedMode.value),
    isPrivateAvailable: computed(() => isPrivateAvailable.value),
    setMode
  };
}
