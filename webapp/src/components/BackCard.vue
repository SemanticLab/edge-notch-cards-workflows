<script setup>
import { ref, watch } from 'vue'
import BackEntry from './BackEntry.vue'

const props = defineProps({
  back: { type: Object, default: null },
  imageUrl: { type: String, default: '' },
  imageFilename: { type: String, default: '' }
})

const emit = defineEmits(['update:back'])

function cloneBack() {
  if (!props.back) return null
  return JSON.parse(JSON.stringify(props.back))
}

const localBack = ref(cloneBack())

watch(() => props.back, () => {
  localBack.value = cloneBack()
}, { deep: true })

function updateEntry(index, updatedEntry) {
  if (!localBack.value || !localBack.value.entries) return
  localBack.value.entries[index] = updatedEntry
  emit('update:back', JSON.parse(JSON.stringify(localBack.value)))
}

function deleteEntry(index) {
  if (!localBack.value || !localBack.value.entries) return
  localBack.value.entries.splice(index, 1)
  emit('update:back', JSON.parse(JSON.stringify(localBack.value)))
}

function addEntry() {
  if (!localBack.value) {
    localBack.value = { entries: [] }
  }
  if (!localBack.value.entries) {
    localBack.value.entries = []
  }
  localBack.value.entries.push({
    name: '',
    name_other: '',
    contact_method: '',
    date: '',
    other_metadata: '',
    bounding_box: null
  })
  emit('update:back', JSON.parse(JSON.stringify(localBack.value)))
}
</script>

<template>
  <div class="space-y-4">
    <!-- Back card image -->
    <div v-if="imageUrl" class="bg-white rounded-lg border border-gray-200 p-3">
      <img
        :src="imageUrl"
        alt="Back of card"
        class="max-w-full h-auto rounded"
        loading="lazy"
      />
    </div>

    <!-- No back data -->
    <div
      v-if="!back"
      class="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-gray-500"
    >
      <p>No back data available.</p>
      <button
        class="mt-3 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700
               transition-colors"
        @click="addEntry"
      >
        Add first entry
      </button>
    </div>

    <!-- Back entries -->
    <template v-else>
      <!-- Empty entries -->
      <div
        v-if="!back.entries || back.entries.length === 0"
        class="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-gray-500"
      >
        No entries recorded.
      </div>

      <!-- Entry list -->
      <div v-else class="space-y-3">
        <BackEntry
          v-for="(entry, index) in localBack.entries"
          :key="index"
          :entry="entry"
          :image-filename="imageFilename"
          @update:entry="updateEntry(index, $event)"
          @delete="deleteEntry(index)"
        />
      </div>

      <!-- Add entry button -->
      <button
        type="button"
        class="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm
               text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors
               flex items-center justify-center gap-2"
        @click="addEntry"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Add entry
      </button>
    </template>
  </div>
</template>
