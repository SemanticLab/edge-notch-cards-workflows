<script setup>
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCardsStore } from '../stores/cards.js'
import SearchBar from './SearchBar.vue'
import CardListItem from './CardListItem.vue'

const route = useRoute()
const router = useRouter()
const store = useCardsStore()

// Sync filters from URL query params on mount
function loadFiltersFromQuery() {
  const q = route.query
  if (q.q) store.filters.q = q.q
  if (q.occupation) store.filters.occupation = q.occupation
  if (q.organization) store.filters.organization = q.organization
  if (q.location) store.filters.location = q.location
  if (q.hasBack === 'true') store.filters.hasBack = true
}

// Sync filters to URL query params
function syncFiltersToQuery() {
  const query = {}
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

onMounted(() => {
  store.fetchFilterOptions()
  loadFiltersFromQuery()
  store.fetchCards()
})
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
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
