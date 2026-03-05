import { useAuthStore } from '../stores/auth.js'

const BASE = '/api'

async function request(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

async function requestWithBody(method, url, data) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

export function useCardApi() {
  function getCards(params = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, value)
      }
    }
    const qs = query.toString()
    return request(`${BASE}/cards${qs ? '?' + qs : ''}`)
  }

  function getCard(id) {
    return request(`${BASE}/cards/${encodeURIComponent(id)}`)
  }

  function updateFront(id, data) {
    return requestWithBody('PUT', `${BASE}/cards/${encodeURIComponent(id)}/front`, data)
  }

  function updateBack(id, data) {
    return requestWithBody('PUT', `${BASE}/cards/${encodeURIComponent(id)}/back`, data)
  }

  function toggleComplete(id, complete) {
    return requestWithBody('PUT', `${BASE}/cards/${encodeURIComponent(id)}/complete`, { complete })
  }

  function getFilterOptions() {
    return request(`${BASE}/cards/filter-options`)
  }

  async function authenticatedPost(url, data) {
    const auth = useAuthStore()
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': auth.token
      },
      body: JSON.stringify(data)
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API error ${res.status}: ${text}`)
    }
    return res.json()
  }

  function mintPerson(cardId) {
    return authenticatedPost(`${BASE}/wikibase/mint-person`, { cardId })
  }

  function mintPersonFromWikidata(cardId, wikidataQid) {
    return authenticatedPost(`${BASE}/wikibase/mint-person-from-wikidata`, { cardId, wikidataQid })
  }

  function mintOrg(cardId, orgTypeQid) {
    return authenticatedPost(`${BASE}/wikibase/mint-org`, { cardId, orgTypeQid })
  }

  function mintOrgFromWikidata(cardId, wikidataQid, orgTypeQid) {
    return authenticatedPost(`${BASE}/wikibase/mint-org-from-wikidata`, { cardId, wikidataQid, orgTypeQid })
  }

  function mintBackArtist(cardId, entryIndex) {
    return authenticatedPost(`${BASE}/wikibase/mint-back-artist`, { cardId, entryIndex })
  }

  function mintBackArtistFromWikidata(cardId, entryIndex, wikidataQid) {
    return authenticatedPost(`${BASE}/wikibase/mint-back-artist-from-wikidata`, { cardId, entryIndex, wikidataQid })
  }

  function mintCard(cardId) {
    return authenticatedPost(`${BASE}/wikibase/mint-card`, { cardId })
  }

  function buildCollaborators(cardId) {
    return authenticatedPost(`${BASE}/wikibase/build-collaborators`, { cardId })
  }

  return { getCards, getCard, updateFront, updateBack, toggleComplete, getFilterOptions, mintPerson, mintPersonFromWikidata, mintOrg, mintOrgFromWikidata, mintBackArtist, mintBackArtistFromWikidata, mintCard, buildCollaborators }
}
