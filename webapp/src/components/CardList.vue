<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCardsStore } from '../stores/cards.js'
import SearchBar from './SearchBar.vue'
import CardListItem from './CardListItem.vue'

const route = useRoute()
const router = useRouter()
const store = useCardsStore()

// The two groups of cards shown as tabs at the top of the list.
// Batch 1 is the original name-based set (mostly complete); batch 2 is the
// scan batch added in October 2026 that still needs working through.
const BATCH_TABS = [
  { batch: 1, label: 'Existing cards', hint: 'Original set, mostly complete' },
  { batch: 2, label: 'New batch', hint: 'October 2026 scans, to be worked' }
]

const tabs = computed(() =>
  BATCH_TABS.map(t => {
    const counts = store.batchCounts.find(c => c.batch === t.batch)
    return { ...t, total: counts?.total ?? 0, complete: counts?.complete ?? 0 }
  })
)

function selectBatch(batch) {
  store.setBatch(batch)
}

// Sync filters from URL query params on mount
function loadFiltersFromQuery() {
  const q = route.query
  // A batch in the URL wins over the remembered one (shared links, back button)
  if (q.batch && Number(q.batch) > 0) store.setBatch(q.batch, { fetch: false })
  if (q.q) store.filters.q = q.q
  if (q.occupation) store.filters.occupation = q.occupation
  if (q.organization) store.filters.organization = q.organization
  if (q.location) store.filters.location = q.location
  if (q.hasBack === 'true') store.filters.hasBack = true
}

// Sync filters to URL query params
function syncFiltersToQuery() {
  const query = { batch: String(store.batch) }
  if (store.filters.q) query.q = store.filters.q
  if (store.filters.occupation) query.occupation = store.filters.occupation
  if (store.filters.organization) query.organization = store.filters.organization
  if (store.filters.location) query.location = store.filters.location
  if (store.filters.hasBack !== null) query.hasBack = String(store.filters.hasBack)

  router.replace({ query })
}

function onFilterChange(filters) {
  store.filters.q = filters.q
  store.filters.occupation = filters.occupation
  store.filters.organization = filters.organization
  store.filters.location = filters.location
  store.filters.hasBack = filters.hasBack
  store.fetchCards()
  syncFiltersToQuery()
}

// Watch store changes to sync URL
watch(
  () => store.filters,
  () => syncFiltersToQuery(),
  { deep: true }
)
watch(() => store.batch, () => {
  store.persistBatch()
  syncFiltersToQuery()
})

onMounted(() => {
  store.fetchFilterOptions()
  store.fetchBatchCounts()
  loadFiltersFromQuery()
  store.fetchCards()
})
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
    <!-- Batch tabs: which group of cards is being worked on -->
    <div class="border-b border-gray-200">
      <nav class="-mb-px flex gap-6" aria-label="Card batches">
        <button
          v-for="tab in tabs"
          :key="tab.batch"
          type="button"
          class="flex items-center gap-2 pb-3 pt-1 border-b-2 text-sm font-medium transition-colors whitespace-nowrap"
          :class="store.batch === tab.batch
            ? (tab.batch === 2 ? 'border-amber-500 text-amber-700' : 'border-blue-600 text-blue-700')
            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
          :title="tab.hint"
          @click="selectBatch(tab.batch)"
        >
          <span>{{ tab.label }}</span>
          <span
            class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
            :class="store.batch === tab.batch
              ? (tab.batch === 2 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')
              : 'bg-gray-100 text-gray-600'"
          >
            {{ tab.complete }} / {{ tab.total }} done
          </span>
        </button>
      </nav>
    </div>

    <!-- Search and filters -->
    <SearchBar
      :model-value="store.filters"
      :filter-options="store.filterOptions"
      @update:model-value="onFilterChange"
      @filter-change="onFilterChange"
    />

    <!-- Loading state -->
    <div v-if="store.loading" class="flex items-center justify-center py-12">
      <div class="flex items-center gap-3 text-gray-500">
        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Loading cards...</span>
      </div>
    </div>

    <!-- Cards table -->
    <div v-else class="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table v-if="store.cards.length > 0" class="w-full">
        <thead>
          <tr class="bg-gray-50 border-b border-gray-200">
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Card ID
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Occupation
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Organization
            </th>
            <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Back
            </th>
          </tr>
        </thead>
        <tbody>
          <CardListItem
            v-for="card in store.cards"
            :key="card.id"
            :card="card"
          />
        </tbody>
      </table>

      <!-- Empty state -->
      <div v-else class="py-12 text-center text-gray-500">
        <p class="text-lg">No cards found</p>
        <p class="text-sm mt-1">Try adjusting your search or filters.</p>
      </div>
    </div>

    <!-- Card count -->
    <div v-if="store.total > 0" class="text-sm text-gray-500 text-right">
      {{ store.cards.length }} of {{ store.total }} cards
    </div>
  </div>
</template>
