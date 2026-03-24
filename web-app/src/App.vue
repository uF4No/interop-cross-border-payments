<script setup lang="ts">
import { watchEffect } from 'vue';
import AppFooter from './components/AppFooter.vue';
import AppNavbar from './components/AppNavbar.vue';
import { usePrividium } from './composables/usePrividium';

const { branding } = usePrividium();

watchEffect(() => {
  document.documentElement.style.setProperty('--accent', branding.value.accentColor);
  document.title = `${branding.value.companyName} | Prividium`;
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
