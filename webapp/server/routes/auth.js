import { Router } from 'express'
import WBEdit from 'wikibase-edit'
import { createSession, getSession, deleteSession } from '../lib/sessionStore.js'

const router = Router()

const WIKIBASE_INSTANCE = 'https://base.semlab.io'

// POST /api/auth/login
// Body: { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' })
  }

  try {
    const wbEdit = WBEdit({
      instance: WIKIBASE_INSTANCE,
      credentials: { username, password }
    })

    // Validate credentials by fetching auth data (performs login handshake)
    const getAuthData = wbEdit.getAuthData()
    await getAuthData()

    const token = createSession(username, wbEdit)
    res.json({ ok: true, username, token })
  } catch (err) {
    console.error('Login failed for user:', username, err.message)
    res.status(401).json({ error: 'Invalid username or password' })
  }
})

// POST /api/auth/logout
// Header: x-session-token
router.post('/logout', (req, res) => {
  const token = req.headers['x-session-token']
  if (token) {
    deleteSession(token)
  }
  res.json({ ok: true })
})

export default router
