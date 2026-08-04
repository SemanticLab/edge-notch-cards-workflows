<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  candidates: { type: Array, default: () => [] },
  type: { type: String, default: 'person' },
  entityBaseUrl: { type: String, default: 'https://www.wikidata.org/entity/' },
  sourceLabel: { type: String, default: 'Wikidata' },
  disableImport: { type: Boolean, default: false },
  disableImportMessage: { type: String, default: '' },
  minting: { type: Boolean, default: false },
  // Map of qid -> { status: 'ok' | 'merged' | 'missing', redirectsTo? }
  // (only supplied for Wikibase-sourced candidates)
  qidStatuses: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['select', 'import'])

const selectedQid = ref(null)
const hoveredQid = ref(null)

const matchedCandidates = computed(() =>
  props.candidates.filter(c => c.match === true)
)

const unmatchedCandidates = computed(() =>
  props.candidates.filter(c => c.match !== true)
)

const allUnmatched = computed(() => matchedCandidates.value.length === 0)

const hoveredReasoning = computed(() => {
  if (!hoveredQid.value) return null
  const c = props.candidates.find(c => c.qid === hoveredQid.value)
  return c?.reasoning || null
})

function statusFor(qid) {
  return props.qidStatuses?.[qid] || null
}

function isUnavailable(qid) {
  const s = statusFor(qid)
  return !!s && (s.status === 'merged' || s.status === 'missing')
}

// Deselect a candidate if the status check reveals it was merged or deleted
watch(() => props.qidStatuses, () => {
  if (selectedQid.value && isUnavailable(selectedQid.value)) {
    selectedQid.value = null
  }
})

function onImport() {
  if (isUnavailable(selectedQid.value)) return
  emit('import', selectedQid.value, props.sourceLabel)
}
</script>

<template>
  <div class="space-y-2">
    <!-- Empty state -->
    <p v-if="candidates.length === 0" class="text-sm text-gray-400 italic">
      No {{ sourceLabel }} candidates found.
    </p>

    <template v-else>
      <!-- Matched candidates (or all if allUnmatched) -->
      <div class="space-y-1">
        <div v-for="candidate in (allUnmatched ? candidates : matchedCandidates)"
             :key="candidate.qid">
          <label
            class="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
            @mouseenter="hoveredQid = candidate.qid"
          >
            <input type="radio" :value="candidate.qid" v-model="selectedQid"
                   :disabled="isUnavailable(candidate.qid)"
                   class="text-blue-600 flex-shrink-0 disabled:opacity-40" />
            <a :href="entityBaseUrl + candidate.qid" target="_blank" rel="noopener noreferrer"
               class="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
               @click.stop>
              {{ candidate.label || candidate.qid }}
            </a>
            <span class="text-xs text-gray-400 font-mono">{{ candidate.qid }}</span>
            <span v-if="statusFor(candidate.qid)?.status === 'merged'"
                  class="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full flex-shrink-0"
                  :title="'This item was merged into ' + statusFor(candidate.qid).redirectsTo">
              merged → {{ statusFor(candidate.qid).redirectsTo }}
            </span>
            <span v-else-if="statusFor(candidate.qid)?.status === 'missing'"
                  class="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full flex-shrink-0"
                  title="This item no longer exists in the Wikibase">
              deleted
            </span>
            <span v-if="candidate.match"
                  class="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full flex-shrink-0">
              match
            </span>
            <span v-else
                  class="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full flex-shrink-0">
              unlikely match
            </span>
            <span class="text-xs text-gray-400 flex-shrink-0">{{ candidate.confidence }}</span>
            <span v-if="candidate.description"
                  class="text-xs text-gray-500 truncate max-w-[200px]">
              {{ candidate.description }}
            </span>
            <svg v-if="candidate.reasoning" class="w-4 h-4 text-gray-400 flex-shrink-0 ml-auto"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </label>
          <!-- Reasoning shown below row on hover -->
          <div v-if="hoveredQid === candidate.qid && candidate.reasoning"
               class="mx-2 mb-1 bg-gray-900 text-white text-xs leading-relaxed rounded-lg p-3 shadow-lg">
            {{ candidate.reasoning }}
          </div>
        </div>
      </div>

      <!-- Non-matching candidates in details/summary -->
      <details v-if="!allUnmatched && unmatchedCandidates.length > 0" class="mt-2">
        <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
          {{ unmatchedCandidates.length }} non-matching candidate(s)
        </summary>
        <div class="mt-1 space-y-1">
          <div v-for="candidate in unmatchedCandidates"
               :key="candidate.qid">
            <label
              class="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
              @mouseenter="hoveredQid = candidate.qid"
            >
              <input type="radio" :value="candidate.qid" v-model="selectedQid"
                     :disabled="isUnavailable(candidate.qid)"
                     class="text-blue-600 flex-shrink-0 disabled:opacity-40" />
              <a :href="entityBaseUrl + candidate.qid" target="_blank" rel="noopener noreferrer"
                 class="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
                 @click.stop>
                {{ candidate.label || candidate.qid }}
              </a>
              <span class="text-xs text-gray-400 font-mono">{{ candidate.qid }}</span>
              <span v-if="statusFor(candidate.qid)?.status === 'merged'"
                    class="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full flex-shrink-0"
                    :title="'This item was merged into ' + statusFor(candidate.qid).redirectsTo">
                merged → {{ statusFor(candidate.qid).redirectsTo }}
              </span>
              <span v-else-if="statusFor(candidate.qid)?.status === 'missing'"
                    class="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full flex-shrink-0"
                    title="This item no longer exists in the Wikibase">
                deleted
              </span>
              <span class="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full flex-shrink-0">
                unlikely match
              </span>
              <span class="text-xs text-gray-400 flex-shrink-0">{{ candidate.confidence }}</span>
              <span v-if="candidate.description"
                    class="text-xs text-gray-500 truncate max-w-[200px]">
                {{ candidate.description }}
              </span>
              <svg v-if="candidate.reasoning" class="w-4 h-4 text-gray-400 flex-shrink-0 ml-auto"
                   fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </label>
            <!-- Reasoning shown below row on hover -->
            <div v-if="hoveredQid === candidate.qid && candidate.reasoning"
                 class="mx-2 mb-1 bg-gray-900 text-white text-xs leading-relaxed rounded-lg p-3 shadow-lg">
              {{ candidate.reasoning }}
            </div>
          </div>
        </div>
      </details>

      <!-- Action buttons -->
      <div v-if="selectedQid" class="mt-3">
        <button v-if="!disableImport" @click="onImport"
                :disabled="minting"
                class="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white
                       rounded-md hover:bg-blue-700 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       inline-flex items-center gap-1.5">
          <svg v-if="minting" class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {{ minting ? 'Importing...' : (sourceLabel === 'Wikibase' ? 'Use this Wikibase Entity' : 'Import from Wikidata') }}
        </button>
        <p v-else class="text-xs text-gray-400 italic">
          {{ disableImportMessage }}
        </p>
      </div>
    </template>
  </div>
</template>
