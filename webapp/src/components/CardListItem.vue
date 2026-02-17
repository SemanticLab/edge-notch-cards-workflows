<script setup>
defineProps({
  card: {
    type: Object,
    required: true
    // Expected shape: { id, name, occupation, organization, location, hasBack, backEntryCount, hasError, complete }
  }
})
</script>

<template>
  <tr
    class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
    @click="$router.push(`/card/${card.id}`)"
  >
    <td class="px-4 py-3 text-sm">
      <div class="flex items-center gap-2">
        <span
          v-if="card.complete"
          class="inline-block w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0"
          title="Complete"
        ></span>
        <span
          v-else-if="card.hasError"
          class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0"
          title="Has errors"
        ></span>
        <span
          v-else
          class="inline-block w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0"
          title="Incomplete"
        ></span>
        <span class="font-mono text-xs text-gray-500">{{ card.id }}</span>
      </div>
    </td>
    <td class="px-4 py-3 text-sm font-medium text-gray-900">
      {{ card.name || '-' }}
    </td>
    <td class="px-4 py-3 text-sm text-gray-600">
      {{ card.occupation || '-' }}
    </td>
    <td class="px-4 py-3 text-sm text-gray-600">
      {{ card.organization || '-' }}
    </td>
    <td class="px-4 py-3 text-sm">
      <span
        v-if="card.hasBack && card.backEntryCount > 0"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
               bg-green-100 text-green-700"
      >
        {{ card.backEntryCount }}
      </span>
      <span v-else class="text-gray-400">-</span>
    </td>
  </tr>
</template>
