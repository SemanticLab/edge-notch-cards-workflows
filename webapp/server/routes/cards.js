import { Router } from 'express';
import * as cardStore from '../lib/cardStore.js';

const router = Router();

/**
 * GET /
 * List cards with optional filtering and pagination.
 * Query params: q, occupation, organization, location, hasBack, page, pageSize
 */
router.get('/', (req, res) => {
  try {
    const { q, occupation, organization, location, hasBack, complete, page, pageSize } = req.query;
    const result = cardStore.listCards({ q, occupation, organization, location, hasBack, complete, page, pageSize });
    res.json(result);
  } catch (err) {
    console.error('Error listing cards:', err);
    res.status(500).json({ error: 'Failed to list cards' });
  }
});

/**
 * GET /filter-options
 * Return distinct values for filter dropdowns.
 */
router.get('/filter-options', (req, res) => {
  try {
    const options = cardStore.getFilterOptions();
    res.json(options);
  } catch (err) {
    console.error('Error getting filter options:', err);
    res.status(500).json({ error: 'Failed to get filter options' });
  }
});

/**
 * GET /:id
 * Get full card data (front, back, image URLs).
 */
router.get('/:id', async (req, res) => {
  try {
    const card = await cardStore.getCard(req.params.id);
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    res.json(card);
  } catch (err) {
    console.error(`Error getting card ${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to get card' });
  }
});

/**
 * PUT /:id/front
 * Update front data for a card.
 */
router.put('/:id/front', async (req, res) => {
  try {
    await cardStore.updateFront(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    if (err.message.includes('fullName is required')) {
      return res.status(400).json({ error: err.message });
    }
    console.error(`Error updating front for ${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to update front data' });
  }
});

/**
 * PUT /:id/back
 * Update back data for a card.
 */
router.put('/:id/back', async (req, res) => {
  try {
    await cardStore.updateBack(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error(`Error updating back for ${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to update back data' });
  }
});

/**
 * PUT /:id/complete
 * Toggle the complete flag for a card.
 */
router.put('/:id/complete', async (req, res) => {
  try {
    const value = await cardStore.toggleComplete(req.params.id, req.body.complete);
    res.json({ ok: true, complete: value });
  } catch (err) {
    console.error(`Error toggling complete for ${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to toggle complete' });
  }
});

export default router;
