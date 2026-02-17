<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCardApi } from '../composables/useCardApi.js'
import FrontCard from './FrontCard.vue'
import BackCard from './BackCard.vue'

const route = useRoute()
const router = useRouter()
const api = useCardApi()

const cardId = computed(() => route.params.id)

// Data state
const card = ref(null)
const loading = ref(true)
const error = ref(null)
const saving = ref(false)
const complete = ref(false)

// Original data for dirty comparison
const originalFront = ref(null)
const originalBack = ref(null)

// Current editable data
const currentFront = ref(null)
const currentBack = ref(null)

// Toast state
const toast = ref({ show: false, message: '', type: 'success' })
let toastTimer = null

function showToast(message, type = 'success') {
  clearTimeout(toastTimer)
  toast.value = { show: true, message, type }
  toastTimer = setTimeout(() => {
    toast.value.show = false
  }, 3000)
}

// Dirty state
const isDirty = computed(() => {
  const frontDirty = JSON.stringify(currentFront.value) !== JSON.stringify(originalFront.value)
  const backDirty = JSON.stringify(currentBack.value) !== JSON.stringify(originalBack.value)
  return frontDirty || backDirty
})

const isFrontDirty = computed(() => {
  return JSON.stringify(currentFront.value) !== JSON.stringify(originalFront.value)
})

const isBackDirty = computed(() => {
  return JSON.stringify(currentBack.value) !== JSON.stringify(originalBack.value)
})

// Computed URLs
const frontImageUrl = computed(() => {
  if (!card.value?.images?.front) return ''
  return `/api/images/${encodeURIComponent(card.value.images.front)}`
})

const backImageUrl = computed(() => {
  if (!card.value?.images?.back) return ''
  return `/api/images/${encodeURIComponent(card.value.images.back)}`
})

const backImageFilename = computed(() => {
  if (!card.value?.images?.back) return ''
  return card.value.images.back
})

const cardName = computed(() => {
  if (!card.value) return 'Loading...'
  if (currentFront.value?.personalIdentification?.fullName) {
    return currentFront.value.personalIdentification.fullName
  }
  return card.value.name || 'Unnamed Card'
})

// Fetch card data
async function fetchCard() {
  loading.value = true
  error.value = null
  try {
    const data = await api.getCard(cardId.value)
    card.value = data
    complete.value = !!data.complete
    originalFront.value = data.front ? JSON.parse(JSON.stringify(data.front)) : null
    originalBack.value = data.back ? JSON.parse(JSON.stringify(data.back)) : null
    currentFront.value = data.front ? JSON.parse(JSON.stringify(data.front)) : null
    currentBack.value = data.back ? JSON.parse(JSON.stringify(data.back)) : null
  } catch (err) {
    error.value = err.message || 'Failed to load card'
    console.error('Failed to fetch card:', err)
  } finally {
    loading.value = false
  }
}

// Save changes
async function save() {
  if (!isDirty.value || saving.value) return
  saving.value = true
  try {
    const promises = []
    if (isFrontDirty.value && currentFront.value) {
      promises.push(api.updateFront(cardId.value, currentFront.value))
    }
    if (isBackDirty.value && currentBack.value) {
      promises.push(api.updateBack(cardId.value, currentBack.value))
    }
    await Promise.all(promises)

    // Update originals after successful save
    originalFront.value = currentFront.value ? JSON.parse(JSON.stringify(currentFront.value)) : null
    originalBack.value = currentBack.value ? JSON.parse(JSON.stringify(currentBack.value)) : null

    showToast('Changes saved successfully', 'success')
  } catch (err) {
    console.error('Failed to save:', err)
    showToast('Failed to save changes: ' + (err.message || 'Unknown error'), 'error')
  } finally {
    saving.value = false
  }
}

// Front/back update handlers
function onFrontUpdate(updated) {
  currentFront.value = updated
}

