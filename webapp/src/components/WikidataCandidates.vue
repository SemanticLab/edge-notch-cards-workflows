<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  candidates: { type: Array, default: () => [] },
  type: { type: String, default: 'person' },
  entityBaseUrl: { type: String, default: 'https://www.wikidata.org/entity/' },
  sourceLabel: { type: String, default: 'Wikidata' }
})

const emit = defineEmits(['select', 'import', 'mint'])

const selectedQid = ref(null)
const orgType = ref('institution')

const matchedCandidates = computed(() =>
  props.candidates.filter(c => c.match === true)
)

const unmatchedCandidates = computed(() =>
  props.candidates.filter(c => c.match !== true)
)

const allUnmatched = computed(() => matchedCandidates.value.length === 0)

function onImport() {
  emit('import', selectedQid.value)
}

function onMint() {
  emit('mint', orgType.value)
}
</script>

<template>
  <div class="space-y-2">
    <!-- Org type radio group -->
    <div v-if="type === 'org'" class="flex items-center gap-4 mb-2">
      <label class="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
        <input type="radio" v-model="orgType" value="institution"
               class="text-blue-600" />
        Institution
      </label>
      <label class="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
        <input type="radio" v-model="orgType" value="organization"
               class="text-blue-600" />
        Organization
      </label>
    </div>

    <!-- Empty state -->
    <p v-if="candidates.length === 0" class="text-sm text-gray-400 italic">
      No {{ sourceLabel }} candidates found.
    </p>

    <template v-else>
      <!-- Matched candidates (or all if allUnmatched) -->
      <div class="space-y-1">
        <label
          v-for="candidate in (allUnmatched ? candidates : matchedCandidates)"
          :key="candidate.qid"
          class="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer group"
        >
          <input type="radio" :value="candidate.qid" v-model="selectedQid"
                 class="text-blue-600 flex-shrink-0" />
          <a :href="entityBaseUrl + candidate.qid" target="_blank" rel="noopener noreferrer"
             class="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
             @click.stop>
            {{ candidate.label || candidate.qid }}
          </a>
          <span class="text-xs text-gray-400 font-mono">{{ candidate.qid }}</span>
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
          <!-- Info icon with tooltip -->
          <span v-if="candidate.reasoning" class="relative flex-shrink-0 ml-auto">
            <svg class="w-4 h-4 text-gray-400 group-hover:text-gray-600 cursor-help"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="absolute bottom-full right-0 mb-2 w-72 p-3 bg-gray-900 text-white
                         text-xs leading-relaxed rounded-lg shadow-lg opacity-0 invisible
                         group-hover:opacity-100 group-hover:visible
                         transition-opacity duration-200 z-50 pointer-events-none
                         max-h-48 overflow-y-auto">
              {{ candidate.reasoning }}
            </span>
          </span>
        </label>
      </div>

      <!-- Non-matching candidates in details/summary -->
      <details v-if="!allUnmatched && unmatchedCandidates.length > 0" class="mt-2">
        <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
          {{ unmatchedCandidates.length }} non-matching candidate(s)
        </summary>
        <div class="mt-1 space-y-1">
          <label
            v-for="candidate in unmatchedCandidates"
            :key="candidate.qid"
            class="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer group"
          >
            <input type="radio" :value="candidate.qid" v-model="selectedQid"
                   class="text-blue-600 flex-shrink-0" />
            <a :href="entityBaseUrl + candidate.qid" target="_blank" rel="noopener noreferrer"
               class="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
               @click.stop>
              {{ candidate.label || candidate.qid }}
            </a>
            <span class="text-xs text-gray-400 font-mono">{{ candidate.qid }}</span>
            <span class="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full flex-shrink-0">
              unlikely match
            </span>
            <span class="text-xs text-gray-400 flex-shrink-0">{{ candidate.confidence }}</span>
            <span v-if="candidate.description"
                  class="text-xs text-gray-500 truncate max-w-[200px]">
              {{ candidate.description }}
            </span>
            <!-- Info icon with tooltip -->
            <span v-if="candidate.reasoning" class="relative flex-shrink-0 ml-auto">
              <svg class="w-4 h-4 text-gray-400 group-hover:text-gray-600 cursor-help"
                   fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span class="absolute bottom-full right-0 mb-2 w-72 p-3 bg-gray-900 text-white
                           text-xs leading-relaxed rounded-lg shadow-lg opacity-0 invisible
                           group-hover:opacity-100 group-hover:visible
                           transition-opacity duration-200 z-50 pointer-events-none
                           max-h-48 overflow-y-auto">
                {{ candidate.reasoning }}
              </span>
            </span>
          </label>
        </div>
      </details>

      <!-- Action buttons -->
      <div v-if="selectedQid" class="mt-3">
        <button @click="onImport"
                class="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white
                       rounded-md hover:bg-blue-700 transition-colors">
          {{ sourceLabel === 'Wikibase' ? 'Use this Wikibase Entity' : 'Import from Wikidata' }}
        </button>
      </div>
      <div v-else-if="type === 'org'" class="mt-3">
        <button @click="onMint"
                class="px-3 py-1.5 text-sm font-medium bg-green-600 text-white
                       rounded-md hover:bg-green-700 transition-colors">
          Mint in Wikibase from card data
        </button>
      </div>
    </template>
  </div>
</template>
