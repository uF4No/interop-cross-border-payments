import { createRouter, createWebHistory } from 'vue-router';
import { usePrividium } from '../composables/usePrividium';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue')
    },
    {
      path: '/',
      name: 'main',
      component: () => import('../views/MainView.vue'),
      meta: {
        requiresAuth: true
      }
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/login'
    }
  ]
});

router.beforeEach((to, _from, next) => {
  const { isAuthenticated } = usePrividium();

  if (to.meta.requiresAuth && !isAuthenticated.value) {
    return next({
      path: '/login',
      query: { redirect: to.fullPath }
    });
  }

  if (to.path === '/login' && isAuthenticated.value) {
    return next('/');
  }

  return next();
});

export default router;
