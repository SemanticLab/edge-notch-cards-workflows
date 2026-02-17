<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  filterOptions: {
    type: Object,
    default: () => ({ occupations: [], organizations: [], locations: [] })
  },
  modelValue: {
    type: Object,
    default: () => ({ q: '', occupation: '', organization: '', location: '', hasBack: null })
  }
})

const emit = defineEmits(['update:modelValue', 'filter-change', 'search'])

const searchText = ref(props.modelValue.q || '')
let debounceTimer = null

watch(() => props.modelValue.q, (val) => {
  searchText.value = val || ''
})

function onSearchInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    emitUpdate({ q: searchText.value })
    emit('search', searchText.value)
  }, 300)
}

function onFilterChange(key, event) {
  const value = event.target.value
  emitUpdate({ [key]: value })
}

function onHasBackChange(event) {
  const checked = event.target.checked
  emitUpdate({ hasBack: checked ? true : null })
}

function emitUpdate(partial) {
  const updated = { ...props.modelValue, ...partial }
  emit('update:modelValue', updated)
  emit('filter-change', updated)
}

function clearAll() {
  searchText.value = ''
  clearTimeout(debounceTimer)
  const cleared = { q: '', occupation: '', organization: '', location: '', hasBack: null }
  emit('update:modelValue', cleared)
  emit('filter-change', cleared)
}

const hasActiveFilters = () => {
  const f = props.modelValue
  return f.q || f.occupation || f.organization || f.location || f.hasBack !== null
}
</script>

<template>
  <div class="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
    <div class="flex flex-wrap gap-3 items-end">
      <!-- Search input -->
      <div class="flex-1 min-w-[200px]">
        <label class="block text-xs font-medium text-gray-500 mb-1">Search</label>
        <input
          v-model="searchText"
          type="text"
          placeholder="Search by name..."
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          @input="onSearchInput"
        />
      </div>

      <!-- Occupation filter -->
      <div class="min-w-[160px]">
        <label class="block text-xs font-medium text-gray-500 mb-1">Occupation</label>
        <select
          :value="modelValue.occupation"
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          @change="onFilterChange('occupation', $event)"
        >
          <option value="">All occupations</option>
          <option
            v-for="opt in filterOptions.occupations"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>
      </div>

      <!-- Organization filter -->
      <div class="min-w-[160px]">
        <label class="block text-xs font-medium text-gray-500 mb-1">Organization</label>
        <select
          :value="modelValue.organization"
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          @change="onFilterChange('organization', $event)"
        >
          <option value="">All organizations</option>
          <option
            v-for="opt in filterOptions.organizations"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>
      </div>

      <!-- Location filter -->
      <div class="min-w-[160px]">
        <label class="block text-xs font-medium text-gray-500 mb-1">Location</label>
        <select
          :value="modelValue.location"
          class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          @change="onFilterChange('location', $event)"
        >
          <option value="">All locations</option>
          <option
            v-for="opt in filterOptions.locations"
            :key="opt"
            :value="opt"
          >
            {{ opt }}
          </option>
        </select>
      </div>

      <!-- Has back checkbox -->
      <div class="flex items-center gap-2 pb-1">
        <input
          type="checkbox"
          :checked="modelValue.hasBack === true"
          class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          @change="onHasBackChange"
        />
        <label class="text-sm text-gray-600 whitespace-nowrap">Has back data</label>
      </div>

      <!-- Clear button -->
      <button
        v-if="hasActiveFilters()"
        class="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300
               rounded-md hover:bg-gray-50 transition-colors whitespace-nowrap"
        @click="clearAll"
      >
        Clear filters
      </button>
    </div>
  </div>
</template>
