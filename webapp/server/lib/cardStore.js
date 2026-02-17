import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

let DATA_DIR = '';
let cards = [];
let filterOptionsCache = null;
let metadata = {};
let metadataPath = '';

/**
 * Extract card ID from a filename by removing the _front or _back suffix.
 * e.g. "B14-A-Kronfeld_front.json" -> "B14-A-Kronfeld"
 */
function cardIdFromFilename(filename) {
  return filename
    .replace(/\.json$/, '')
    .replace(/_(front|back)$/, '');
}

/**
 * Safely read and parse a JSON file. Returns null on any error.
 */
async function readJSON(filePath) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save metadata to disk atomically.
 */
async function saveMetadata() {
  const tmpPath = metadataPath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(metadata, null, 2), 'utf-8');
  await rename(tmpPath, metadataPath);
}

/**
 * Build a card summary from the front and back JSON data.
 */
function buildSummary(id, frontData, hasBack, backData) {
  const hasError = !!(frontData && frontData.error);

  let name = '';
  let occupation = '';
  let organization = '';
  let location = '';

  if (frontData && !hasError) {
    name = frontData.personalIdentification?.fullName || '';
    occupation = frontData.professionalIdentityExpertise?.jobTitleOccupation || '';
    organization = frontData.professionalAffiliation?.employerOrganization || '';
    location = frontData.contactInformation?.geographicLocation || '';
  }

  let backEntryCount = 0;
  if (backData && Array.isArray(backData.entries)) {
    backEntryCount = backData.entries.length;
  }

  return {
    id,
    name,
    occupation,
    organization,
    location,
    hasBack,
    backEntryCount,
    hasError,
    complete: !!(metadata[id]?.complete),
  };
}

/**
 * Initialize the card store by scanning front and back JSON directories.
 */
export async function init(dataDir) {
  DATA_DIR = dataDir;
  filterOptionsCache = null;

  // Load metadata
  metadataPath = path.join(DATA_DIR, 'metadata.json');
  metadata = (await readJSON(metadataPath)) || {};

  const frontDir = path.join(DATA_DIR, 'front');
  const backDir = path.join(DATA_DIR, 'back');

  // Read directory listings
  let frontFiles = [];
  let backFiles = [];
  try {
    frontFiles = (await readdir(frontDir)).filter(f => f.endsWith('.json'));
  } catch {
    console.warn(`cardStore: could not read front directory: ${frontDir}`);
  }
  try {
    backFiles = (await readdir(backDir)).filter(f => f.endsWith('.json'));
  } catch {
    console.warn(`cardStore: could not read back directory: ${backDir}`);
  }

  // Build a set of back card IDs for quick lookup
  const backIds = new Set(backFiles.map(f => cardIdFromFilename(f)));

  // Collect all unique card IDs from both directories
  const allIds = new Set();
  for (const f of frontFiles) allIds.add(cardIdFromFilename(f));
  for (const f of backFiles) allIds.add(cardIdFromFilename(f));

  // Build summaries in parallel
  const summaries = await Promise.all(
    [...allIds].map(async (id) => {
      const frontPath = path.join(frontDir, `${id}_front.json`);
      const backPath = path.join(backDir, `${id}_back.json`);

      const frontData = await readJSON(frontPath);
      const hasBack = backIds.has(id);
      const backData = hasBack ? await readJSON(backPath) : null;

      return buildSummary(id, frontData, hasBack, backData);
    })
  );

  // Sort by name (alphabetical), putting empty names at the end
  summaries.sort((a, b) => {
    if (!a.name && !b.name) return a.id.localeCompare(b.id);
    if (!a.name) return 1;
    if (!b.name) return -1;
    return a.name.localeCompare(b.name);
  });

  cards = summaries;
  console.log(`cardStore: indexed ${cards.length} cards (${frontFiles.length} fronts, ${backFiles.length} backs)`);
}

/**
 * List cards with optional filtering and pagination.
 */
