import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import Activity from '../models/activity.js';
import Chat from '../models/chat.js';
import Group from '../models/group.js';
import Review from '../models/review.js';
import Notification from '../models/notification.js';
import Profile from '../models/profile.js';
import User from '../models/user.js';
import auth from '../middleware/auth.js';
import { uploadBuffer } from '../lib/cloudinary.js';
import nodemailer from 'nodemailer';

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

const sendNotificationEmail = async (toEmail, subject, htmlContent) => {
  try {
    const host = process.env.EMAIL_HOST;
    const port = parseInt(process.env.EMAIL_PORT || '587');
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASSWORD;
    const sender = process.env.EMAIL_FROM || user;

    if (!user || !pass) return;

    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: `"WeGo Notification" <${sender}>`,
      to: toEmail,
      subject: subject,
      html: htmlContent
    });
  } catch (err) {
  }
};

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
      return res.status(500).json({ error: 'Failed to upload cover image' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/by-chat/:chatId', async (req, res) => {
  try {
    const event = await Activity.findOne({ chat: req.params.chatId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found for this chat' });
    }
    const group = await Group.findOne({ relatedActivity: event._id.toString() })
      .populate('members.userId', 'username name avatar email');
    res.json({ event, group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/reviews', auth, async (req, res) => {
  try {
    const { groupId, rating, comment } = req.body;
    const userId = req.user._id;

    const review = await Review.findOneAndUpdate(
      { groupId: groupId, userId: userId },
      { 
        rating, 
        comment,
        updatedAt: new Date() 
      }, 
      { 
        new: true,
        upsert: true,
        setDefaultsOnInsert: true 
      }
    );

    res.json(review);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/reviews/:groupId', async (req, res) => {
  try {
    const reviews = await Review.find({ groupId: req.params.groupId })
      .populate('userId', 'username name avatar email') 
      .sort({ updatedAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/matchmaking', auth, async (req, res) => {
  try {
    const profile = await Profile.findOne({ userId: req.user._id });
    const userTags = profile && profile.tags ? profile.tags : [];
    const userId = req.user._id;

    if (userTags.length === 0) {
      return res.json([]);
    }

    const matchedEvents = await Activity.aggregate([
      {
        $match: {
          'participants.user': { $ne: userId }
        }
      },
      {
        $addFields: {
          matchScore: {
            $size: {
              $setIntersection: [
                { $ifNull: ["$tags", []] },
                userTags
              ]
            }
          }
        }
      },
      {
        $match: {
          matchScore: { $gt: 0 }
        }
      },
      {
        $sort: {
          matchScore: -1,
          date: 1
        }
      },
      {
        $limit: 10
      }
    ]);

    const populatedEvents = await Activity.populate(matchedEvents, { path: 'createdBy', select: 'email' });

    res.json(populatedEvents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search/filter', async (req, res) => {
  try {
    const { tags } = req.query;
    const filters = {};
    if (tags) filters.tags = { $in: tags.split(',') };
    const events = await Activity.find(filters).populate('createdBy', 'email').sort({ date: 1 }).limit(50);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
      let locData = req.body.location;
      if (typeof locData === 'string') {
        try { locData = JSON.parse(locData); } catch (e) { locData = { address: locData }; }
      }
      
      eventData.location = { 
        address: locData.address || '', 
        details: locData.details || '',
        coordinates: { 
          type: 'Point', 
          coordinates: (Array.isArray(locData.coordinates) && locData.coordinates.length === 2) ? locData.coordinates : [0, 0] 
        } 
      };
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

    const io = req.app.get('io');
    if (io) {
      io.emit('activity:create', event);
    }

    try {
      if (event.tags && event.tags.length > 0) {
        const matchedProfiles = await Profile.find({
          userId: { $ne: userId },
          tags: { $in: event.tags }
        });

        for (const profile of matchedProfiles) {
          const notification = new Notification({
            recipient: profile.userId,
            sender: userId,
            type: 'recommendation',
            title: '✨ กิจกรรมใหม่ที่ตรงใจคุณ!',
            message: `กิจกรรม "${event.title}" เพิ่งเปิดรับสมัครและมีแท็กตรงกับความสนใจของคุณ`,
            relatedId: event._id
          });
          await notification.save();

          if (io) {
            io.to(profile.userId.toString()).emit('notification:new', notification);
          }

          const targetUser = await User.findById(profile.userId);
          if (targetUser && targetUser.email) {
            const emailHtml = `
              <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 12px; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #d97706; text-align: center;">✨ กิจกรรมใหม่ที่ตรงใจคุณ!</h2>
                <div style="background: white; padding: 24px; border-radius: 8px; margin-top: 20px;">
                  <p style="color: #334155; font-size: 16px;">สวัสดีครับ,</p>
                  <p style="color: #334155; font-size: 16px;">มีกิจกรรมใหม่ชื่อ <strong>"${event.title}"</strong> เพิ่งเปิดรับสมัครบน WeGo และมีแท็กตรงกับความสนใจของคุณพอดีเลย!</p>
                  <p style="color: #334155; font-size: 16px;">รีบเข้าไปดูก่อนที่ที่นั่งจะเต็มนะครับ 🚀</p>
                </div>
              </div>
            `;
            await sendNotificationEmail(targetUser.email, `WeGo - แนะนำกิจกรรมใหม่: ${event.title}`, emailHtml);
          }
        }
      }
    } catch (notiErr) {
    }

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

    const io = req.app.get('io');
    if (io) {
      io.emit('activity:update', event);
    }

    res.json(event);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const event = await Activity.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id });
    if (!event) return res.status(404).json({ error: 'Event not found or access denied' });

    const io = req.app.get('io');
    if (io) {
      io.emit('activity:delete', { _id: req.params.id });
    }

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
      if (io) {
        io.emit('participant:update', { activityId: event._id });
        if (chat) {
          await chat.populate({ path: 'participants.user', select: 'email username isOnline createdAt', populate: { path: 'profile', select: 'avatar bio' } });
          const parts = chat.participants.filter(p => p.user).map(p => ({ id: p.user._id, email: p.user.email, username: p.user.username, role: p.role, isOnline: !!p.user.isOnline, avatar: p.user.profile?.avatar || '', bio: p.user.profile?.bio || '', createdAt: p.user.createdAt }));
          io.to(`chat:${chat._id}`).emit('chat:participants', { participants: parts });
        }
      }
    } catch (emitErr) {}

    if (event.createdBy.toString() !== userId.toString()) {
      const notification = new Notification({
        recipient: event.createdBy,
        sender: userId,
        type: 'activity_join',
        title: 'มีผู้เข้าร่วมกิจกรรมใหม่',
        message: `ได้เข้าร่วมกิจกรรม "${event.title}" ของคุณ`,
        relatedId: event._id
      });
      await notification.save();
      
      const io = req.app.get('io');
      if (io) {
        io.to(event.createdBy.toString()).emit('notification:new', notification);
      }

      const creatorUser = await User.findById(event.createdBy);
      if (creatorUser && creatorUser.email) {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 12px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb; text-align: center;">🎉 มีผู้เข้าร่วมกิจกรรมใหม่!</h2>
            <div style="background: white; padding: 24px; border-radius: 8px; margin-top: 20px;">
              <p style="color: #334155; font-size: 16px;">สวัสดีครับ,</p>
              <p style="color: #334155; font-size: 16px;">มีผู้ใช้งานเพิ่งกดเข้าร่วมกิจกรรม <strong>"${event.title}"</strong> ของคุณ</p>
              <p style="color: #334155; font-size: 16px;">เข้าไปเช็ครายละเอียดและทักทายสมาชิกใหม่ได้ที่ระบบ WeGo เลยครับ!</p>
            </div>
          </div>
        `;
        await sendNotificationEmail(creatorUser.email, `WeGo - แจ้งเตือน: มีผู้เข้าร่วมกิจกรรม "${event.title}"`, emailHtml);
      }
    }

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
      const io = req.app.get('io');
      if (io) {
        io.emit('participant:update', { activityId: event._id });
      }

      if (event.chat) {
        const chat = await Chat.findById(event.chat);
        if (chat) {
          chat.participants = chat.participants.filter(p => !(p.user && p.user.toString() === userId.toString()));
          await chat.save();
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

export default router;