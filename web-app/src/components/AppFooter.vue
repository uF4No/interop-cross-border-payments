<script setup lang="ts">
const companyName = import.meta.env.VITE_COMPANY_NAME || 'Prividium™';
const year = new Date().getFullYear();
</script>

<template>
  <footer class="px-8 py-12 mt-auto">
    <div class="max-w-7xl mx-auto flex flex-col items-center gap-8">
      <div class="w-full h-px bg-slate-200/50"></div>
      
      <div class="flex flex-col md:flex-row justify-between items-center w-full gap-6">
        <div class="flex flex-col items-center md:items-start gap-1">
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-widest">{{ companyName }}</p>
          <p class="text-[10px] text-slate-400 uppercase tracking-[0.2em]">&copy; {{ year }} Prividium™ Gateway</p>
        </div>
        
        <div class="flex gap-8 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
          <a href="https://www.zksync.io/prividium" target="_blank" class="hover:text-accent transition-colors flex items-center gap-2">
            <span>ZKsync Prividium™</span>
            <BaseIcon name="ArrowTopRightOnSquareIcon" class="w-3 h-3 opacity-50" />
          </a>
          <a href="https://docs.zksync.io/zk-stack/prividium/overview" target="_blank" class="hover:text-accent transition-colors flex items-center gap-2">
            <span>Documentation</span>
            <BaseIcon name="DocumentTextIcon" class="w-3 h-3 opacity-50" />
          </a>
        </div>
      </div>
    </div>
  </footer>
</template>
