import { defineStore } from 'pinia'
import { useCardApi } from '../composables/useCardApi.js'

const api = useCardApi()

export const useCardsStore = defineStore('cards', {
  state: () => ({
    cards: [],
    total: 0,
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
          pageSize: 10000
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
