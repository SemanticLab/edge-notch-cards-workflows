import crypto from 'node:crypto'

// Map<sessionToken, { username, wbEdit, createdAt }>
const sessions = new Map()

const MAX_AGE_MS = 24 * 60 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (now - session.createdAt > MAX_AGE_MS) {
      sessions.delete(token)
    }
  }
}, 60 * 60 * 1000)

export function createSession(username, wbEdit) {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, { username, wbEdit, createdAt: Date.now() })
  return token
}

export function getSession(token) {
  return sessions.get(token) || null
}

export function deleteSession(token) {
  sessions.delete(token)
}
