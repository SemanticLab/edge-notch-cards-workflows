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

  return { getCards, getCard, updateFront, updateBack, toggleComplete, getFilterOptions }
}
