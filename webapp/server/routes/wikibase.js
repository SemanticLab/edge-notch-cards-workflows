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

// POST /api/wikibase/mint-card
// Body: { cardId }
// Creates THE DOCUMENT, uploads images+OCR to S3, creates THE FRONT BLOCK and THE BACK BLOCK
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

    // ===== 1. CREATE THE DOCUMENT (TD) =====
    const docResult = await wbEdit.entity.create({
      type: 'item',
      labels: { en: cardLabel },
      claims: {
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
    })
    const documentQid = docResult.entity.id
    console.log(`Created THE DOCUMENT ${documentQid} for card ${cardId}`)

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

    // Add file URL (P200) claims to the document
    await wbEdit.claim.create({ id: documentQid, property: 'P200', value: frontImageUrl })
    await wbEdit.claim.create({ id: documentQid, property: 'P200', value: backImageUrl })

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

    // ===== 4. CREATE THE FRONT BLOCK (TFB) =====
    const frontOcrTrimmed = ocrFront.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 350)
    const frontBlockClaims = {
      P1: 'Q2013',          // instance of: block
      P11: 'Q28603',        // part of project
      P24: documentQid,     // parent document
      P17: '0',             // local ID
      P20: frontTextUrl,    // block text URL
    }
    if (frontOcrTrimmed) {
      frontBlockClaims.P19 = frontOcrTrimmed // block text
    }

    // Associated entities (P21): engineer + org if exists
    const frontP21 = [engineerQid]
    if (front.wikibase_org_qid) {
      frontP21.push(front.wikibase_org_qid)
    }
    frontBlockClaims.P21 = frontP21

    const frontBlockResult = await wbEdit.entity.create({
      type: 'item',
      labels: { en: `Block 0 of ${cardLabel}` },
      claims: frontBlockClaims
    })
    const frontBlockQid = frontBlockResult.entity.id
    console.log(`Created THE FRONT BLOCK ${frontBlockQid}`)

    // ===== 5. CREATE THE BACK BLOCK (TBB) =====
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
    const backBlockQid = backBlockResult.entity.id
    console.log(`Created THE BACK BLOCK ${backBlockQid}`)

    // Add P21 (associated entities) for each minted artist with date qualifiers
    const entries = back?.entries || []
    for (const entry of entries) {
      if (!entry.wikibase_person_qid) continue

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

    console.log(`Mint card complete for ${cardId}: doc=${documentQid}, frontBlock=${frontBlockQid}, backBlock=${backBlockQid}`)
    res.json({
      ok: true,
      documentQid,
      frontBlockQid,
      backBlockQid
    })
  } catch (err) {
    console.error(`Failed to mint card ${cardId}:`, err.message)
    res.status(500).json({ error: err.message })
  }
})

const WIKIBASE_INSTANCE = 'https://base.semlab.io'

// Fetch entity claims from Wikibase API and find the claim GUID for a specific property+value
async function findClaimGuid(entityQid, property, targetValue) {
  const url = `${WIKIBASE_INSTANCE}/w/api.php?` + new URLSearchParams({
    action: 'wbgetentities',
    ids: entityQid,
    props: 'claims',
    format: 'json'
  })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Wikibase API error: ${res.status}`)
  const data = await res.json()
  const claims = data.entities?.[entityQid]?.claims?.[property]
  if (!claims) return null
  for (const claim of claims) {
    if (targetValue === null) return claim.id  // any claim with this property
    const val = claim.mainsnak?.datavalue?.value?.id
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

    let created = 0
    for (const artistQid of artistQids) {
      // artist -> proposed collaborator -> engineer (with reference to back block)
      await wbEdit.claim.create({
        id: artistQid,
        property: 'P278',
        value: engineerQid,
        references: [{ P24: backBlockQid }]
      })

      // engineer -> proposed collaborator -> artist (with reference to back block)
      await wbEdit.claim.create({
        id: engineerQid,
        property: 'P278',
        value: artistQid,
        references: [{ P24: backBlockQid }]
      })

      created++
    }

    // Add P26 (reference block) references to existing P65 = Q24347 claims
    // Engineer: P65 = Q24347 gets reference P26 = front block QID
    if (frontBlockQid) {
      const engineerClaimGuid = await findClaimGuid(engineerQid, 'P65', 'Q24347')
      if (engineerClaimGuid) {
        await wbEdit.reference.set({
          guid: engineerClaimGuid,
          snaks: { P26: frontBlockQid }
        })
        console.log(`Added P26=${frontBlockQid} reference to engineer ${engineerQid} P65 claim`)
      } else {
        console.warn(`No P65=Q24347 claim found on engineer ${engineerQid}`)
      }
    }

    // Engineer: P110 (employer) gets reference P26 = front block QID (if employer claim exists)
    if (frontBlockQid) {
      const employerClaimGuid = await findClaimGuid(engineerQid, 'P110', null)
      if (employerClaimGuid) {
        await wbEdit.reference.set({
          guid: employerClaimGuid,
          snaks: { P26: frontBlockQid }
        })
        console.log(`Added P26=${frontBlockQid} reference to engineer ${engineerQid} P110 claim`)
      }
    }

    // Each artist: P65 = Q24347 gets reference P26 = back block QID
    for (const artistQid of artistQids) {
      const artistClaimGuid = await findClaimGuid(artistQid, 'P65', 'Q24347')
      if (artistClaimGuid) {
        await wbEdit.reference.set({
          guid: artistClaimGuid,
          snaks: { P26: backBlockQid }
        })
        console.log(`Added P26=${backBlockQid} reference to artist ${artistQid} P65 claim`)
      } else {
        console.warn(`No P65=Q24347 claim found on artist ${artistQid}`)
      }
    }

    console.log(`Built ${created} collaborator relationships for ${cardId}`)
    res.json({ ok: true, created })
  } catch (err) {
    console.error(`Failed to build collaborators for ${cardId}:`, err)
    res.status(500).json({ error: err.message || String(err) })
  }
})

export default router
