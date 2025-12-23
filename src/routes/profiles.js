import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadBuffer, cloudinary } from '../lib/cloudinary.js';
import Profile from '../models/profile.js';
import User from '../models/user.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Use memory storage so we can upload buffers to Cloudinary
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed!'));
  }
});

// Get profile by userId
// Public: List profiles (paginated)
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const q = req.query.q ? req.query.q.trim() : null;
    const filter = {};
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { bio: re }];
    }

    const [profiles, total] = await Promise.all([
      Profile.find(filter)
        .skip(skip)
        .limit(limit)
        .select('-__v')
        .populate({ path: 'userId', select: 'username email' }),
      Profile.countDocuments(filter)
    ]);

    res.json({ profiles, page, limit, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get profile by userId
router.get('/:userId', async (req, res) => {
  try {
    let profile = await Profile.findOne({ userId: req.params.userId });
    
    // If profile not found, return default profile instead of 404
    if (!profile) {
      profile = {
        userId: req.params.userId,
        name: 'User',
        bio: '',
        avatar: ''
      };
    }
    
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create/Update profile
router.post('/', auth, async (req, res) => {
  try {
    let profile = await Profile.findOne({ userId: req.user._id });
    if (profile) {
      // Update existing profile
      profile = await Profile.findOneAndUpdate(
        { userId: req.user._id },
        req.body,
        { new: true, runValidators: true }
      );
    } else {
      // Create new profile
      profile = new Profile({
        ...req.body,
        userId: req.user._id
      });
      await profile.save();
    }

    // Also update the User.username to reflect profile name (sanitized)
    try {
      // Prefer profile.name, fallback to email prefix
      const rawName = (profile.name && profile.name.toString()) || (req.user.email ? req.user.email.split('@')[0] : '');
      // Sanitize: replace spaces with underscore, remove invalid chars, limit length
      let candidate = rawName.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30);
      if (!candidate) candidate = (req.user.email ? req.user.email.split('@')[0] : '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0,30);

      if (candidate) {
        try {
          await User.findByIdAndUpdate(req.user._id, { username: candidate }, { new: true, runValidators: true });
        } catch (uErr) {
          // If a duplicate key error occurs (username already taken), try a fallback with suffix
          if (uErr && uErr.code === 11000) {
            const suffix = '-' + Date.now().toString().slice(-3);
            const fallback = (candidate + suffix).slice(0, 30);
            try {
              await User.findByIdAndUpdate(req.user._id, { username: fallback }, { new: true, runValidators: true });
            } catch (uErr2) {
              console.error('Failed to update user.username (fallback):', uErr2.message || uErr2);
            }
          } else {
            console.error('Failed to update user.username:', uErr.message || uErr);
          }
        }
      }
    } catch (nameErr) {
      console.error('Error while syncing profile name to user:', nameErr.message || nameErr);
    }
    res.json(profile);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Upload avatar
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('Please upload a file');
    }

    // Find or create profile
    let profile = await Profile.findOne({ userId: req.user._id });
    if (!profile) {
      profile = new Profile({
        userId: req.user._id,
        name: req.user.email.split('@')[0],
        bio: '',
        avatar: ''
      });
      await profile.save();
    }

    // Upload to Cloudinary
    const buffer = req.file.buffer;
    const filename = `profiles/${req.user._id}/avatar-${Date.now()}`;
    let result;
    try {
      result = await uploadBuffer(buffer, { public_id: filename, folder: 'wego/profiles', overwrite: true, resource_type: 'image' });
    } catch (upErr) {
      console.error('Cloudinary upload error:', upErr);
      throw new Error('Failed to upload to Cloudinary');
    }

    // Optionally delete previous Cloudinary asset if stored as a cloudinary url
    if (profile.avatar && profile.avatar.includes('res.cloudinary.com')) {
      try {
        // extract public_id from previous url if possible
        const prev = profile.avatar;
        const parts = prev.split('/');
        const idx = parts.findIndex(p => p === 'upload');
        if (idx > -1 && parts.length > idx + 1) {
          // everything after upload/ (may include transformations) -> get last segment as public id with extension
          const publicWithExt = parts.slice(idx + 1).join('/');
          const publicId = publicWithExt.replace(/\.[a-zA-Z0-9]+$/, '');
          await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
        }
      } catch (delErr) {
        console.error('Failed to delete previous cloudinary avatar:', delErr);
      }
    }

    profile.avatar = result.secure_url || '';
    await profile.save();

    res.json({ avatarUrl: profile.avatar, result });
  } catch (error) {
    if (req.file) {
      // nothing to unlink from disk since we're using memoryStorage
    }
    res.status(400).json({ error: error.message });
  }
});

// Delete avatar
router.delete('/avatar', auth, async (req, res) => {
  try {
    const profile = await Profile.findOne({ userId: req.user._id });
    if (!profile || !profile.avatar) {
      throw new Error('No avatar found');
    }

    // If stored in Cloudinary, try to remove it
    if (profile.avatar && profile.avatar.includes('res.cloudinary.com')) {
      try {
        const prev = profile.avatar;
        const parts = prev.split('/');
        const idx = parts.findIndex(p => p === 'upload');
        if (idx > -1 && parts.length > idx + 1) {
          const publicWithExt = parts.slice(idx + 1).join('/');
          const publicId = publicWithExt.replace(/\.[a-zA-Z0-9]+$/, '');
          await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
        }
      } catch (delErr) {
        console.error('Failed to delete cloudinary avatar:', delErr);
      }
    }

    profile.avatar = '';
    await profile.save();

    res.json({ message: 'Avatar deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete profile
router.delete('/', auth, async (req, res) => {
  try {
    const profile = await Profile.findOneAndDelete({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({ message: 'Profile deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;