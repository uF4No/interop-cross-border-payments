import './assets/main.css';

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { WagmiPlugin } from '@wagmi/vue';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { config } from './wagmi';

const queryClient = new QueryClient();

const app = createApp(App);

app.use(router);
app.use(WagmiPlugin, { config });
app.use(VueQueryPlugin, { queryClient });

app.mount('#app');
