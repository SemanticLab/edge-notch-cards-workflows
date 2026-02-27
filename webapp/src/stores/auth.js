import { defineStore } from 'pinia'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    username: '',
    token: '',
    canEdit: false,
    loading: false,
    error: ''
  }),

  getters: {
    isLoggedIn: (state) => !!state.token
  },

  actions: {
    async login(username, password) {
      this.loading = true
      this.error = ''
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Login failed')
        }
        const data = await res.json()
        this.username = data.username
        this.token = data.token
        this.canEdit = true
      } catch (err) {
        this.error = err.message
        throw err
      } finally {
        this.loading = false
      }
    },

    async logout() {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'x-session-token': this.token }
        })
      } catch {
        // Ignore logout errors
      }
      this.username = ''
      this.token = ''
      this.canEdit = false
      this.error = ''
    }
  }
})
