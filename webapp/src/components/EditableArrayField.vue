<script setup>
import { ref } from 'vue'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  label: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const newItem = ref('')

function addItem() {
  const value = newItem.value.trim()
  if (!value) return
  if (props.modelValue.includes(value)) {
    newItem.value = ''
    return
  }
  emit('update:modelValue', [...props.modelValue, value])
  newItem.value = ''
}

function removeItem(index) {
  const updated = [...props.modelValue]
  updated.splice(index, 1)
  emit('update:modelValue', updated)
}

function onKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addItem()
  }
}
</script>

<template>
  <div class="space-y-2">
    <label v-if="label" class="block text-xs font-medium text-gray-500 uppercase tracking-wide">
      {{ label }}
    </label>

    <!-- Tags/pills display -->
    <div v-if="modelValue.length > 0" class="flex flex-wrap gap-1.5">
      <span
        v-for="(item, index) in modelValue"
        :key="index"
        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm
               bg-blue-50 text-blue-700 border border-blue-200"
      >
        {{ item }}
        <button
          type="button"
          class="ml-0.5 text-blue-400 hover:text-blue-700 focus:outline-none"
          @click="removeItem(index)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </span>
    </div>

    <!-- Add input -->
    <div class="flex gap-2">
      <input
        v-model="newItem"
        type="text"
        placeholder="Type and press Enter to add..."
        class="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm
               focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
               placeholder-gray-400"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-600
               hover:bg-gray-50 transition-colors"
        @click="addItem"
      >
        Add
      </button>
    </div>
  </div>
</template>
