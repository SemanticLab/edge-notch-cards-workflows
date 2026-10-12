import { defineStore } from 'pinia'
import { useCardApi } from '../composables/useCardApi.js'

const api = useCardApi()

// The selected batch tab is remembered per browser so people land back on
// the group of cards they were working on. localStorage can be unavailable
// (private windows, blocked storage), so every access is guarded.
const BATCH_STORAGE_KEY = 'edge-notch-cards.batch'

function loadStoredBatch() {
  try {
    const b = Number(localStorage.getItem(BATCH_STORAGE_KEY))
    return Number.isFinite(b) && b > 0 ? b : 1
  } catch {
    return 1
  }
}

function storeBatch(batch) {
  try {
    localStorage.setItem(BATCH_STORAGE_KEY, String(batch))
  } catch {
    // storage unavailable; the tab just won't be remembered
  }
}

export const useCardsStore = defineStore('cards', {
  state: () => ({
    cards: [],
    total: 0,
    // Which batch tab is active: 1 = existing cards, 2 = new scan batch.
    // Restored from localStorage; a ?batch= URL param overrides it.
    batch: loadStoredBatch(),
    batchCounts: [],
    filters: {
      q: '',
      occupation: '',
      organization: '',
      location: '',
      hasBack: null
    },
    filterOptions: {
      occupations: [],
      organizations: [],
      locations: []
    },
    loading: false
  }),

  actions: {
    async fetchCards() {
      this.loading = true
      try {
        const params = {
          pageSize: 10000,
          batch: this.batch
        }
        if (this.filters.q) params.q = this.filters.q
        if (this.filters.occupation) params.occupation = this.filters.occupation
        if (this.filters.organization) params.organization = this.filters.organization
        if (this.filters.location) params.location = this.filters.location
        if (this.filters.hasBack !== null) params.hasBack = this.filters.hasBack

        const data = await api.getCards(params)
        this.cards = data.items
        this.total = data.total
      } catch (err) {
        console.error('Failed to fetch cards:', err)
      } finally {
        this.loading = false
      }
    },

    async fetchBatchCounts() {
      try {
        const data = await api.getBatchCounts()
        this.batchCounts = data.batches || []
      } catch (err) {
        console.error('Failed to fetch batch counts:', err)
      }
    },

    setBatch(batch, { fetch = true } = {}) {
      const b = Number(batch)
      if (!Number.isFinite(b) || b <= 0) return
      storeBatch(b)
      if (b === this.batch) return
      this.batch = b
      if (fetch) this.fetchCards()
    },

    persistBatch() {
      storeBatch(this.batch)
    },

    async fetchFilterOptions() {
      try {
        const data = await api.getFilterOptions()
        this.filterOptions = data
      } catch (err) {
        console.error('Failed to fetch filter options:', err)
      }
    },

    setFilter(key, value) {
      this.filters[key] = value
      this.fetchCards()
    },

    resetFilters() {
      this.filters = {
        q: '',
        occupation: '',
        organization: '',
        location: '',
        hasBack: null
      }
      this.fetchCards()
    }
  }
})
