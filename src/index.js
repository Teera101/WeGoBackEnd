import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import activityRoutes from './routes/activities.js';
import groupRoutes from './routes/groups.js';
import eventRoutes from './routes/events.js';
import chatRoutes from './routes/chats.js';
import adminRoutes from './routes/admin.js';
import directMessageRoutes from './routes/directmessages.js';
import uploadsRoutes from './routes/uploads.js';
import reportsRoutes from './routes/reports.js';
import Chat from './models/chat.js';
import User from './models/user.js';
import Profile from './models/profile.js';
import DirectMessage from './models/directmessage.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';

const io = new Server(httpServer, {
  cors: {
    origin: frontendOrigin,
    credentials: true,
    methods: ['GET', 'POST']
  }
});

const port = process.env.PORT || process.env.LOCAL_PORT || 10000;

app.use(cors({
  origin: frontendOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => console.error('MongoDB connection error:', error));

app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/directmessages', directMessageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/reports', reportsRoutes);

app.get('/_health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), commit: process.env.COMMIT_ID || null });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  socket.on('user:join', async (userId) => {
    try {
        if (socket.userId && socket.userId === userId) {
          return;
        }

        let sockets = activeUsers.get(userId);
        if (!sockets) sockets = new Set();
        sockets.add(socket.id);
        activeUsers.set(userId, sockets);
        socket.userId = userId;
        console.log(`👤 User ${userId} joined with socket ${socket.id}`);

      const currentSockets = activeUsers.get(userId);
      if (currentSockets && currentSockets.size === 1) {
        await User.findByIdAndUpdate(userId, {
          isOnline: true,
          lastActive: new Date()
        });
        io.emit('userStatusChanged', { userId, isOnline: true });
        console.log(`🟢 User ${userId} is now ONLINE`);
      }
    } catch (error) {
      console.error('Error handling user:join:', error);
    }
  });

  socket.on('chat:join', async (chatId) => {
    try {
      socket.join(`chat:${chatId}`);
      console.log(`💬 Socket ${socket.id} joined chat ${chatId}`);
      
      const chat = await Chat.findById(chatId).populate({
        path: 'participants.user',
        select: 'email username isOnline createdAt'
      });
      
      if (chat) {
        const userIds = chat.participants
          .filter(p => p.user)
          .map(p => p.user._id);

        const profiles = await Profile.find({ userId: { $in: userIds } });
        const profileMap = {};
        profiles.forEach(p => {
            if (p.userId) profileMap[p.userId.toString()] = p;
        });

        const parts = chat.participants
          .filter(p => p.user)
          .map(p => {
            const userProfile = profileMap[p.user._id.toString()];
            return {
              id: p.user._id,
              email: p.user.email,
              username: p.user.username,
              isOnline: !!p.user.isOnline,
              role: p.role,
              avatar: userProfile?.avatar || '',
              bio: userProfile?.bio || '',
              createdAt: p.user.createdAt
            };
          });
        socket.emit('chat:participants', { participants: parts });
      }
    } catch (err) {
      console.error('Error in chat:join handler:', err);
    }
  });

  socket.on('chat:getParticipants', async (chatId) => {
    try {
      const chat = await Chat.findById(chatId).populate({
        path: 'participants.user',
        select: 'email username isOnline createdAt'
      });
      
      if (chat) {
        const userIds = chat.participants
          .filter(p => p.user)
          .map(p => p.user._id);

        const profiles = await Profile.find({ userId: { $in: userIds } });
        const profileMap = {};
        profiles.forEach(p => {
            if (p.userId) profileMap[p.userId.toString()] = p;
        });

        const parts = chat.participants
          .filter(p => p.user)
          .map(p => {
            const userProfile = profileMap[p.user._id.toString()];
            return {
              id: p.user._id,
              email: p.user.email,
              username: p.user.username,
              isOnline: !!p.user.isOnline,
              role: p.role,
              avatar: userProfile?.avatar || '',
              bio: userProfile?.bio || '',
              createdAt: p.user.createdAt
            };
          });
        socket.emit('chat:participants', { participants: parts });
        io.to(`chat:${chatId}`).emit('chat:participants', { participants: parts });
      }
    } catch (err) {
      console.error('Error in chat:getParticipants handler:', err);
    }
  });

  socket.on('chat:leave', (chatId) => {
    socket.leave(`chat:${chatId}`);
    console.log(`🚪 Socket ${socket.id} left chat ${chatId}`);
  });

  socket.on('message:send', async (data) => {
    const { chatId, userId, sender, content, type = 'text', fileUrl } = data;
    let senderId = userId || sender;
    if (senderId && typeof senderId === 'object') {
      if (senderId._id) senderId = senderId._id.toString();
      else if (senderId.userId) senderId = senderId.userId.toString();
      else if (senderId.id) senderId = senderId.id.toString();
      else senderId = String(senderId);
    }
    
    try {
      const chat = await Chat.findById(chatId);
      if (!chat) {
        console.log(`❌ Chat ${chatId} not found`);
        socket.emit('error', { message: 'Chat not found' });
        return;
      }

      const isParticipant = chat.participants.some(p => 
        p.user.toString() === senderId || p.user.equals(senderId)
      );
      if (!isParticipant) {
        console.log(`❌ User ${senderId} is not a participant in chat ${chatId}`);
        socket.emit('error', { message: 'You are not a participant in this chat' });
        return;
      }

      await chat.addMessage(senderId, content.trim(), type, fileUrl);
      await chat.populate('messages.sender', 'email username');

      let newMessage = chat.messages[chat.messages.length - 1];

      try {
        const prof = await Profile.findOne({ userId: senderId });
        const nm = newMessage.toObject ? newMessage.toObject() : { ...newMessage };
        nm.sender = nm.sender || {};
        nm.sender.avatar = (prof && prof.avatar) ? prof.avatar : '';
        newMessage = nm;
      } catch (profErr) {
        console.error('Failed to attach profile avatar to message:', profErr);
      }

      socket.to(`chat:${chatId}`).emit('message:receive', newMessage);
      
      socket.emit('message:sent', newMessage);

      console.log(`📤 Message sent to chat ${chatId} by user ${senderId}`);
    } catch (err) {
      console.error('❌ Socket message:send error:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('typing:start', (data) => {
    const { chatId, userId, username } = data;
    socket.to(`chat:${chatId}`).emit('user:typing', { userId, username });
  });

  socket.on('typing:stop', (data) => {
    const { chatId, userId } = data;
    socket.to(`chat:${chatId}`).emit('user:stop_typing', { userId });
  });

  socket.on('message:read', (data) => {
    const { chatId, messageIds, userId } = data;
    socket.to(`chat:${chatId}`).emit('message:read_update', { messageIds, userId });
  });

  socket.on('activity:update', (data) => {
    const { activityId, type, message } = data;
    io.emit('activity:notification', { activityId, type, message });
  });

  socket.on('dm:send', async (data) => {
    const { from, to, text, at } = data;
    console.log(`💌 DM from ${from} to ${to}: ${text}`);
    
    try {
      const dm = new DirectMessage({
        from,
        to,
        text
      });
      await dm.save();
      
      await dm.populate([
        { path: 'from', select: 'username email' },
        { path: 'to', select: 'username email' }
      ]);

      const [fromProfile, toProfile] = await Promise.all([
        Profile.findOne({ userId: dm.from._id }),
        Profile.findOne({ userId: dm.to._id })
      ]);

      const enrichedMessage = {
        _id: dm._id,
        from: {
          _id: dm.from._id,
          username: dm.from.username,
          email: dm.from.email,
          avatar: fromProfile?.avatar || null
        },
        to: {
          _id: dm.to._id,
          username: dm.to.username,
          email: dm.to.email,
          avatar: toProfile?.avatar || null
        },
        text: dm.text,
        isRead: dm.isRead,
        createdAt: dm.createdAt,
        updatedAt: dm.updatedAt
      };
      
      const recipientSockets = activeUsers.get(to);
      if (recipientSockets && recipientSockets.size > 0) {
        recipientSockets.forEach((socketId) => {
          io.to(socketId).emit('dm:receive', enrichedMessage);
        });
        console.log(`✅ DM delivered to ${to} (${recipientSockets.size} sockets)`);
      } else {
        console.log(`⚠️ Recipient ${to} is offline, DM saved but not delivered`);
      }
      
      socket.emit('dm:sent', enrichedMessage);
    } catch (error) {
      console.error('❌ Error saving DM:', error);
      socket.emit('dm:error', { error: 'Failed to send message' });
    }
  });

  socket.on('disconnect', async () => {
    try {
      if (socket.userId) {
        const userId = socket.userId;
        const sockets = activeUsers.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            activeUsers.delete(userId);
            await User.findByIdAndUpdate(userId, {
              isOnline: false,
              lastActive: new Date()
            });
            io.emit('userStatusChanged', { userId, isOnline: false });
            console.log(`⚫ User ${userId} is now OFFLINE`);
          } else {
            activeUsers.set(userId, sockets);
            console.log(`🔌 Socket ${socket.id} disconnected for user ${userId}, still online on other sockets`);
          }
        }
      } else {
        console.log(`❌ Socket ${socket.id} disconnected`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

app.set('io', io);
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${port}`);
  console.log(`⚡ Socket.io is ready for connections`);
});