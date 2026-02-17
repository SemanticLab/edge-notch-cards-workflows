import { createRouter, createWebHistory } from 'vue-router'
import CardList from '../components/CardList.vue'
import CardDetail from '../components/CardDetail.vue'

const routes = [
  { path: '/', name: 'CardList', component: CardList },
  { path: '/card/:id', name: 'CardDetail', component: CardDetail, props: true }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
