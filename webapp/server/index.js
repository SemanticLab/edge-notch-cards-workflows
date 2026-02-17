import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cardStore from './lib/cardStore.js';
import { createImageProvider } from './lib/imageProvider.js';
import cardsRouter from './routes/cards.js';
import createImagesRouter from './routes/images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Environment configuration
const PORT = process.env.PORT || 7743;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const IMAGES_DIR = process.env.IMAGES_DIR || '/Volumes/GlumExpansion/edge-notch-cards-images';
const IMAGES_PROVIDER = process.env.IMAGES_PROVIDER || 'local';
const AWS_BUCKET = process.env.AWS_BUCKET || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_PREFIX = process.env.AWS_PREFIX || '';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

const app = express();

// Body parsing middleware
app.use(express.json());

// API routes
app.use('/api/cards', cardsRouter);

// Image provider
const imageProvider = createImageProvider({
  provider: IMAGES_PROVIDER,
  imagesDir: IMAGES_DIR,
  bucket: AWS_BUCKET,
  region: AWS_REGION,
  prefix: AWS_PREFIX,
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

app.use('/api/images', createImagesRouter(imageProvider));

// Serve static files from the Vite build output
const distDir = path.join(__dirname, '../dist');
app.use(express.static(distDir));

// SPA fallback: serve index.html for all non-API GET requests
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(distDir, 'index.html'));
});

// Initialize and start
async function start() {
  try {
    await cardStore.init(DATA_DIR);

    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
      console.log(`  DATA_DIR:   ${DATA_DIR}`);
      console.log(`  IMAGES:     ${IMAGES_PROVIDER === 's3' ? `s3://${AWS_BUCKET}/${AWS_PREFIX}` : IMAGES_DIR}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
