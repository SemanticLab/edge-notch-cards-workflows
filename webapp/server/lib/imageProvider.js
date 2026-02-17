import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Serves images from the local filesystem.
 */
class LocalImageProvider {
  constructor(imagesDir) {
    this.imagesDir = imagesDir;
    this.type = 'local';
  }

  async getImagePath(filename) {
    const fullPath = path.join(this.imagesDir, filename);
    await access(fullPath);
    return fullPath;
  }

  async getImageBuffer(filename) {
    const fullPath = path.join(this.imagesDir, filename);
    return readFile(fullPath);
  }
}

/**
 * Serves images from an S3 bucket.
 */
class S3ImageProvider {
  constructor({ bucket, region, prefix, accessKeyId, secretAccessKey }) {
    this.bucket = bucket;
    // Strip trailing slashes from prefix
    this.prefix = (prefix || '').replace(/\/+$/, '');
    this.type = 's3';

    const clientConfig = { region: region || 'us-east-1' };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }
    this.client = new S3Client(clientConfig);
    console.log(`S3ImageProvider: bucket=${this.bucket}, prefix="${this.prefix}", region=${clientConfig.region}`);
  }

  _key(filename) {
    return this.prefix ? `${this.prefix}/${filename}` : filename;
  }

  async getImagePath() {
    // S3 has no local path; the router will use getImageBuffer instead
    return null;
  }

  async getImageBuffer(filename) {
    const key = this._key(filename);
    console.log(`S3: fetching s3://${this.bucket}/${key}`);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    try {
      const response = await this.client.send(command);
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      console.error(`S3: failed to fetch s3://${this.bucket}/${key} — ${err.name}: ${err.message}`);
      throw err;
    }
  }
}

/**
 * Factory function that creates an image provider based on config.
 *
 * @param {Object} config
 * @param {string} config.provider - 'local' or 's3'
 * @param {string} config.imagesDir - path to images directory (local provider)
 * @param {string} config.bucket - S3 bucket name
 * @param {string} config.region - AWS region
 * @param {string} config.prefix - S3 key prefix (folder)
 * @param {string} config.accessKeyId - AWS access key ID
 * @param {string} config.secretAccessKey - AWS secret access key
 * @returns {LocalImageProvider|S3ImageProvider}
 */
export function createImageProvider(config) {
  if (config.provider === 's3') {
    if (!config.bucket) {
      throw new Error('AWS_BUCKET is required for S3 image provider');
    }
    return new S3ImageProvider({
      bucket: config.bucket,
      region: config.region,
      prefix: config.prefix,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
  }

  return new LocalImageProvider(config.imagesDir);
}
