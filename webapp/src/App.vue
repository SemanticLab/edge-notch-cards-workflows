<script setup>
import { useRoute } from 'vue-router'
import { computed, ref } from 'vue'
import { useAuthStore } from './stores/auth.js'
import LoginModal from './components/LoginModal.vue'

const route = useRoute()
const authStore = useAuthStore()
const isDetail = computed(() => route.name === 'CardDetail')
const showLoginModal = ref(false)
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div class="flex items-center">
          <router-link
            to="/"
            class="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors"
          >
            Edge-Notch Cards
          </router-link>
          <span v-if="isDetail" class="ml-2 text-gray-400">/</span>
          <span v-if="isDetail" class="ml-2 text-sm text-gray-500">Card Detail</span>
        </div>

        <div class="flex items-center gap-3">
          <template v-if="authStore.isLoggedIn">
            <span class="text-sm text-gray-600">{{ authStore.username }}</span>
            <button
              class="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              @click="authStore.logout()"
            >
              Logout
            </button>
          </template>
          <button
            v-else
            class="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            @click="showLoginModal = true"
          >
            Login
          </button>
        </div>
      </div>

      <LoginModal :show="showLoginModal" @close="showLoginModal = false" />
    </header>
    <main class="flex-1">
      <router-view />
    </main>
  </div>
</template>
