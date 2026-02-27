<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'

defineProps({
  show: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

const authStore = useAuthStore()
const username = ref('')
const password = ref('')
const errorMsg = ref('')
const submitting = ref(false)

async function handleLogin() {
  if (!username.value || !password.value) {
    errorMsg.value = 'Please enter both username and password'
    return
  }
  errorMsg.value = ''
  submitting.value = true
  try {
    await authStore.login(username.value, password.value)
    username.value = ''
    password.value = ''
    emit('close')
  } catch (err) {
    errorMsg.value = err.message || 'Login failed'
  } finally {
    submitting.value = false
  }
}

function handleClose() {
  errorMsg.value = ''
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/40" @click="handleClose" />

      <!-- Modal -->
      <div class="relative bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Wikibase Login</h2>

        <div
          v-if="errorMsg"
          class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700"
        >
          {{ errorMsg }}
        </div>

        <form @submit.prevent="handleLogin" class="space-y-4">
          <div class="space-y-1">
            <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide">
              Username
            </label>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              placeholder="Wikibase username"
              class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                     placeholder-gray-400"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-xs font-medium text-gray-500 uppercase tracking-wide">
              Password
            </label>
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="Password"
              class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                     placeholder-gray-400"
            />
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              class="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              @click="handleClose"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-md
                     hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed
                     transition-colors flex items-center gap-2"
            >
              <svg
                v-if="submitting"
                class="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              >
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ submitting ? 'Logging in...' : 'Login' }}
            </button>
          </div>
        </form>

        <p class="mt-4 text-xs text-gray-400 text-center">
          Authenticates against base.semlab.io
        </p>
      </div>
    </div>
  </Teleport>
</template>
