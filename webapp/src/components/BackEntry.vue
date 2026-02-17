<script setup>
import { ref, watch } from 'vue'
import EditableField from './EditableField.vue'
import BoundingBoxCrop from './BoundingBoxCrop.vue'

const props = defineProps({
  entry: { type: Object, required: true },
  imageFilename: { type: String, default: '' }
})

const emit = defineEmits(['update:entry', 'delete'])

const localEntry = ref(JSON.parse(JSON.stringify(props.entry)))

watch(() => props.entry, (val) => {
  localEntry.value = JSON.parse(JSON.stringify(val))
}, { deep: true })

function updateField(key, value) {
  localEntry.value[key] = value
  emit('update:entry', JSON.parse(JSON.stringify(localEntry.value)))
}

function displayValue(val) {
  if (val === null || val === undefined) return ''
  return String(val)
}
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white overflow-hidden">
    <!-- Bounding box crop on top -->
    <div v-if="imageFilename && entry.bounding_box" class="border-b border-gray-100 bg-gray-50 p-3">
      <BoundingBoxCrop
        :image-filename="imageFilename"
        :bounding-box="entry.bounding_box"
      />
    </div>

    <!-- Fields below -->
    <div class="p-4 space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <EditableField
          label="Name"
          :model-value="displayValue(localEntry.name)"
          placeholder="Name"
          @update:model-value="updateField('name', $event)"
        />
        <EditableField
          label="Other Name"
          :model-value="displayValue(localEntry.name_other)"
          placeholder="Other name"
          @update:model-value="updateField('name_other', $event)"
        />
        <EditableField
          label="Contact Method"
          :model-value="displayValue(localEntry.contact_method)"
          placeholder="Contact method"
          @update:model-value="updateField('contact_method', $event)"
        />
        <EditableField
          label="Date"
          :model-value="displayValue(localEntry.date)"
          placeholder="YYYY-MM-DD"
          @update:model-value="updateField('date', $event)"
        />
      </div>
      <EditableField
        label="Other Metadata"
        type="textarea"
        :model-value="displayValue(localEntry.other_metadata)"
        placeholder="Other metadata"
        @update:model-value="updateField('other_metadata', $event)"
      />

      <!-- Delete button -->
      <div class="flex justify-end">
        <button
          type="button"
          class="px-3 py-1.5 text-sm text-red-600 hover:text-red-800 border border-red-200
                 hover:bg-red-50 rounded-md transition-colors"
          @click="emit('delete')"
        >
          Delete entry
        </button>
      </div>
    </div>
  </div>
</template>
