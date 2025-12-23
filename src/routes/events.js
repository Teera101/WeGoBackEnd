import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import Activity from '../models/activity.js';
import Chat from '../models/chat.js';
import Group from '../models/group.js';
import Review from '../models/review.js';
import auth from '../middleware/auth.js';
import { uploadBuffer } from '../lib/cloudinary.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPEG, PNG, WebP)'));
    }
  }
});

router.post('/upload-cover', auth, upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const buffer = req.file.buffer;
    try {
      const pub = `events/cover-${Date.now()}-${Math.round(Math.random()*1e6)}`;
      const uploaded = await uploadBuffer(buffer, { public_id: pub, folder: 'wego/events', resource_type: 'image' });
      return res.json({ url: uploaded.secure_url, public_id: uploaded.public_id });
    } catch (upErr) {
      console.error('Cloudinary upload error for cover:', upErr);
      return res.status(500).json({ error: 'Failed to upload cover image' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 1. Endpoint ดึงข้อมูลกลุ่มจาก Chat ID
router.get('/by-chat/:chatId', async (req, res) => {
  try {
    const event = await Activity.findOne({ chat: req.params.chatId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found for this chat' });
    }
    const group = await Group.findOne({ relatedActivity: event._id.toString() })
      .populate('members.userId', 'name avatar email');
    res.json({ event, group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ 2. Endpoint สร้าง/แก้ไข รีวิว (Upsert)
router.post('/reviews', auth, async (req, res) => {
  try {
    const { groupId, rating, comment } = req.body;
    const userId = req.user._id;

    // ใช้ findOneAndUpdate เพื่อแก้ปัญหา Duplicate Key Error
    const review = await Review.findOneAndUpdate(
      { groupId: groupId, userId: userId }, // ค้นหารีวิวเดิม
      { 
        rating, 
        comment,
        updatedAt: new Date() 
      }, 
      { 
        new: true, // คืนค่าใหม่
        upsert: true, // ถ้าไม่มีให้สร้างใหม่
        setDefaultsOnInsert: true 
      }
    );

    res.json(review);
  } catch (error) {
    console.error("Review Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ 3. Endpoint ดึงรีวิวของกลุ่ม
router.get('/reviews/:groupId', async (req, res) => {
  try {
    const reviews = await Review.find({ groupId: req.params.groupId })
      .populate('userId', 'name avatar email')
      .sort({ updatedAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ... (ส่วน Code เดิมด้านล่างคงไว้เหมือนเดิม) ...
router.get('/', async (req, res) => {
  try {
    const events = await Activity.find()
      .populate('createdBy', 'email')
      .sort({ date: 1 })
      .limit(50);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const event = await Activity.findById(req.params.id)
      .populate('createdBy', 'email')
      .populate('participants.user', 'email');
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(event);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const eventData = {
      ...req.body,
      createdBy: userId,
      participants: [{ user: userId, joinedAt: new Date() }]
    };
    if (req.body.location) {
      if (typeof req.body.location === 'string') {
        eventData.location = { address: req.body.location, coordinates: { type: 'Point', coordinates: [0, 0] } };
      } else if (typeof req.body.location === 'object' && !req.body.location.address) {
        eventData.location = { address: req.body.location.address || '', coordinates: req.body.location.coordinates || { type: 'Point', coordinates: [0, 0] } };
      }
    }
    const event = new Activity(eventData);
    await event.save();
    const chat = new Chat({ type: 'group', name: event.title, participants: [{ user: userId, role: 'admin', joinedAt: new Date() }], createdBy: userId });
    await chat.save();
    const newGroup = new Group({ name: event.title, description: event.description || `Group for event: ${event.title}`, maxMembers: event.maxParticipants || 100, cover: event.cover || '', createdBy: userId, relatedActivity: event._id.toString(), members: [{ userId: userId, role: 'owner', joinedAt: new Date() }], bannedUsers: [] });
    await newGroup.save();
    event.chat = chat._id;
    await event.save();
    await event.populate('createdBy', 'email');
    res.status(201).json(event);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const event = await Activity.findOne({ _id: req.params.id, createdBy: req.user._id });
    if (!event) return res.status(404).json({ error: 'Event not found or access denied' });
    Object.assign(event, req.body);
    await event.save();
    res.json(event);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const event = await Activity.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id });
    if (!event) return res.status(404).json({ error: 'Event not found or access denied' });
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/join', auth, async (req, res) => {
  try {
    const event = await Activity.findById(req.params.id);
    const userId = req.user._id;
    if (!event) return res.status(404).json({ error: 'Event not found' });
    await event.addParticipant(userId);
    let chat = await Chat.findById(event.chat);
    if (!chat) {
      chat = new Chat({ type: 'group', name: event.title, participants: [{ user: event.createdBy, role: 'admin', joinedAt: new Date() }, { user: userId, role: 'member', joinedAt: new Date() }], createdBy: event.createdBy });
      await chat.save();
      event.chat = chat._id;
      await event.save();
    } else {
      const alreadyInChat = chat.participants.some(p => p.user && p.user.equals(userId));
      if (!alreadyInChat) {
        chat.participants.push({ user: userId, role: 'member', joinedAt: new Date() });
        await chat.save();
      }
    }
    const group = await Group.findOne({ relatedActivity: event._id.toString() });
    if (group) {
        const alreadyInGroup = group.members.some(m => m.userId.toString() === userId.toString());
        if (!alreadyInGroup) {
            group.members.push({ userId: userId, role: 'member', joinedAt: new Date() });
            await group.save();
        }
    }
    try {
      const io = req.app.get('io');
      if (io && chat) {
        await chat.populate({ path: 'participants.user', select: 'email username isOnline createdAt', populate: { path: 'profile', select: 'avatar bio' } });
        const parts = chat.participants.filter(p => p.user).map(p => ({ id: p.user._id, email: p.user.email, username: p.user.username, role: p.role, isOnline: !!p.user.isOnline, avatar: p.user.profile?.avatar || '', bio: p.user.profile?.bio || '', createdAt: p.user.createdAt }));
        io.to(`chat:${chat._id}`).emit('chat:participants', { participants: parts });
      }
    } catch (emitErr) { console.error(emitErr); }
    res.json({ message: 'Successfully joined event', activity: event, chatId: chat._id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/:id/leave', auth, async (req, res) => {
  try {
    const event = await Activity.findById(req.params.id);
    const userId = req.user._id;
    if (!event) return res.status(404).json({ error: 'Event not found' });
    await event.removeParticipant(userId);
    try {
      if (event.chat) {
        const chat = await Chat.findById(event.chat);
        if (chat) {
          chat.participants = chat.participants.filter(p => !(p.user && p.user.toString() === userId.toString()));
          await chat.save();
          const io = req.app.get('io');
          if (io) {
            await chat.populate({ path: 'participants.user', select: 'email username isOnline createdAt', populate: { path: 'profile', select: 'avatar bio' } });
            const parts = chat.participants.filter(p => p.user).map(p => ({ id: p.user._id, email: p.user.email, username: p.user.username, role: p.role, isOnline: !!p.user.isOnline, avatar: p.user.profile?.avatar || '', bio: p.user.profile?.bio || '', createdAt: p.user.createdAt }));
            io.to(`chat:${chat._id}`).emit('chat:participants', { participants: parts });
          }
        }
      }
    } catch (emitErr) {}
    const group = await Group.findOne({ relatedActivity: event._id.toString() });
    if (group) {
        group.members = group.members.filter(m => m.userId.toString() !== userId.toString());
        await group.save();
    }
    res.json({ message: 'Successfully left event', activity: event });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/search/filter', async (req, res) => {
  try {
    const { tags } = req.query;
    const filters = { status: 'published', visibility: 'public' };
    if (tags) filters.tags = { $in: tags.split(',') };
    const events = await Activity.find(filters).populate('createdBy', 'email').sort({ date: 1 }).limit(50);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;