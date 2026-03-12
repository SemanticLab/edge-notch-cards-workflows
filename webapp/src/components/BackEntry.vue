<script setup>
import { ref, watch, computed } from 'vue'
import EditableField from './EditableField.vue'
import BoundingBoxCrop from './BoundingBoxCrop.vue'
import WikidataCandidates from './WikidataCandidates.vue'
import WikidataSearch from './WikidataSearch.vue'
import WebResearch from './WebResearch.vue'

const props = defineProps({
  entry: { type: Object, required: true },
  imageFilename: { type: String, default: '' },
  minting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:entry', 'delete', 'mint-artist', 'mint-artist-from-wikidata', 'set-artist-qid'])

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

function handleEntryImport(qid, source) {
  if (source === 'Wikibase') {
    emit('set-artist-qid', qid)
  } else {
    emit('mint-artist-from-wikidata', qid)
  }
}

function handleEntryMint() {
  emit('mint-artist')
}

function handleManualArtistQid() {
  const qid = window.prompt('Enter the Wikibase QID (e.g. Q12345), or "remove" to clear:')
  if (!qid || !qid.trim()) return
  const trimmed = qid.trim()
  if (trimmed.toLowerCase() === 'remove') {
    emit('set-artist-qid', null)
    return
  }
  if (!/^Q\d+$/i.test(trimmed)) {
    window.alert('Invalid QID format. Expected something like Q12345 or "remove".')
    return
  }
  emit('set-artist-qid', trimmed.toUpperCase())
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

      <!-- Wikibase artist QID link (already minted) -->
      <div v-if="localEntry.wikibase_person_qid" class="border-t border-gray-100 pt-3 flex items-center justify-between">
        <a :href="'https://base.semlab.io/wiki/Item:' + localEntry.wikibase_person_qid"
           target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium">
          <span class="text-xs font-mono bg-blue-50 px-1.5 py-0.5 rounded">{{ localEntry.wikibase_person_qid }}</span>
          in Wikibase
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        <button @click="handleManualArtistQid"
                class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          Manually set Semlab Wikibase QID
        </button>
      </div>

      <template v-else>
        <!-- Person Candidates (hidden when already minted) -->
        <div class="border-t border-gray-100 pt-3">
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
                :minting="minting"
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
                :minting="minting"
                @import="handleEntryImport"
              />
            </div>
            <div>
              <p class="text-xs text-gray-400 mb-1">Search Wikidata</p>
              <WikidataSearch
                :minting="minting"
                @import="handleEntryImport"
              />
            </div>
          </div>
        </div>

        <!-- Mint person button when no match exists -->
        <div v-if="!hasPersonMatch" class="border-t border-gray-100 pt-3 flex items-center justify-between">
          <button @click="handleEntryMint"
                  :disabled="minting"
                  class="px-3 py-1.5 text-sm font-medium bg-green-600 text-white
                         rounded-md hover:bg-green-700 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed
                         inline-flex items-center gap-1.5">
            <svg v-if="minting" class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {{ minting ? 'Minting...' : 'Mint in Wikibase from card data' }}
          </button>
          <button @click="handleManualArtistQid"
                  class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Manually set Semlab Wikibase QID
          </button>
        </div>
      </template>

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
