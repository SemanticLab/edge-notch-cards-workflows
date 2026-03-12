<script setup>
import { ref } from 'vue'

const props = defineProps({
  minting: { type: Boolean, default: false }
})

const emit = defineEmits(['import'])

const searchQuery = ref('')
const results = ref([])
const searching = ref(false)
const selectedQid = ref(null)
const searchError = ref(null)

let debounceTimer = null

function onInput() {
  searchError.value = null
  selectedQid.value = null
  if (debounceTimer) clearTimeout(debounceTimer)
  const q = searchQuery.value.trim()
  if (!q) {
    results.value = []
    return
  }
  debounceTimer = setTimeout(() => doSearch(q), 300)
}

async function doSearch(query) {
  searching.value = true
  searchError.value = null
  try {
    const url = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({
      action: 'wbsearchentities',
      search: query,
      language: 'en',
      type: 'item',
      limit: '10',
      format: 'json',
      origin: '*'
    })
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Search failed: ${res.status}`)
    const data = await res.json()
    results.value = (data.search || []).map(item => ({
      qid: item.id,
      label: item.label || item.id,
      description: item.description || ''
    }))
  } catch (err) {
    searchError.value = err.message
    results.value = []
  } finally {
    searching.value = false
  }
}

function onImport() {
  if (selectedQid.value) {
    emit('import', selectedQid.value, 'Wikidata')
  }
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-2">
      <input
        v-model="searchQuery"
        @input="onInput"
        type="text"
        placeholder="Search Wikidata..."
        class="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md
               focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
      <svg v-if="searching" class="animate-spin h-4 w-4 text-gray-400 flex-shrink-0"
           xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>

    <p v-if="searchError" class="text-xs text-red-500">{{ searchError }}</p>

    <div v-if="results.length" class="space-y-1">
      <div v-for="item in results" :key="item.qid">
        <label class="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
          <input type="radio" :value="item.qid" v-model="selectedQid"
                 class="text-blue-600 flex-shrink-0" />
          <a :href="'https://www.wikidata.org/entity/' + item.qid" target="_blank" rel="noopener noreferrer"
             class="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
             @click.stop>
            {{ item.label }}
          </a>
          <span class="text-xs text-gray-400 font-mono">{{ item.qid }}</span>
          <span v-if="item.description" class="text-xs text-gray-500 truncate max-w-[300px]">
            {{ item.description }}
          </span>
        </label>
      </div>
    </div>

    <p v-else-if="searchQuery.trim() && !searching && !searchError" class="text-xs text-gray-400 italic">
      No results found.
    </p>

    <div v-if="selectedQid" class="mt-2">
      <button @click="onImport"
              :disabled="minting"
              class="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white
                     rounded-md hover:bg-blue-700 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed
                     inline-flex items-center gap-1.5">
        <svg v-if="minting" class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {{ minting ? 'Importing...' : 'Import from Wikidata' }}
      </button>
    </div>
  </div>
</template>
