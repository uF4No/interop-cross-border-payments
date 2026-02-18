<script setup lang="ts">
import { onMounted } from 'vue';
import AppFooter from './components/AppFooter.vue';
import AppNavbar from './components/AppNavbar.vue';
const accentColor = import.meta.env.VITE_ACCENT_COLOR || '#2563eb';

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Prividium™';

onMounted(() => {
  document.documentElement.style.setProperty('--accent', accentColor);
  document.title = `${companyName} | Prividium`;
});
</script>

<template>
  <div class="min-h-screen flex flex-col font-sans">
    <AppNavbar />
    
    <main class="flex-grow container mx-auto px-4 py-12 max-w-7xl">
      <RouterView />
    </main>

    <AppFooter />
  </div>
</template>

<style>
/* Global styles move to assets/main.css but we can keep some here if needed */
:root {
  --accent: #2563eb;
}
</style>
