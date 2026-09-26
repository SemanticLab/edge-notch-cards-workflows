import { Router } from 'express'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSession } from '../lib/sessionStore.js'
import * as cardStore from '../lib/cardStore.js'

// S3 client for uploading files
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  } : {})
})
const S3_BUCKET = process.env.AWS_BUCKET || 'semlab'

const WIKIBASE_INSTANCE = 'https://base.semlab.io'
// base.semlab.io sits behind a Cloudflare rule that requires this user agent
const WIKIBASE_USER_AGENT = 'semlab-data-process'

async function uploadToS3(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
  return `https://${S3_BUCKET}.s3.amazonaws.com/${key}`
}

let imageProvider = null

export function setImageProvider(provider) {
  imageProvider = provider
}

const router = Router()

// Fetch label and description from Wikidata via SPARQL
async function getWikidataLabelDescription(qid) {
  const query = `SELECT ?label ?description WHERE {
  OPTIONAL { wd:${qid} rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { wd:${qid} schema:description ?description . FILTER(LANG(?description) = "en") }
} LIMIT 1`

  const url = 'https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' })
  const res = await fetch(url, {
    headers: { 'User-Agent': 'edge-notch-cards-workflows/1.0' }
  })
  if (!res.ok) throw new Error(`Wikidata SPARQL error: ${res.status}`)
  const data = await res.json()
  const binding = data.results?.bindings?.[0]
  return {
    label: binding?.label?.value || null,
    description: binding?.description?.value || null
  }
}

// Auth middleware — requires valid session with wbEdit instance
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token']
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  const session = getSession(token)
  if (!session) return res.status(401).json({ error: 'Session expired' })
  req.wbSession = session
  next()
}

// POST /api/wikibase/check-qids
// Body: { qids: ["Q123", ...] }
// Public (read-only): checks each QID on the Wikibase and reports whether it
// still exists, has been merged (redirected) into another item, or is missing.
router.post('/check-qids', async (req, res) => {
  const { qids } = req.body
  if (!Array.isArray(qids) || qids.length === 0) {
    return res.status(400).json({ error: 'qids array is required' })
  }
  const unique = [...new Set(qids.filter(q => typeof q === 'string' && /^Q\d+$/.test(q)))]
  if (unique.length === 0) {
    return res.status(400).json({ error: 'No valid QIDs provided' })
  }

  try {
    const statuses = {}
    // wbgetentities accepts up to 50 ids per request
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50)
      const url = `${WIKIBASE_INSTANCE}/w/api.php?` + new URLSearchParams({
        action: 'wbgetentities',
        ids: batch.join('|'),
        props: 'info',
        format: 'json'
      })
      const resp = await fetch(url, {
        headers: { 'User-Agent': WIKIBASE_USER_AGENT }
      })
      if (!resp.ok) throw new Error(`Wikibase API error: ${resp.status}`)
      const data = await resp.json()
      if (data.error) throw new Error(`Wikibase API error: ${data.error.info || data.error.code}`)
      for (const qid of batch) {
        const entity = data.entities?.[qid]
        if (!entity || entity.missing !== undefined) {
          statuses[qid] = { status: 'missing' }
        } else if (entity.redirects) {
          statuses[qid] = { status: 'merged', redirectsTo: entity.redirects.to }
        } else {
          statuses[qid] = { status: 'ok' }
        }
      }
    }
    res.json({ statuses })
  } catch (err) {
    console.error('Failed to check QIDs:', err.message)
    res.status(502).json({ error: err.message })
  }
})

router.use(requireAuth)

