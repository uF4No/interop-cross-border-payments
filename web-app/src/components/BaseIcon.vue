<script setup lang="ts">
import * as OutlineIcons from '@heroicons/vue/24/outline';
import * as SolidIcons from '@heroicons/vue/24/solid';
import { computed } from 'vue';

interface Props {
  name: string;
  outline?: boolean;
  class?: string;
}

const props = withDefaults(defineProps<Props>(), {
  outline: false,
  class: 'w-6 h-6'
});

const iconComponent = computed(() => {
  const icons = props.outline ? OutlineIcons : SolidIcons;
  // @ts-ignore - Dynamic access to icon set
  return icons[props.name] || icons.QuestionMarkCircleIcon;
});
</script>

<template>
  <component :is="iconComponent" :class="props.class" aria-hidden="true" />
</template>
