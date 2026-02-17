<script setup>
import { computed } from 'vue'

const props = defineProps({
  imageFilename: { type: String, required: true },
  boundingBox: {
    type: Object,
    required: true
    // Expected shape: { x1, y1, x2, y2 }
  }
})

const cropUrl = computed(() => {
  if (!props.imageFilename || !props.boundingBox) return ''
  const { x1, y1, x2, y2 } = props.boundingBox
  return `/api/images/${encodeURIComponent(props.imageFilename)}/crop?x1=${x1}&y1=${y1}&x2=${x2}&y2=${y2}`
})
</script>

<template>
  <div v-if="cropUrl" class="inline-block border border-gray-300 rounded overflow-hidden bg-gray-100">
    <img
      :src="cropUrl"
      alt="Cropped region"
      class="h-20 w-auto object-contain"
      loading="lazy"
    />
  </div>
</template>
