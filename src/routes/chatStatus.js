import express from 'express';
import Chat from '../models/chat.js';
import DirectMessage from '../models/directmessage.js';
import Profile from '../models/profile.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.get('/unread', auth, async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.json({ totalUnread: 0, unreadChatIds: [], details: [] });
    }

    const userId = req.user._id.toString();

    const unreadDMsRaw = await DirectMessage.find({
      to: req.user._id,
      isRead: false,
      isDeleted: false
    }).populate('from', 'username');

    const userChats = await Chat.find({
      'participants.user': req.user._id,
      isActive: true
    })
    .populate('messages.sender', 'username')
    .populate('participants.user', 'username');

    let totalUnreadCount = 0;
    const unreadChatIds = new Set();
    const detailsMap = new Map();

    const allUserIds = new Set();
    userChats.forEach(chat => {
      chat.participants.forEach(p => { if (p.user) allUserIds.add(p.user._id.toString()); });
      chat.messages.forEach(m => { if (m.sender) allUserIds.add(m.sender._id?.toString() || m.sender.toString()); });
    });
    unreadDMsRaw.forEach(dm => { if (dm.from) allUserIds.add(dm.from._id.toString()); });

    const profiles = await Profile.find({ userId: { $in: Array.from(allUserIds) } });
    const profileMap = {};
    profiles.forEach(p => { if (p.userId) profileMap[p.userId.toString()] = p.avatar || ''; });

    for (const chat of userChats) {
      if (!chat.messages || !Array.isArray(chat.messages)) continue;

      const participant = chat.participants.find(p => p.user && p.user._id.toString() === userId);
      if (!participant) continue;

      const lastReadTime = participant.lastRead ? new Date(participant.lastRead).getTime() : 0;
      let chatUnreadCount = 0;
      let lastUnreadMsg = null;

      for (const msg of chat.messages) {
        if (msg.isDeleted) continue;
        const senderStr = msg.sender && msg.sender._id ? msg.sender._id.toString() : (msg.sender ? msg.sender.toString() : '');
        if (senderStr === userId) continue;

        const msgTime = new Date(msg.createdAt).getTime();
        if (msgTime > lastReadTime) {
          let isReadByMe = false;
          if (msg.readBy && Array.isArray(msg.readBy)) {
            isReadByMe = msg.readBy.some(r => r.user && r.user.toString() === userId);
          }
          if (!isReadByMe) {
            chatUnreadCount++;
            totalUnreadCount++;
            lastUnreadMsg = msg;
          }
        }
      }

      if (chatUnreadCount > 0 && lastUnreadMsg) {
        unreadChatIds.add(chat._id.toString());
        
        let chatName = 'แชทกลุ่ม';
        let chatAvatar = '';
        let targetUid = chat._id.toString();

        if (chat.type === 'group') {
          chatName = chat.groupInfo?.name || 'แชทกลุ่ม';
          chatAvatar = chat.groupInfo?.avatar || '';
        } else if (chat.type === 'direct') {
          const otherP = chat.participants.find(p => p.user && p.user._id.toString() !== userId);
          if (otherP && otherP.user) {
            chatName = otherP.user.username || 'แชทส่วนตัว';
            chatAvatar = profileMap[otherP.user._id.toString()] || '';
            targetUid = otherP.user._id.toString();
          }
        }

        const senderIdStr = lastUnreadMsg.sender?._id?.toString() || lastUnreadMsg.sender?.toString();
        const senderAvatar = profileMap[senderIdStr] || '';

        let preview = lastUnreadMsg.content;
        if (lastUnreadMsg.type === 'image') preview = '[ส่งรูปภาพ]';
        else if (lastUnreadMsg.type === 'file') preview = '[ส่งไฟล์]';
        else if (lastUnreadMsg.type === 'system') preview = '[ข้อความระบบ]';

        detailsMap.set(chat._id.toString(), {
          chatId: chat._id.toString(),
          targetUid,
          name: chatName,
          senderName: lastUnreadMsg.sender?.username || 'สมาชิก',
          senderAvatar,
          chatAvatar,
          lastMessage: preview,
          time: lastUnreadMsg.createdAt || new Date(),
          count: chatUnreadCount,
          type: chat.type
        });
      }
    }

    for (const dm of unreadDMsRaw) {
      if (!dm.from) continue;
      totalUnreadCount++;
      const senderId = dm.from._id.toString();
      const senderAvatar = profileMap[senderId] || '';
      
      if (!detailsMap.has(senderId)) {
        detailsMap.set(senderId, {
          chatId: senderId,
          targetUid: senderId,
          name: dm.from.username || 'ผู้ใช้',
          senderName: dm.from.username || 'ผู้ใช้',
          senderAvatar: senderAvatar,
          chatAvatar: senderAvatar,
          lastMessage: dm.text,
          time: dm.createdAt || new Date(),
          count: 0,
          type: 'direct_msg'
        });
      }
      
      const entry = detailsMap.get(senderId);
      entry.count++;
      if (new Date(dm.createdAt).getTime() > new Date(entry.time).getTime()) {
        entry.lastMessage = dm.text;
        entry.time = dm.createdAt;
      }
    }

    const detailsArray = Array.from(detailsMap.values()).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    res.json({
      totalUnread: totalUnreadCount,
      unreadChatIds: Array.from(unreadChatIds),
      details: detailsArray
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/read-all', auth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    await DirectMessage.updateMany({ to: req.user._id, isRead: false }, { $set: { isRead: true, readAt: new Date() } });
    
    const chats = await Chat.find({ 'participants.user': req.user._id });
    for (const chat of chats) {
      const p = chat.participants.find(part => part.user && part.user.toString() === userId);
      if (p) p.lastRead = new Date();
      
      chat.messages.forEach(msg => {
        if (!msg.readBy) msg.readBy = [];
        if (!msg.readBy.some(r => r.user && r.user.toString() === userId)) {
          msg.readBy.push({ user: req.user._id, readAt: new Date() });
        }
      });
      chat.markModified('participants');
      chat.markModified('messages');
      await chat.save();
    }
    res.json({ message: 'Success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/read-dm/:targetId', auth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const targetId = req.params.targetId;

    await DirectMessage.updateMany(
      { to: req.user._id, from: targetId, isRead: false }, 
      { $set: { isRead: true, readAt: new Date() } }
    );

    const chats = await Chat.find({
      type: 'direct',
      'participants.user': { $all: [req.user._id, targetId] }
    });

    for (const chat of chats) {
      const p = chat.participants.find(part => part.user && part.user.toString() === userId);
      if (p) p.lastRead = new Date();
      
      chat.messages.forEach(msg => {
        if (!msg.readBy) msg.readBy = [];
        if (!msg.readBy.some(r => r.user && r.user.toString() === userId)) {
          msg.readBy.push({ user: req.user._id, readAt: new Date() });
        }
      });
      chat.markModified('participants');
      chat.markModified('messages');
      await chat.save();
    }
    res.json({ message: 'Success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/read-chat/:chatId', auth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const chat = await Chat.findById(req.params.chatId);
    
    if (chat) {
      const p = chat.participants.find(part => part.user && part.user.toString() === userId);
      if (p) p.lastRead = new Date();
      
      chat.messages.forEach(msg => {
        if (!msg.readBy) msg.readBy = [];
        if (!msg.readBy.some(r => r.user && r.user.toString() === userId)) {
          msg.readBy.push({ user: req.user._id, readAt: new Date() });
        }
      });
      chat.markModified('participants');
      chat.markModified('messages');
      await chat.save();
    }
    res.json({ message: 'Success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;