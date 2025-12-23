import express from 'express';
import multer from 'multer';
import auth from '../middleware/auth.js';
import { uploadBuffer } from '../lib/cloudinary.js';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Authenticated upload endpoint for real project use
// Field name: file
router.post('/', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const buffer = req.file.buffer;
    const pub = `uploads/${req.user._id}/${Date.now()}-${Math.round(Math.random()*1e6)}`;
    const uploaded = await uploadBuffer(buffer, { public_id: pub, folder: 'wego/uploads', resource_type: 'image' });
    return res.json({ url: uploaded.secure_url, public_id: uploaded.public_id, raw: uploaded });
  } catch (err) {
    console.error('Authenticated upload failed:', err);
    return res.status(500).json({ error: 'Upload failed', details: err.message || err });
  }
});

export default router;
