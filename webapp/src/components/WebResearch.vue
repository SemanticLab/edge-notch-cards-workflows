<script setup>
import { ref } from 'vue'

const props = defineProps({
  webResearch: { type: Object, default: null }
})

const emit = defineEmits(['update:selectedChunks'])

const selectedChunks = ref([])

function truncateUrl(url, maxLength = 60) {
  if (!url || url.length <= maxLength) return url
  try {
    const parsed = new URL(url)
    const domain = parsed.hostname
    const pathPart = parsed.pathname + parsed.search
    const available = maxLength - domain.length - 3
    if (available <= 0) return domain + '...'
    return domain + pathPart.substring(0, available) + '...'
  } catch {
    return url.substring(0, maxLength) + '...'
  }
}

function toggleChunk(index) {
  const idx = selectedChunks.value.indexOf(index)
  if (idx === -1) {
    selectedChunks.value.push(index)
  } else {
    selectedChunks.value.splice(idx, 1)
  }
  emit('update:selectedChunks', [...selectedChunks.value])
}
</script>

<template>
  <div v-if="webResearch" class="space-y-3">
    <!-- Possible Identity text blocks -->
    <div v-if="webResearch.results && webResearch.results.length > 0" class="space-y-2">
      <div v-for="(result, idx) in webResearch.results" :key="idx"
           class="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-100">
        {{ result.possibleIdentity }}
      </div>
    </div>

    <!-- Grounding chunks as clickable links with checkboxes -->
    <div v-if="webResearch.groundingMetadata?.groundingChunks?.length > 0" class="space-y-1">
      <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Sources</p>
      <div v-for="(chunk, idx) in webResearch.groundingMetadata.groundingChunks"
           :key="idx"
           class="flex items-center gap-2">
        <input type="checkbox"
               :checked="selectedChunks.includes(idx)"
               @change="toggleChunk(idx)"
               class="rounded text-blue-600 flex-shrink-0" />
        <a :href="chunk.resolvedUri || chunk.uri"
           target="_blank" rel="noopener noreferrer"
           class="text-sm text-blue-600 hover:text-blue-800 hover:underline truncate"
           :title="chunk.resolvedUri || chunk.uri">
          {{ truncateUrl(chunk.resolvedUri || chunk.uri) }}
        </a>
      </div>
    </div>

    <!-- No data state -->
    <p v-if="(!webResearch.results || webResearch.results.length === 0) &&
             (!webResearch.groundingMetadata?.groundingChunks ||
              webResearch.groundingMetadata.groundingChunks.length === 0)"
       class="text-sm text-gray-400 italic">
      No research data available.
    </p>
  </div>
</template>
