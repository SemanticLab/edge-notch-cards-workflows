<script setup>
import { computed } from 'vue'

const props = defineProps({
  page: { type: Number, required: true },
  pageSize: { type: Number, required: true },
  total: { type: Number, required: true }
})

const emit = defineEmits(['update:page', 'update:pageSize'])

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const start = computed(() => props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1)
const end = computed(() => Math.min(props.page * props.pageSize, props.total))
const hasPrev = computed(() => props.page > 1)
const hasNext = computed(() => props.page < totalPages.value)

function prev() {
  if (hasPrev.value) emit('update:page', props.page - 1)
}

function next() {
  if (hasNext.value) emit('update:page', props.page + 1)
}

function onPageSizeChange(event) {
  emit('update:pageSize', Number(event.target.value))
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-4 py-3">
    <!-- Showing info -->
    <div class="text-sm text-gray-600">
      <template v-if="total > 0">
        Showing {{ start }}-{{ end }} of {{ total }}
      </template>
      <template v-else>
        No results
      </template>
    </div>

    <div class="flex items-center gap-4">
      <!-- Page size selector -->
      <div class="flex items-center gap-2">
        <label class="text-sm text-gray-500">Per page:</label>
        <select
          :value="pageSize"
          class="rounded-md border border-gray-300 px-2 py-1 text-sm bg-white
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          @change="onPageSizeChange"
        >
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
      </div>

      <!-- Navigation buttons -->
      <div class="flex items-center gap-1">
        <button
          :disabled="!hasPrev"
          class="px-3 py-1.5 text-sm rounded-md border transition-colors
                 enabled:hover:bg-gray-50 enabled:text-gray-700 enabled:border-gray-300
                 disabled:text-gray-300 disabled:border-gray-200 disabled:cursor-not-allowed"
          @click="prev"
        >
          Previous
        </button>
        <span class="px-3 py-1.5 text-sm text-gray-600">
          Page {{ page }} of {{ totalPages }}
        </span>
        <button
          :disabled="!hasNext"
          class="px-3 py-1.5 text-sm rounded-md border transition-colors
                 enabled:hover:bg-gray-50 enabled:text-gray-700 enabled:border-gray-300
                 disabled:text-gray-300 disabled:border-gray-200 disabled:cursor-not-allowed"
          @click="next"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