// POST /api/wikibase/mint-person
// Body: { cardId }
// Creates a person entity in Wikibase from front card data
router.post('/mint-person', async (req, res) => {
  const { cardId } = req.body
  if (!cardId) return res.status(400).json({ error: 'cardId is required' })

  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const front = card.front
    if (!front) return res.status(400).json({ error: 'Card has no front data' })

    const fullName = front?.personalIdentification?.fullName
    if (!fullName) return res.status(400).json({ error: 'No fullName on card' })

    // Build claims
    const claims = {
      P1: 'Q1',           // instance of: person
      P11: 'Q28603',      // occupation: engineer
      P65: {              // associated with: E.A.T.
        value: 'Q24347',
        qualifiers: { P117: 'Q19081' }  // role: Technical Services Program
      }
    }

    // Add address if available (monolingual text)
    const address = front?.contactInformation?.residentialAddress
    if (address && address !== 'null' && address.trim()) {
      claims.P152 = { text: address.trim(), language: 'en' }
    }

    const result = await wbEdit.entity.create({
      type: 'item',
      labels: { en: fullName },
      descriptions: { en: "Engineer associated with E.A.T.'s Technical Services Program" },
      claims
    })

    const newQid = result.entity.id

    // Save QID back to the front JSON
    const updatedFront = { ...front, wikibase_person_qid: newQid }
    await cardStore.updateFront(cardId, updatedFront)

    console.log(`Minted person ${newQid} for card ${cardId} (${fullName})`)
    res.json({ ok: true, qid: newQid })
  } catch (err) {
    console.error(`Failed to mint person for card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/wikibase/mint-person-from-wikidata
// Body: { cardId, wikidataQid }
// Creates a person entity in Wikibase using label/description from Wikidata
router.post('/mint-person-from-wikidata', async (req, res) => {
  const { cardId, wikidataQid } = req.body
  if (!cardId) return res.status(400).json({ error: 'cardId is required' })
  if (!wikidataQid) return res.status(400).json({ error: 'wikidataQid is required' })

  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const front = card.front
    if (!front) return res.status(400).json({ error: 'Card has no front data' })

    // Fetch label and description from Wikidata
    const wd = await getWikidataLabelDescription(wikidataQid)
    const label = wd.label || front?.personalIdentification?.fullName
    if (!label) return res.status(400).json({ error: 'No label found on Wikidata or card' })
    const description = wd.description || "Engineer associated with E.A.T.'s Technical Services Program"

    // Build claims — same as mint-person plus P8 (Wikidata QID)
    const claims = {
      P1: 'Q1',           // instance of: person
      P11: 'Q28603',      // occupation: engineer
      P65: {              // associated with: E.A.T.
        value: 'Q24347',
        qualifiers: { P117: 'Q19081' }  // role: Technical Services Program
      },
      P8: wikidataQid     // Wikidata QID (external identifier)
    }

    // Add address if available (monolingual text)
    const address = front?.contactInformation?.residentialAddress
    if (address && address !== 'null' && address.trim()) {
      claims.P152 = { text: address.trim(), language: 'en' }
    }

    const result = await wbEdit.entity.create({
      type: 'item',
      labels: { en: label },
      descriptions: { en: description },
      claims
    })

    const newQid = result.entity.id

    // Save QID back to the front JSON
    const updatedFront = { ...front, wikibase_person_qid: newQid }
    await cardStore.updateFront(cardId, updatedFront)

    console.log(`Minted person ${newQid} from Wikidata ${wikidataQid} for card ${cardId} (${label})`)
    res.json({ ok: true, qid: newQid })
  } catch (err) {
    console.error(`Failed to mint person from Wikidata for card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/wikibase/mint-org
// Body: { cardId, orgTypeQid }
// Creates an org entity in Wikibase, then adds P110 (employer) claim to the person entity
router.post('/mint-org', async (req, res) => {
  const { cardId, orgTypeQid } = req.body
  if (!cardId) return res.status(400).json({ error: 'cardId is required' })
  if (!orgTypeQid) return res.status(400).json({ error: 'orgTypeQid is required' })

  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const front = card.front
    if (!front) return res.status(400).json({ error: 'Card has no front data' })

    const personQid = front.wikibase_person_qid
    if (!personQid) return res.status(400).json({ error: 'Person must be minted first (no wikibase_person_qid)' })

    const orgName = front?.professionalAffiliation?.employerOrganization
    if (!orgName || orgName === 'null') return res.status(400).json({ error: 'No employer/organization name on card' })

    // Create the org entity
    const claims = {
      P1: orgTypeQid,      // instance of: institution (Q1804) or business (Q19085)
      P11: 'Q28603',       // part of project: E.A.T. Technical Services Program Edge-Notched Cards
    }

    const result = await wbEdit.entity.create({
      type: 'item',
      labels: { en: orgName },
      claims
    })

    const orgQid = result.entity.id

    // Add P110 (employer) claim to the person entity pointing to this org
    await wbEdit.claim.create({
      id: personQid,
      property: 'P110',
      value: orgQid
    })

    // Save org QID back to the front JSON
    const updatedFront = { ...front, wikibase_org_qid: orgQid }
    await cardStore.updateFront(cardId, updatedFront)

    console.log(`Minted org ${orgQid} (${orgName}) for card ${cardId}, added P110 to ${personQid}`)
    res.json({ ok: true, qid: orgQid })
  } catch (err) {
    console.error(`Failed to mint org for card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/wikibase/mint-back-artist
// Body: { cardId, entryIndex }
// Creates an artist person entity in Wikibase from a back card entry
router.post('/mint-back-artist', async (req, res) => {
  const { cardId, entryIndex } = req.body
  if (!cardId) return res.status(400).json({ error: 'cardId is required' })
  if (entryIndex === undefined || entryIndex === null) return res.status(400).json({ error: 'entryIndex is required' })

  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const back = card.back
    if (!back) return res.status(400).json({ error: 'Card has no back data' })

    const entry = back.entries?.[entryIndex]
    if (!entry) return res.status(400).json({ error: `No entry at index ${entryIndex}` })

    const rawName = entry.name
    if (!rawName || rawName === 'null') return res.status(400).json({ error: 'Entry has no name' })

    // Title case the name (e.g. "IAN WHITECROSS" -> "Ian Whitecross")
    const name = rawName.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

    // Build claims
    const claims = {
      P1: 'Q1',           // instance of: person
      P11: 'Q28603',      // part of project: E.A.T. Technical Services Program Edge-Notched Cards
      P65: {              // member of: Technical Services Program
        value: 'Q24347',
        qualifiers: { P117: 'Q19157' }  // has role: artist
      }
    }

    const result = await wbEdit.entity.create({
      type: 'item',
      labels: { en: name },
      descriptions: { en: "artist associated with E.A.T.'s Technical Services Program" },
      claims
    })

    const newQid = result.entity.id

    // Save QID back to the entry in the back JSON
    back.entries[entryIndex].wikibase_person_qid = newQid
    await cardStore.updateBack(cardId, back)

    console.log(`Minted back artist ${newQid} for card ${cardId} entry ${entryIndex} (${name})`)
    res.json({ ok: true, qid: newQid })
  } catch (err) {
    console.error(`Failed to mint back artist for card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/wikibase/mint-back-artist-from-wikidata
// Body: { cardId, entryIndex, wikidataQid }
// Creates an artist person entity in Wikibase using label/description from Wikidata
router.post('/mint-back-artist-from-wikidata', async (req, res) => {
  const { cardId, entryIndex, wikidataQid } = req.body
  if (!cardId) return res.status(400).json({ error: 'cardId is required' })
  if (entryIndex === undefined || entryIndex === null) return res.status(400).json({ error: 'entryIndex is required' })
  if (!wikidataQid) return res.status(400).json({ error: 'wikidataQid is required' })

  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const back = card.back
    if (!back) return res.status(400).json({ error: 'Card has no back data' })

    const entry = back.entries?.[entryIndex]
    if (!entry) return res.status(400).json({ error: `No entry at index ${entryIndex}` })

    // Fetch label and description from Wikidata
    const wd = await getWikidataLabelDescription(wikidataQid)
    const rawName = entry.name
    const label = wd.label || (rawName ? rawName.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : null)
    if (!label) return res.status(400).json({ error: 'No label found on Wikidata or card' })
    const description = wd.description || "artist associated with E.A.T.'s Technical Services Program"

    // Build claims — same as mint-back-artist plus P8
    const claims = {
      P1: 'Q1',           // instance of: person
      P11: 'Q28603',      // part of project: E.A.T. Technical Services Program Edge-Notched Cards
      P65: {              // member of: Technical Services Program
        value: 'Q24347',
        qualifiers: { P117: 'Q19157' }  // has role: artist
      },
      P8: wikidataQid     // Wikidata QID (external identifier)
    }

    const result = await wbEdit.entity.create({
      type: 'item',
      labels: { en: label },
      descriptions: { en: description },
      claims
    })

    const newQid = result.entity.id

    // Save QID back to the entry in the back JSON
    back.entries[entryIndex].wikibase_person_qid = newQid
    await cardStore.updateBack(cardId, back)

    console.log(`Minted back artist ${newQid} from Wikidata ${wikidataQid} for card ${cardId} entry ${entryIndex} (${label})`)
    res.json({ ok: true, qid: newQid })
  } catch (err) {
    console.error(`Failed to mint back artist from Wikidata for card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/wikibase/mint-org-from-wikidata
// Body: { cardId, wikidataQid, orgTypeQid }
// Creates an org entity in Wikibase using label/description from Wikidata
router.post('/mint-org-from-wikidata', async (req, res) => {
  const { cardId, wikidataQid, orgTypeQid } = req.body
  if (!cardId) return res.status(400).json({ error: 'cardId is required' })
  if (!wikidataQid) return res.status(400).json({ error: 'wikidataQid is required' })
  if (!orgTypeQid) return res.status(400).json({ error: 'orgTypeQid is required' })

  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const front = card.front
    if (!front) return res.status(400).json({ error: 'Card has no front data' })

    const personQid = front.wikibase_person_qid
    if (!personQid) return res.status(400).json({ error: 'Person must be minted first (no wikibase_person_qid)' })

    // Fetch label and description from Wikidata
    const wd = await getWikidataLabelDescription(wikidataQid)
    const label = wd.label || front?.professionalAffiliation?.employerOrganization
    if (!label) return res.status(400).json({ error: 'No label found on Wikidata or card' })
    const description = wd.description || null

    // Build claims
    const claims = {
      P1: orgTypeQid,      // instance of: institution (Q1804) or business (Q19085)
      P11: 'Q28603',       // part of project: E.A.T. Technical Services Program Edge-Notched Cards
      P8: wikidataQid      // Wikidata QID (external identifier)
    }

    const createOpts = {
      type: 'item',
      labels: { en: label },
      claims
    }
    if (description) {
      createOpts.descriptions = { en: description }
    }

    const result = await wbEdit.entity.create(createOpts)

    const orgQid = result.entity.id

    // Add P110 (employer) claim to the person entity pointing to this org
    await wbEdit.claim.create({
      id: personQid,
      property: 'P110',
      value: orgQid
    })

    // Save org QID back to the front JSON
    const updatedFront = { ...front, wikibase_org_qid: orgQid }
    await cardStore.updateFront(cardId, updatedFront)

    console.log(`Minted org ${orgQid} from Wikidata ${wikidataQid} for card ${cardId}, added P110 to ${personQid}`)
    res.json({ ok: true, qid: orgQid })
  } catch (err) {
    console.error(`Failed to mint org from Wikidata for card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// The standard claims every edge-notched card document carries.
function documentBaseClaims(cardId, engineerQid) {
  return {
    P1: 'Q28613',       // instance of: edge-notched card
    P11: 'Q28603',      // part of project: E.A.T. Technical Services Program Edge-Notched Cards
    P74: 'Q19263',      // creator: Experiments in Art and Technology
    P96: 'Q24347',      // part of: Technical Services Program
    P130: 'Yellow McBee edge-notched card used in the Technical Services Program to match engineers with artists. The engineers\' information is listed on the front side and a handwritten list of artists are written down on the back side.',
    P142: 'The Getty Research Institute. Research Library. Special Collections. 1200 Getty. Center Drive, Suite 1100. Los Angeles, CA 90049-1688.Tel: 310 440 7390. Not to be reproduced without permission',
    P17: cardId,         // local ID
    P136: 'Creator: Experiments in Art and Technology (E.A.T.)',
    P77: engineerQid,    // main subject: the engineer
  }
}

// Add a claim only if the entity does not already carry (property, value).
// Returns true when a claim was created.
async function ensureClaim(wbEdit, entityQid, property, value, extra = {}) {
  const existing = await findClaimGuid(entityQid, property, value)
  if (existing) return false
  await wbEdit.claim.create({ id: entityQid, property, value, ...extra })
  return true
}

// Locate blocks (P1 = Q2013) whose parent document (P24) is documentQid.
// Wikibase registers statement targets as page links, so "what links here"
// on the document lists its blocks. Returns { '0': qid, '1': qid, ... } keyed
// by the block's local ID (P17).
export async function findExistingBlocks(documentQid) {
  const blUrl = `${WIKIBASE_INSTANCE}/w/api.php?` + new URLSearchParams({
    action: 'query',
    list: 'backlinks',
    bltitle: `Item:${documentQid}`,
    blnamespace: '120',
    bllimit: '500',
    format: 'json'
  })
  const blRes = await fetch(blUrl, { headers: { 'User-Agent': WIKIBASE_USER_AGENT } })
  if (!blRes.ok) throw new Error(`Wikibase API error: ${blRes.status}`)
  const blData = await blRes.json()
  if (blData.error) throw new Error(`Wikibase API error: ${blData.error.info || blData.error.code}`)
  const ids = (blData.query?.backlinks || [])
    .map(b => b.title.replace(/^Item:/, ''))
    .filter(id => /^Q\d+$/.test(id))
  if (ids.length === 0) return {}

  const blocks = {}
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const url = `${WIKIBASE_INSTANCE}/w/api.php?` + new URLSearchParams({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'claims',
      format: 'json'
    })
    const res = await fetch(url, { headers: { 'User-Agent': WIKIBASE_USER_AGENT } })
    if (!res.ok) throw new Error(`Wikibase API error: ${res.status}`)
    const data = await res.json()
    for (const [qid, entity] of Object.entries(data.entities || {})) {
      const claims = entity.claims || {}
      const val = (p) => claims[p]?.[0]?.mainsnak?.datavalue?.value
      const isBlock = claims.P1?.some(c => c.mainsnak?.datavalue?.value?.id === 'Q2013')
      const parent = val('P24')?.id
      if (!isBlock || parent !== documentQid) continue
      const localId = val('P17')
      if (localId !== undefined && blocks[localId] === undefined) blocks[localId] = qid
    }
  }
  return blocks
}

// POST /api/wikibase/mint-card
// Body: { cardId }
// Creates the document + front block + back block and uploads images/OCR to S3.
// If the card already has a document_qid (e.g. set manually to a pre-existing
// Wikibase item), that document is reused: missing claims are added to it and
// only the blocks that do not yet exist are created.
router.post('/mint-card', async (req, res) => {
  const { cardId } = req.body
  if (!cardId) return res.status(400).json({ error: 'cardId is required' })

  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const front = card.front
    const back = card.back
    if (!front) return res.status(400).json({ error: 'Card has no front data' })

    const engineerQid = front.wikibase_person_qid
    if (!engineerQid) return res.status(400).json({ error: 'Engineer must be minted first' })

    // Card label: "B14-Aaron-Rabinowitz" -> "B14 Aaron Rabinowitz Edge-Notched Card"
    const cardLabel = cardId.replace(/-/g, ' ') + ' Edge-Notched Card'

    // ===== 0. ENSURE EMPLOYER (P110) CLAIM ON THE ENGINEER =====
    // Orgs matched to an already-existing Wikibase entity (rather than minted
    // through the app) have no P110 claim on the engineer yet — add it here.
    const orgQid = front.wikibase_org_qid
    if (orgQid) {
      const added = await ensureClaim(wbEdit, engineerQid, 'P110', orgQid)
      if (added) console.log(`Added P110 (employer) ${orgQid} to engineer ${engineerQid}`)
    }

    // ===== 1. CREATE OR REUSE THE DOCUMENT (TD) =====
    let documentQid = front.document_qid || back?.document_qid || null
    let reusedDocument = false
    if (documentQid) {
      // Validate the manually-set QID before writing anything against it
      const checkUrl = `${WIKIBASE_INSTANCE}/w/api.php?` + new URLSearchParams({
        action: 'wbgetentities', ids: documentQid, props: 'info', format: 'json'
      })
      const checkRes = await fetch(checkUrl, { headers: { 'User-Agent': WIKIBASE_USER_AGENT } })
      const checkData = await checkRes.json()
      const ent = checkData.entities?.[documentQid]
      if (!ent || ent.missing !== undefined) {
        return res.status(400).json({ error: `Document ${documentQid} does not exist in Wikibase` })
      }
      if (ent.redirects?.to) documentQid = ent.redirects.to
      reusedDocument = true
      console.log(`Reusing existing DOCUMENT ${documentQid} for card ${cardId}`)

      // Fill in any of the standard document claims that are missing
      for (const [property, value] of Object.entries(documentBaseClaims(cardId, engineerQid))) {
        const added = await ensureClaim(wbEdit, documentQid, property, value)
        if (added) console.log(`Added ${property} to existing document ${documentQid}`)
      }
    } else {
      const docResult = await wbEdit.entity.create({
        type: 'item',
        labels: { en: cardLabel },
        claims: documentBaseClaims(cardId, engineerQid)
      })
      documentQid = docResult.entity.id
      console.log(`Created THE DOCUMENT ${documentQid} for card ${cardId}`)
    }

    // Blocks already attached to this document (only possible when reusing).
    // Prefer QIDs recorded in the JSON, then whatever Wikibase reports.
    const existingBlocks = reusedDocument ? await findExistingBlocks(documentQid) : {}
    const existingFrontBlockQid = front.block_qid || existingBlocks['0'] || null
    const existingBackBlockQid = back?.block_qid || existingBlocks['1'] || null
    if (reusedDocument) {
      console.log(`Existing blocks for ${documentQid}: front=${existingFrontBlockQid || 'none'}, back=${existingBackBlockQid || 'none'}`)
    }

    // ===== 2. UPLOAD IMAGES TO S3 =====
    if (!imageProvider) throw new Error('Image provider not configured')

    const frontImageBuffer = await imageProvider.getImageBuffer(`${cardId}_front.jpg`)
    const backImageBuffer = await imageProvider.getImageBuffer(`${cardId}_back.jpg`)

    const frontImageUrl = await uploadToS3(
      `images/eat-cards/${documentQid}_f.jpg`,
      frontImageBuffer,
      'image/jpeg'
    )
    const backImageUrl = await uploadToS3(
      `images/eat-cards/${documentQid}_b.jpg`,
      backImageBuffer,
      'image/jpeg'
    )
    console.log(`Uploaded images: ${frontImageUrl}, ${backImageUrl}`)

    // Add file URL (P200) claims to the document (skipped if already present)
    await ensureClaim(wbEdit, documentQid, 'P200', frontImageUrl)
    await ensureClaim(wbEdit, documentQid, 'P200', backImageUrl)

    // ===== 3. UPLOAD OCR TEXTS TO S3 =====
    const ocrFront = front.ocr_front || ''
    const ocrBack = back?.ocr_back || ''

    const frontTextUrl = await uploadToS3(
      `texts/${documentQid}/0.txt`,
      Buffer.from(ocrFront, 'utf-8'),
      'text/plain; charset=utf-8'
    )
    const backTextUrl = await uploadToS3(
      `texts/${documentQid}/1.txt`,
      Buffer.from(ocrBack, 'utf-8'),
      'text/plain; charset=utf-8'
    )
    console.log(`Uploaded OCR texts: ${frontTextUrl}, ${backTextUrl}`)

    // ===== 4. CREATE OR REUSE THE FRONT BLOCK (TFB) =====
    // Associated entities (P21): engineer + org if exists
    const frontP21 = [engineerQid]
    if (front.wikibase_org_qid) {
      frontP21.push(front.wikibase_org_qid)
    }

    let frontBlockQid = existingFrontBlockQid
    if (frontBlockQid) {
      // Block already exists: only make sure the associated entities are on it
      for (const qid of frontP21) {
        const added = await ensureClaim(wbEdit, frontBlockQid, 'P21', qid)
        if (added) console.log(`Added P21 ${qid} to existing front block ${frontBlockQid}`)
      }
      console.log(`Reusing existing FRONT BLOCK ${frontBlockQid}`)
    } else {
      const frontOcrTrimmed = ocrFront.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 350)
      const frontBlockClaims = {
        P1: 'Q2013',          // instance of: block
        P11: 'Q28603',        // part of project
        P24: documentQid,     // parent document
        P17: '0',             // local ID
        P20: frontTextUrl,    // block text URL
        P21: frontP21,        // associated entities
      }
      if (frontOcrTrimmed) {
        frontBlockClaims.P19 = frontOcrTrimmed // block text
      }

      const frontBlockResult = await wbEdit.entity.create({
        type: 'item',
        labels: { en: `Block 0 of ${cardLabel}` },
        claims: frontBlockClaims
      })
      frontBlockQid = frontBlockResult.entity.id
      console.log(`Created THE FRONT BLOCK ${frontBlockQid}`)
    }

    // ===== 5. CREATE OR REUSE THE BACK BLOCK (TBB) =====
    let backBlockQid = existingBackBlockQid
    if (backBlockQid) {
      console.log(`Reusing existing BACK BLOCK ${backBlockQid}`)
    } else {
      const backOcrTrimmed = ocrBack.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 350)
      const backBlockClaims = {
        P1: 'Q2013',          // instance of: block
        P11: 'Q28603',        // part of project
        P24: documentQid,     // parent document
        P17: '1',             // local ID
        P20: backTextUrl,     // block text URL
      }
      if (backOcrTrimmed) {
        backBlockClaims.P19 = backOcrTrimmed // block text
      }

      const backBlockResult = await wbEdit.entity.create({
        type: 'item',
        labels: { en: `Block 1 of ${cardLabel}` },
        claims: backBlockClaims
      })
      backBlockQid = backBlockResult.entity.id
      console.log(`Created THE BACK BLOCK ${backBlockQid}`)
    }

    // Add P21 (associated entities) for each minted artist with date qualifiers.
    // Skips artists already linked from the block (matters when reusing a block).
    const entries = back?.entries || []
    for (const entry of entries) {
      if (!entry.wikibase_person_qid) continue
      if (existingBackBlockQid) {
        const already = await findClaimGuid(backBlockQid, 'P21', entry.wikibase_person_qid)
        if (already) continue
      }

      // Build qualifier: parse date, strip X's
      const qualifiers = {}
      if (entry.date && entry.date !== 'null') {
        // Remove X characters: "XXXX-06-05" -> "06-05", "1969-06-05" stays, "XXXX" -> ""
        const cleaned = entry.date.replace(/X/g, '').replace(/^-+/, '').replace(/-+$/, '')
        if (cleaned) {
          // Try to build a valid date for wikibase-edit Point in time
          // Formats: "1969-06-05" (full), "1969" (year only), "06-05" (month-day only)
          let timeValue = null
          if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
            // Full date: "+1969-06-05T00:00:00Z" precision 11 (day)
            timeValue = { time: `+${cleaned}T00:00:00Z`, precision: 11 }
          } else if (/^\d{4}-\d{2}$/.test(cleaned)) {
            // Year-month: precision 10 (month)
            timeValue = { time: `+${cleaned}-00T00:00:00Z`, precision: 10 }
          } else if (/^\d{4}$/.test(cleaned)) {
            // Year only: precision 9 (year)
            timeValue = { time: `+${cleaned}-00-00T00:00:00Z`, precision: 9 }
          } else if (/^\d{2}-\d{2}$/.test(cleaned)) {
            // Month-day only (no year): use 0000 as year, precision 11
            timeValue = { time: `+0000-${cleaned}T00:00:00Z`, precision: 11 }
          } else if (/^\d{2}$/.test(cleaned)) {
            // Month only: use 0000 as year, precision 10
            timeValue = { time: `+0000-${cleaned}-00T00:00:00Z`, precision: 10 }
          }
          if (timeValue) {
            qualifiers.P98 = timeValue
          }
        }
      }

      await wbEdit.claim.create({
        id: backBlockQid,
        property: 'P21',
        value: entry.wikibase_person_qid,
        qualifiers: Object.keys(qualifiers).length > 0 ? qualifiers : undefined
      })
    }

    // ===== 6. SAVE document_qid TO BOTH JSON FILES =====
    const updatedFront = { ...front, document_qid: documentQid, block_qid: frontBlockQid }
    await cardStore.updateFront(cardId, updatedFront)

    if (back) {
      const updatedBack = { ...back, document_qid: documentQid, block_qid: backBlockQid }
      await cardStore.updateBack(cardId, updatedBack)
    }

    console.log(`Mint card complete for ${cardId}: doc=${documentQid}${reusedDocument ? ' (reused)' : ''}, frontBlock=${frontBlockQid}, backBlock=${backBlockQid}`)
    res.json({
      ok: true,
      documentQid,
      frontBlockQid,
      backBlockQid,
      reusedDocument,
      reusedFrontBlock: Boolean(existingFrontBlockQid),
      reusedBackBlock: Boolean(existingBackBlockQid)
    })
  } catch (err) {
    console.error(`Failed to mint card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

// Fetch entity claims from Wikibase API and find the claim GUID for a specific property+value
export async function findClaimGuid(entityQid, property, targetValue) {
  const url = `${WIKIBASE_INSTANCE}/w/api.php?` + new URLSearchParams({
    action: 'wbgetentities',
    ids: entityQid,
    props: 'claims',
    format: 'json'
  })
  const res = await fetch(url, { headers: { 'User-Agent': WIKIBASE_USER_AGENT } })
  if (!res.ok) throw new Error(`Wikibase API error: ${res.status}`)
  const data = await res.json()
  const claims = data.entities?.[entityQid]?.claims?.[property]
  if (!claims) return null
  for (const claim of claims) {
    if (targetValue === null) return claim.id  // any claim with this property
    const dv = claim.mainsnak?.datavalue?.value
    // Item values are { id: 'Q123' }; string/url values are plain strings
    const val = (dv && typeof dv === 'object') ? dv.id : dv
    if (val === targetValue) return claim.id
  }
  return null
}

// POST /api/wikibase/build-collaborators
// Body: { cardId }
// Creates bidirectional P278 (proposed collaborator) claims between engineer and each minted back artist
// with reference to the back block QID
// Also adds P26 (reference block) references to existing P65 (member of) = Q24347 claims
router.post('/build-collaborators', async (req, res) => {
  const { cardId } = req.body
  const { wbEdit } = req.wbSession

  try {
    const card = await cardStore.getCard(cardId)
    const front = card.front
    const back = card.back

    const engineerQid = front?.wikibase_person_qid
    const frontBlockQid = front?.block_qid
    const backBlockQid = back?.block_qid

    if (!engineerQid) return res.status(400).json({ error: 'Engineer not minted' })
    if (!backBlockQid) return res.status(400).json({ error: 'Card not minted (no back block QID)' })

    const entries = back?.entries || []
    const artistQids = entries
      .filter(e => e.wikibase_person_qid)
      .map(e => e.wikibase_person_qid)

    if (artistQids.length === 0) {
      return res.status(400).json({ error: 'No minted artists found' })
    }

    const skipped = []
    const isDuplicateRefError = (err) => {
      const msg = err?.message || String(err)
      return msg.includes('reference with hash')
    }
    const runStep = async (description, fn) => {
      try {
        await fn()
        return true
      } catch (err) {
        if (isDuplicateRefError(err)) {
          const reason = err?.message || String(err)
          console.warn(`Skipped step "${description}": ${reason}`)
          skipped.push({ step: description, reason })
          return false
        }
        throw err
      }
    }

    let created = 0
    for (const artistQid of artistQids) {
      // artist -> proposed collaborator -> engineer (with reference to back block)
      const a = await runStep(
        `Add P278 claim on ${artistQid} -> ${engineerQid} (ref back block ${backBlockQid})`,
        () => wbEdit.claim.create({
          id: artistQid,
          property: 'P278',
          value: engineerQid,
          references: [{ P26: backBlockQid }]  // reference block
        })
      )

      // engineer -> proposed collaborator -> artist (with reference to back block)
      const b = await runStep(
        `Add P278 claim on ${engineerQid} -> ${artistQid} (ref back block ${backBlockQid})`,
        () => wbEdit.claim.create({
          id: engineerQid,
          property: 'P278',
          value: artistQid,
          references: [{ P26: backBlockQid }]  // reference block
        })
      )

      if (a && b) created++
    }

    // Add P26 (reference block) references to existing P65 = Q24347 claims
    // Engineer: P65 = Q24347 gets reference P26 = front block QID
    if (frontBlockQid) {
      const engineerClaimGuid = await findClaimGuid(engineerQid, 'P65', 'Q24347')
      if (engineerClaimGuid) {
        await runStep(
          `Add P26=${frontBlockQid} reference to engineer ${engineerQid} P65=Q24347 claim`,
          () => wbEdit.reference.set({
            guid: engineerClaimGuid,
            snaks: { P26: frontBlockQid }
          })
        )
        console.log(`Added P26=${frontBlockQid} reference to engineer ${engineerQid} P65 claim`)
      } else {
        console.warn(`No P65=Q24347 claim found on engineer ${engineerQid}`)
      }
    }

    // Engineer: P110 (employer) gets reference P26 = front block QID (if employer claim exists)
    if (frontBlockQid) {
      const employerClaimGuid = await findClaimGuid(engineerQid, 'P110', null)
      if (employerClaimGuid) {
        await runStep(
          `Add P26=${frontBlockQid} reference to engineer ${engineerQid} P110 claim`,
          () => wbEdit.reference.set({
            guid: employerClaimGuid,
            snaks: { P26: frontBlockQid }
          })
        )
        console.log(`Added P26=${frontBlockQid} reference to engineer ${engineerQid} P110 claim`)
      }
    }

    // Each artist: P65 = Q24347 gets reference P26 = back block QID
    for (const artistQid of artistQids) {
      const artistClaimGuid = await findClaimGuid(artistQid, 'P65', 'Q24347')
      if (artistClaimGuid) {
        await runStep(
          `Add P26=${backBlockQid} reference to artist ${artistQid} P65=Q24347 claim`,
          () => wbEdit.reference.set({
            guid: artistClaimGuid,
            snaks: { P26: backBlockQid }
          })
        )
        console.log(`Added P26=${backBlockQid} reference to artist ${artistQid} P65 claim`)
      } else {
        console.warn(`No P65=Q24347 claim found on artist ${artistQid}`)
      }
    }

    console.log(`Built ${created} collaborator relationships for ${cardId} (skipped ${skipped.length})`)
    res.json({ ok: true, created, skipped })
  } catch (err) {
    console.error(`Failed to build collaborators for ${cardId}:`, err)
    res.status(500).json({ error: err.message || String(err) })
  }
})

export default router
