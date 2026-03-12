<script setup>
import { ref, watch, computed } from 'vue'
import BackEntry from './BackEntry.vue'

const props = defineProps({
  back: { type: Object, default: null },
  imageUrl: { type: String, default: '' },
  imageFilename: { type: String, default: '' },
  engineerQid: { type: String, default: null },
  documentQid: { type: String, default: null },
  frontBlockQid: { type: String, default: null },
  backBlockQid: { type: String, default: null },
  collaboratorsBuilt: { type: Boolean, default: false },
  minting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:back', 'mint-artist', 'mint-artist-from-wikidata', 'set-artist-qid', 'mint-card', 'set-document-qid', 'build-collaborators'])

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

const hasUnmintedArtists = computed(() => {
  const entries = localBack.value?.entries || []
  return entries.some(e => e.name && e.name !== 'null' && !e.wikibase_person_qid)
})

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

function handleManualDocumentQid() {
  const qid = window.prompt('Enter the Wikibase Document QID (e.g. Q12345), or "remove" to clear:')
  if (!qid || !qid.trim()) return
  const trimmed = qid.trim()
  if (trimmed.toLowerCase() === 'remove') {
    emit('set-document-qid', null)
    return
  }
  if (!/^Q\d+$/i.test(trimmed)) {
    window.alert('Invalid QID format. Expected something like Q12345 or "remove".')
    return
  }
  emit('set-document-qid', trimmed.toUpperCase())
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
          :minting="minting"
          @update:entry="updateEntry(index, $event)"
          @delete="deleteEntry(index)"
          @mint-artist="emit('mint-artist', index)"
          @mint-artist-from-wikidata="emit('mint-artist-from-wikidata', index, $event)"
          @set-artist-qid="emit('set-artist-qid', index, $event)"
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

      <!-- Mint Card section -->
      <div class="mt-4 space-y-2">
        <template v-if="documentQid">
          <div class="flex items-center justify-between">
            <a :href="'https://base.semlab.io/wiki/Item:' + documentQid"
               target="_blank" rel="noopener noreferrer"
               class="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium">
              <span class="text-xs font-mono bg-blue-50 px-1.5 py-0.5 rounded">{{ documentQid }}</span>
              Card minted in Wikibase
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <button @click="handleManualDocumentQid"
                    class="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Manually set Semlab Wikibase QID
            </button>
          </div>
          <div v-if="frontBlockQid || backBlockQid" class="ml-6 space-y-1">
            <a v-if="frontBlockQid"
               :href="'https://base.semlab.io/wiki/Item:' + frontBlockQid"
               target="_blank" rel="noopener noreferrer"
               class="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 hover:underline">
              <span class="font-mono bg-blue-50 px-1 py-0.5 rounded">{{ frontBlockQid }}</span>
              Front block
            </a>
            <a v-if="backBlockQid"
               :href="'https://base.semlab.io/wiki/Item:' + backBlockQid"
               target="_blank" rel="noopener noreferrer"
               class="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 hover:underline">
              <span class="font-mono bg-blue-50 px-1 py-0.5 rounded">{{ backBlockQid }}</span>
              Back block
            </a>
          </div>
        </template>
        <template v-else>
          <p v-if="!engineerQid" class="text-sm text-amber-600">
            ⚠️ Cannot mint card until engineer minted
          </p>
          <p v-if="hasUnmintedArtists" class="text-sm text-amber-600">
            ⚠️ Warning: Still some artists un-minted
          </p>
          <button
            type="button"
            :disabled="!engineerQid || minting"
            class="w-full py-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            :class="engineerQid && !minting
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'"
            @click="emit('mint-card')"
          >
            <svg v-if="minting" class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {{ minting ? 'Minting...' : 'Mint Card in Wikibase' }}
          </button>
          <button @click="handleManualDocumentQid"
                  class="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors text-center py-1">
            Manually set Semlab Wikibase QID
          </button>
        </template>
      </div>

      <!-- Build collaborator relationships button -->
      <div v-if="collaboratorsBuilt" class="mt-3 text-center text-sm text-green-600 font-medium">
        Collaborator relationships built
      </div>
      <button
        v-else
        type="button"
        :disabled="!documentQid || minting"
        class="w-full py-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 mt-3"
        :class="documentQid && !minting
          ? 'bg-purple-600 text-white hover:bg-purple-700'
          : 'bg-gray-200 text-gray-400 cursor-not-allowed'"
        @click="emit('build-collaborators')"
      >
        <svg v-if="minting" class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {{ minting ? 'Building...' : 'Build proposed collaborator relationships' }}
      </button>
    </template>
  </div>
</template>
