<script setup>
import { ref, watch, computed } from 'vue'
import EditableField from './EditableField.vue'
import BoundingBoxCrop from './BoundingBoxCrop.vue'
import WikidataCandidates from './WikidataCandidates.vue'
import WebResearch from './WebResearch.vue'

const props = defineProps({
  entry: { type: Object, required: true },
  imageFilename: { type: String, default: '' }
})

const emit = defineEmits(['update:entry', 'delete'])

const localEntry = ref(JSON.parse(JSON.stringify(props.entry)))
const showCandidates = ref(true)
const showResearch = ref(true)

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

const hasPersonMatch = computed(() => {
  const wd = localEntry.value.wikidata_candidates || []
  const wb = localEntry.value.wikibase_candidates || []
  return [...wd, ...wb].some(c => c.match === true)
})

function handleEntryImport(qid) {
  console.log('Import from Wikidata for back entry:', qid)
}

function handleEntryMint() {
  console.log('Mint in Wikibase for back entry:', localEntry.value.name)
}

function handleEntryChunksSelected(chunks) {
  console.log('Selected chunks for back entry:', chunks)
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

      <!-- Person Candidates -->
      <div v-if="localEntry.wikidata_candidates?.length || localEntry.wikibase_candidates?.length"
           class="border-t border-gray-100 pt-3">
        <button
          class="flex items-center justify-between w-full text-left"
          @click="showCandidates = !showCandidates"
        >
          <span class="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Person Candidates
          </span>
          <svg class="w-3.5 h-3.5 text-gray-400 transition-transform"
               :class="{ 'rotate-180': showCandidates }"
               fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="showCandidates" class="mt-2 space-y-3">
          <div v-if="localEntry.wikidata_candidates?.length">
            <p class="text-xs text-gray-400 mb-1">Wikidata</p>
            <WikidataCandidates
              :candidates="localEntry.wikidata_candidates"
              type="person"
              entity-base-url="https://www.wikidata.org/entity/"
              source-label="Wikidata"
              @import="handleEntryImport"
            />
          </div>
          <div v-if="localEntry.wikibase_candidates?.length">
            <p class="text-xs text-gray-400 mb-1">Wikibase</p>
            <WikidataCandidates
              :candidates="localEntry.wikibase_candidates"
              type="person"
              entity-base-url="https://base.semlab.io/entity/"
              source-label="Wikibase"
              @import="handleEntryImport"
            />
          </div>
        </div>
      </div>

      <!-- Mint person button when no match exists -->
      <div v-if="!hasPersonMatch" class="border-t border-gray-100 pt-3">
        <button @click="handleEntryMint"
                class="px-3 py-1.5 text-sm font-medium bg-green-600 text-white
                       rounded-md hover:bg-green-700 transition-colors">
          Mint in Wikibase from card data
        </button>
      </div>

      <!-- AI Slop Research -->
      <div v-if="localEntry.web_research" class="border-t border-gray-100 pt-3">
        <button
          class="flex items-center justify-between w-full text-left"
          @click="showResearch = !showResearch"
        >
          <span class="text-xs font-medium text-gray-500 uppercase tracking-wide">
            AI Slop Research
          </span>
          <svg class="w-3.5 h-3.5 text-gray-400 transition-transform"
               :class="{ 'rotate-180': showResearch }"
               fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div v-if="showResearch" class="mt-2">
          <WebResearch
            :web-research="localEntry.web_research"
            @update:selected-chunks="handleEntryChunksSelected"
          />
        </div>
      </div>

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