function onBackUpdate(updated) {
  currentBack.value = updated
}

// Toggle complete
async function toggleComplete() {
  try {
    const result = await api.toggleComplete(cardId.value, !complete.value)
    complete.value = result.complete
    showToast(result.complete ? 'Marked as complete' : 'Marked as incomplete', 'success')
  } catch (err) {
    console.error('Failed to toggle complete:', err)
    showToast('Failed to toggle complete', 'error')
  }
}

// Keyboard shortcut: Ctrl+S / Cmd+S
function handleKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    if (isDirty.value) save()
  }
}

// Warn before leaving with unsaved changes
function beforeUnloadHandler(event) {
  if (isDirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}

onMounted(() => {
  fetchCard()
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('beforeunload', beforeUnloadHandler)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('beforeunload', beforeUnloadHandler)
  clearTimeout(toastTimer)
})

// Re-fetch if card ID changes
watch(cardId, () => {
  fetchCard()
})
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="flex items-center gap-3 text-gray-500">
        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Loading card...</span>
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="py-20 text-center">
      <div class="bg-red-50 border border-red-200 rounded-lg p-6 inline-block">
        <p class="text-red-700 font-medium">Failed to load card</p>
        <p class="text-red-600 text-sm mt-1">{{ error }}</p>
        <div class="mt-4 flex gap-3 justify-center">
          <button
            class="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            @click="fetchCard"
          >
            Retry
          </button>
          <router-link
            to="/"
            class="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Back to list
          </router-link>
        </div>
      </div>
    </div>

    <!-- Card detail -->
    <template v-else-if="card">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <router-link
            to="/"
            class="text-gray-400 hover:text-gray-600 transition-colors"
            title="Back to list"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </router-link>
          <h1 class="text-xl font-semibold text-gray-900">{{ cardName }}</h1>
          <span
            v-if="isDirty"
            class="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium"
          >
            Unsaved changes
          </span>
        </div>
        <div class="flex items-center gap-3">
          <button
            class="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="complete
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            @click="toggleComplete"
          >
            <span
              class="inline-block w-3 h-3 rounded-full border-2"
              :class="complete
                ? 'bg-green-500 border-green-500'
                : 'bg-white border-gray-400'"
            ></span>
            {{ complete ? 'Complete' : 'Incomplete' }}
          </button>
          <span class="text-sm text-gray-400 font-mono">{{ card.id }}</span>
        </div>
      </div>

      <!-- Front card section -->
      <div class="mb-8">
        <h2 class="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Front
        </h2>
        <FrontCard
          :front="currentFront"
          :image-url="frontImageUrl"
          @update:front="onFrontUpdate"
        />
      </div>

      <!-- Back card section -->
      <div class="mb-24">
        <h2 class="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Back
        </h2>
        <BackCard
          :back="currentBack"
          :image-url="backImageUrl"
          :image-filename="backImageFilename"
          @update:back="onBackUpdate"
        />
      </div>
    </template>

    <!-- Sticky save bar -->
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      enter-from-class="translate-y-full"
      enter-to-class="translate-y-0"
      leave-active-class="transition-transform duration-150 ease-in"
      leave-from-class="translate-y-0"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="isDirty && !loading"
        class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50"
      >
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <span class="text-sm text-gray-600">
            You have unsaved changes
          </span>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400 hidden sm:inline">
              Ctrl/Cmd+S to save
            </span>
            <button
              :disabled="saving"
              class="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-md
                     hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed
                     transition-colors flex items-center gap-2"
              @click="save"
            >
              <svg
                v-if="saving"
                class="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
              >
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {{ saving ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast notification -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="toast.show"
        class="fixed bottom-20 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium"
        :class="{
          'bg-green-600 text-white': toast.type === 'success',
          'bg-red-600 text-white': toast.type === 'error'
        }"
      >
        {{ toast.message }}
      </div>
    </Transition>
  </div>
</template>
