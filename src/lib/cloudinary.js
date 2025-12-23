import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

// Ensure env vars are loaded when this module is imported (important for ESM import order)
dotenv.config();

// Initialize cloudinary
if (process.env.CLOUDINARY_URL) {
  // Parse CLOUDINARY_URL (format: cloudinary://<api_key>:<api_secret>@<cloud_name>) using URL for robustness
  try {
    const raw = process.env.CLOUDINARY_URL;
    const parsed = new URL(raw);
    // URL.username and URL.password contain credentials for non-http schemes as well
    const api_key = parsed.username || undefined;
    const api_secret = parsed.password || undefined;
    const cloud_name = parsed.hostname || undefined;

    if (api_key && api_secret && cloud_name) {
      cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
    } else {
      // Let the library pick up CLOUDINARY_URL if it can; set secure to true as a safe default
      cloudinary.config({ secure: true });
    }
  } catch (e) {
    // Non-fatal: if parsing fails, let cloudinary library try to handle the env var
    console.debug('Cloudinary: failed to parse CLOUDINARY_URL with URL parser, falling back to library parsing:', e && e.message);
    cloudinary.config({ secure: true });
  }
} else if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
} else {
  console.warn('Cloudinary not configured: set CLOUDINARY_URL or CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET');
}

// Debug: report whether Cloudinary is configured and where (no secrets)
try {
  let configuredFrom = 'none';
  let configuredCloudName = null;

  // If CLOUDINARY_URL is present and contains a hostname, assume it configured Cloudinary
  if (process.env.CLOUDINARY_URL) {
    try {
      const p = new URL(process.env.CLOUDINARY_URL);
      if (p.hostname) {
        configuredFrom = 'CLOUDINARY_URL';
        configuredCloudName = p.hostname;
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  // If separate env vars provided, prefer that for reporting
  if (configuredFrom === 'none' && process.env.CLOUDINARY_CLOUD_NAME) {
    configuredFrom = 'separate_env_vars';
    configuredCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  }

  console.info('Cloudinary configuration:', { configuredFrom, cloudName: configuredCloudName });
} catch (err) {
  // ignore
}

function uploadBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

export { cloudinary, uploadBuffer };
