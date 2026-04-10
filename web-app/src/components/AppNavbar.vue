<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useInteropMode } from '../composables/useInteropMode';
import { usePrividium } from '../composables/usePrividium';
import { useSsoAccount } from '../composables/useSsoAccount';
import BaseIcon from './BaseIcon.vue';

const router = useRouter();
const route = useRoute();
const { account: ssoAccount } = useSsoAccount();
const { signOut, branding } = usePrividium();
const { mode: interopMode, isPrivateAvailable, setMode } = useInteropMode();

const dropdownOpen = ref(false);
const copied = ref(false);
const sessionDropdownRef = ref<HTMLElement | null>(null);
let copiedResetTimer: ReturnType<typeof setTimeout> | null = null;
const canShowSessionControls = computed(() => route.path !== '/login');
const canShowInteropToggle = computed(() => canShowSessionControls.value && isPrivateAvailable.value);

const copyAddress = () => {
  if (ssoAccount.value) {
    void navigator.clipboard.writeText(ssoAccount.value);
    copied.value = true;
    if (copiedResetTimer) {
      clearTimeout(copiedResetTimer);
    }
    copiedResetTimer = setTimeout(() => {
      copied.value = false;
      dropdownOpen.value = false;
      copiedResetTimer = null;
    }, 2000);
  }
};

const logout = () => {
  try {
    dropdownOpen.value = false;
    copied.value = false;
    if (copiedResetTimer) {
      clearTimeout(copiedResetTimer);
      copiedResetTimer = null;
    }
    void Promise.resolve(signOut()).then(() => {
      void router.push('/login');
    });
  } catch (error) {
    console.error('Logout error:', error);
  }
};

const closeDropdown = (e: MouseEvent) => {
  const target = e.target;
  if (!(target instanceof Node) || !sessionDropdownRef.value?.contains(target)) {
    dropdownOpen.value = false;
  }
};

onMounted(() => window.addEventListener('click', closeDropdown));
onUnmounted(() => window.removeEventListener('click', closeDropdown));
</script>

<template>
  <nav class="floating-navbar">
    <div class="floating-navbar-inner">
      <div class="flex items-center gap-4 min-w-[200px]">
        <div class="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white shadow-lg">
          <BaseIcon :name="branding.companyIcon" class="w-5 h-5" />
        </div>
        <div class="flex flex-col gap-2">
          <span class="text-2xl font-bold text-slate-900 tracking-tight">{{ branding.companyName }}</span>
          <div
            v-if="canShowInteropToggle"
            class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1 lg:hidden"
          >
            <button
              class="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] transition-colors"
              :class="
                interopMode === 'public'
                  ? 'bg-white text-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              "
              @click="setMode('public')"
            >
              Public
            </button>
            <button
              class="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] transition-colors"
              :class="
                interopMode === 'private'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              "
              @click="setMode('private')"
            >
              Private
            </button>
          </div>
        </div>
      </div>
      
      <!-- Group 2: Network Info (Centered) -->
      <div class="hidden lg:flex items-center gap-3 px-8 border-x border-slate-100 h-8">
        <BaseIcon name="GlobeAltIcon" class="w-5 h-5 text-slate-400" />
        <span class="text-sm font-semibold text-slate-600 tracking-tight whitespace-nowrap">{{ branding.companyName }} Prividium™</span>
        <div
          v-if="canShowInteropToggle"
          class="ml-3 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1"
        >
          <button
            class="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] transition-colors"
            :class="
              interopMode === 'public'
                ? 'bg-white text-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            "
            @click="setMode('public')"
          >
            Public
          </button>
          <button
            class="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] transition-colors"
            :class="
              interopMode === 'private'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            "
            @click="setMode('private')"
          >
            Private
          </button>
        </div>
      </div>

      <div class="flex items-center gap-6 min-w-[200px] justify-end">
        <div v-if="canShowSessionControls" ref="sessionDropdownRef" class="relative">
          <button
            @click="dropdownOpen = !dropdownOpen"
            class="bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 px-6 py-2.5 rounded-full transition-all flex items-center gap-3 shadow-sm text-sm font-medium"
          >
            <BaseIcon :name="ssoAccount ? 'WalletIcon' : 'ArrowRightOnRectangleIcon'" class="w-4 h-4 text-slate-500" />
            <span :class="{ 'font-mono': ssoAccount }">
              {{ ssoAccount ? `${ssoAccount.slice(0, 6)}...${ssoAccount.slice(-4)}` : 'Session' }}
            </span>
            <BaseIcon name="ChevronDownIcon" :class="{ 'rotate-180': dropdownOpen }" class="w-3 h-3 text-slate-400 transition-transform" />
          </button>
          
          <div v-if="dropdownOpen" class="absolute right-0 mt-2 w-48 bg-white border border-slate-100 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <button
              v-if="ssoAccount"
              @click="copyAddress"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-xl transition-colors text-left"
            >
              <BaseIcon :name="copied ? 'CheckIcon' : 'DocumentDuplicateIcon'" :class="copied ? 'text-green-500' : 'text-slate-400'" class="w-4 h-4" />
              <span>{{ copied ? 'Copied!' : 'Copy address' }}</span>
            </button>
            <button
              @click="logout"
              class="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors text-left"
            >
              <BaseIcon name="ArrowRightOnRectangleIcon" class="w-4 h-4 text-red-400" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </nav>
</template>
