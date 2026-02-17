import { Router } from 'express';
import sharp from 'sharp';
import { LRUCache } from 'lru-cache';
import path from 'node:path';

const cropCache = new LRUCache({ max: 200 });

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Create the images router.
 * @param {Object} imageProvider - an image provider instance (e.g. LocalImageProvider)
 * @returns {Router}
 */
export default function createImagesRouter(imageProvider) {
  const router = Router();

  /**
   * GET /:filename
   * Serve an image file with appropriate Content-Type and Cache-Control headers.
   */
  router.get('/:filename', async (req, res) => {
    try {
      const { filename } = req.params;
      const ext = path.extname(filename).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');

      // Local provider can use sendFile; S3 must send buffer
      const imagePath = await imageProvider.getImagePath(filename);
      if (imagePath) {
        res.sendFile(imagePath);
      } else {
        const buffer = await imageProvider.getImageBuffer(filename);
        res.send(buffer);
      }
    } catch (err) {
      if (err.code === 'ENOENT' || err.name === 'NoSuchKey') {
        console.warn(`Image not found: ${req.params.filename} (${err.name || err.code})`);
        return res.status(404).json({ error: 'Image not found' });
      }
      console.error(`Error serving image ${req.params.filename}:`, err.name, err.message);
      res.status(500).json({ error: 'Failed to serve image' });
    }
  });

  /**
   * GET /:filename/crop
   * Crop a region from an image. Query params x1, y1, x2, y2 are percentages (0-100).
   * Returns JPEG. Results are cached in an LRU cache (max 200 entries).
   */
  router.get('/:filename/crop', async (req, res) => {
    try {
      const { filename } = req.params;
      const { x1, y1, x2, y2 } = req.query;

      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        return res.status(400).json({ error: 'x1, y1, x2, y2 query params are required' });
      }

      const px1 = parseFloat(x1);
      const py1 = parseFloat(y1);
      const px2 = parseFloat(x2);
      const py2 = parseFloat(y2);

      if ([px1, py1, px2, py2].some(v => isNaN(v) || v < 0 || v > 100)) {
        return res.status(400).json({ error: 'x1, y1, x2, y2 must be numbers between 0 and 100' });
      }

      // Check cache
      const cacheKey = `${filename}:${px1},${py1},${px2},${py2}`;
      const cached = cropCache.get(cacheKey);
      if (cached) {
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(cached);
      }

      // Read the full image buffer
      const buffer = await imageProvider.getImageBuffer(filename);
      const image = sharp(buffer);
      const metadata = await image.metadata();
      const { width, height } = metadata;

      // Convert percentages to pixel coordinates
      const left = Math.round((px1 / 100) * width);
      const top = Math.round((py1 / 100) * height);
      const cropWidth = Math.round(((px2 - px1) / 100) * width);
      const cropHeight = Math.round(((py2 - py1) / 100) * height);

      if (cropWidth <= 0 || cropHeight <= 0) {
        return res.status(400).json({ error: 'Crop region must have positive width and height' });
      }

      const cropped = await sharp(buffer)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Store in cache
      cropCache.set(cacheKey, cropped);

      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(cropped);
    } catch (err) {
      if (err.code === 'ENOENT' || err.name === 'NoSuchKey') {
        return res.status(404).json({ error: 'Image not found' });
      }
      console.error(`Error cropping image ${req.params.filename}:`, err);
      res.status(500).json({ error: 'Failed to crop image' });
    }
  });

  return router;
}
