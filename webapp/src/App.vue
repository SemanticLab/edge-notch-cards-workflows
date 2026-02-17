<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const isDetail = computed(() => route.name === 'CardDetail')
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center">
        <router-link
          to="/"
          class="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors"
        >
          Edge-Notch Cards
        </router-link>
        <span v-if="isDetail" class="ml-2 text-gray-400">/</span>
        <span v-if="isDetail" class="ml-2 text-sm text-gray-500">Card Detail</span>
      </div>
    </header>
    <main class="flex-1">
      <router-view />
    </main>
  </div>
</template>
