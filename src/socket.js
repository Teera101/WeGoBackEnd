import { Server } from 'socket.io';
import Chat from './models/chat.js';
import User from './models/user.js';
import Profile from './models/profile.js';
import DirectMessage from './models/directmessage.js';

let io;
const activeUsers = new Map();

export const initSocket = (server) => {
  const allowedOrigins = [
    'http://localhost:5173',
    'https://we-go-front-end.vercel.app',
    process.env.FRONTEND_URL 
  ].filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('user:join', async (userId) => {
      try {
        if (socket.userId && socket.userId === userId) return;

        let sockets = activeUsers.get(userId);
        if (!sockets) sockets = new Set();
        sockets.add(socket.id);
        activeUsers.set(userId, sockets);
        socket.userId = userId;

        const currentSockets = activeUsers.get(userId);
        if (currentSockets && currentSockets.size === 1) {
          await User.findByIdAndUpdate(userId, {
            isOnline: true,
            lastActive: new Date()
          });
          io.emit('userStatusChanged', { userId, isOnline: true });
        }
      } catch (error) {
        console.error(error);
      }
    });

    socket.on('chat:join', async (chatId) => {
      try {
        socket.join(`chat:${chatId}`);
        
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
        console.error(err);
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
        console.error(err);
      }
    });

    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat:${chatId}`);
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
          socket.emit('error', { message: 'Chat not found' });
          return;
        }

        const isParticipant = chat.participants.some(p => 
          p.user.toString() === senderId || p.user.equals(senderId)
        );
        if (!isParticipant) {
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
          console.error(profErr);
        }

        socket.to(`chat:${chatId}`).emit('message:receive', newMessage);
        socket.emit('message:sent', newMessage);
      } catch (err) {
        console.error(err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('chat:typing', (data) => {
      const { chatId, userId, username } = data;
      socket.to(`chat:${chatId}`).emit('chat:typing', { userId, username });
    });

    socket.on('chat:stopTyping', (data) => {
      const { chatId, userId } = data;
      socket.to(`chat:${chatId}`).emit('chat:stopTyping', { userId });
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
      const { from, to, text } = data;
      
      try {
        const dm = new DirectMessage({ from, to, text });
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
        }
        
        socket.emit('dm:sent', enrichedMessage);
      } catch (error) {
        console.error(error);
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
            } else {
              activeUsers.set(userId, sockets);
            }
          }
        }
      } catch (error) {
        console.error(error);
      }
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};