export function listCards({ q, occupation, organization, location, hasBack, complete, page = 1, pageSize = 50 } = {}) {
  let filtered = cards;

  if (q) {
    const lq = q.toLowerCase();
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(lq) ||
      c.id.toLowerCase().includes(lq) ||
      c.organization.toLowerCase().includes(lq) ||
      c.occupation.toLowerCase().includes(lq) ||
      c.location.toLowerCase().includes(lq)
    );
  }

  if (occupation) {
    const lo = occupation.toLowerCase();
    filtered = filtered.filter(c => c.occupation.toLowerCase().includes(lo));
  }

  if (organization) {
    const lo = organization.toLowerCase();
    filtered = filtered.filter(c => c.organization.toLowerCase().includes(lo));
  }

  if (location) {
    const ll = location.toLowerCase();
    filtered = filtered.filter(c => c.location.toLowerCase().includes(ll));
  }

  if (hasBack !== undefined && hasBack !== null && hasBack !== '') {
    const wantBack = hasBack === true || hasBack === 'true';
    filtered = filtered.filter(c => c.hasBack === wantBack);
  }

  if (complete !== undefined && complete !== null && complete !== '') {
    const wantComplete = complete === true || complete === 'true';
    filtered = filtered.filter(c => c.complete === wantComplete);
  }

  const total = filtered.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(10000, Number(pageSize) || 10000));
  const totalPages = Math.ceil(total / ps);
  const start = (p - 1) * ps;
  const items = filtered.slice(start, start + ps);

  return {
    items,
    total,
    page: p,
    pageSize: ps,
    totalPages,
  };
}

/**
 * Get full card data (front + back JSON) for a single card.
 */
export async function getCard(id) {
  const frontPath = path.join(DATA_DIR, 'front', `${id}_front.json`);
  const backPath = path.join(DATA_DIR, 'back', `${id}_back.json`);

  const front = await readJSON(frontPath);
  if (!front) {
    return null;
  }

  const back = await readJSON(backPath);

  return {
    id,
    front,
    back,
    complete: !!(metadata[id]?.complete),
    images: {
      front: `${id}_front.jpg`,
      back: `${id}_back.jpg`,
    },
  };
}

/**
 * Toggle the complete flag for a card. Returns the new value.
 */
export async function toggleComplete(id, value) {
  if (!metadata[id]) {
    metadata[id] = {};
  }
  metadata[id].complete = !!value;
  await saveMetadata();

  // Update in-memory summary
  const idx = cards.findIndex(c => c.id === id);
  if (idx !== -1) {
    cards[idx].complete = !!value;
  }

  return !!value;
}

/**
 * Update the front JSON for a card. Validates that fullName exists.
 * Writes atomically (tmp file + rename).
 */
export async function updateFront(id, data) {
  if (!data?.personalIdentification?.fullName) {
    throw new Error('personalIdentification.fullName is required');
  }

  const filePath = path.join(DATA_DIR, 'front', `${id}_front.json`);
  const tmpPath = filePath + '.tmp';

  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmpPath, filePath);

  // Update in-memory summary
  const idx = cards.findIndex(c => c.id === id);
  if (idx !== -1) {
    const existing = cards[idx];
    cards[idx] = buildSummary(id, data, existing.hasBack, null);
    cards[idx].backEntryCount = existing.backEntryCount;
  }

  filterOptionsCache = null;
}

/**
 * Update the back JSON for a card.
 * Writes atomically (tmp file + rename).
 */
export async function updateBack(id, data) {
  const filePath = path.join(DATA_DIR, 'back', `${id}_back.json`);
  const tmpPath = filePath + '.tmp';

  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmpPath, filePath);

  // Update in-memory summary
  const idx = cards.findIndex(c => c.id === id);
  if (idx !== -1) {
    cards[idx].hasBack = true;
    cards[idx].backEntryCount = Array.isArray(data?.entries) ? data.entries.length : 0;
  }

  filterOptionsCache = null;
}

/**
 * Return distinct non-empty values for occupations, organizations, and locations.
 * Results are cached and invalidated on updates.
 */
export function getFilterOptions() {
  if (filterOptionsCache) {
    return filterOptionsCache;
  }

  const occupations = new Set();
  const organizations = new Set();
  const locations = new Set();

  for (const card of cards) {
    if (card.occupation) occupations.add(card.occupation);
    if (card.organization) organizations.add(card.organization);
    if (card.location) locations.add(card.location);
  }

  filterOptionsCache = {
    occupations: [...occupations].sort((a, b) => a.localeCompare(b)),
    organizations: [...organizations].sort((a, b) => a.localeCompare(b)),
    locations: [...locations].sort((a, b) => a.localeCompare(b)),
  };

  return filterOptionsCache;
}
