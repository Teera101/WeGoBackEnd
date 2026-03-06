import express from 'express';
import Chat from '../models/chat.js';
import DirectMessage from '../models/directmessage.js';
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

    for (const chat of userChats) {
      if (!chat.messages || !Array.isArray(chat.messages)) continue;

      const participant = chat.participants.find(p => p.user && p.user._id.toString() === userId);
      if (!participant) continue;

      let chatUnreadCount = 0;
      let lastUnreadMsg = null;

      for (const msg of chat.messages) {
        if (msg.isDeleted) continue;

        const senderStr = msg.sender && msg.sender._id ? msg.sender._id.toString() : (msg.sender ? msg.sender.toString() : '');
        if (senderStr === userId) continue;

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

      if (chatUnreadCount > 0 && lastUnreadMsg) {
        unreadChatIds.add(chat._id.toString());
        
        let chatName = 'แชทกลุ่ม';
        if (chat.type === 'group' && chat.groupInfo && chat.groupInfo.name) {
          chatName = chat.groupInfo.name;
        } else if (chat.type === 'direct') {
          const otherUser = chat.participants.find(p => p.user && p.user._id.toString() !== userId);
          if (otherUser && otherUser.user && otherUser.user.username) {
            chatName = otherUser.user.username;
          } else {
            chatName = 'แชทส่วนตัว';
          }
        }

        let messagePreview = lastUnreadMsg.content;
        if (lastUnreadMsg.type === 'image') messagePreview = '[รูปภาพ]';
        else if (lastUnreadMsg.type === 'file') messagePreview = '[ไฟล์]';
        else if (lastUnreadMsg.type === 'system') messagePreview = '[ข้อความระบบ]';

        detailsMap.set(chat._id.toString(), {
          chatId: chat._id.toString(),
          name: chatName,
          senderName: lastUnreadMsg.sender && lastUnreadMsg.sender.username ? lastUnreadMsg.sender.username : 'สมาชิก',
          lastMessage: messagePreview,
          time: lastUnreadMsg.createdAt || new Date(),
          count: chatUnreadCount,
          type: chat.type
        });
      }
    }

    for (const dm of unreadDMsRaw) {
      if (!dm.from || !dm.from._id) continue;
      
      totalUnreadCount++;
      const senderId = dm.from._id.toString();
      
      if (!detailsMap.has(senderId)) {
        detailsMap.set(senderId, {
          chatId: senderId,
          name: dm.from.username || 'ผู้ใช้',
          senderName: dm.from.username || 'ผู้ใช้',
          lastMessage: dm.text,
          time: dm.createdAt || new Date(),
          count: 0,
          type: 'direct_msg'
        });
      }
      
      const currentDm = detailsMap.get(senderId);
      currentDm.count++;
      
      if (new Date(dm.createdAt).getTime() > new Date(currentDm.time).getTime()) {
         currentDm.lastMessage = dm.text;
         currentDm.time = dm.createdAt;
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
    const userId = req.user._id;

    await DirectMessage.updateMany(
      { to: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    const chats = await Chat.find({ 'participants.user': userId });
    for (const chat of chats) {
      const participant = chat.participants.find(p => p.user && p.user.equals(userId));
      if (participant) {
        participant.lastRead = new Date();
      }
      chat.messages.forEach(msg => {
        if (msg.readBy && !msg.readBy.some(r => r.user && r.user.equals(userId))) {
          msg.readBy.push({ user: userId, readAt: new Date() });
        }
      });
      chat.markModified('participants');
      chat.markModified('messages');
      await chat.save();
    }

    res.json({ message: 'All chats marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/read-dm/:senderId', auth, async (req, res) => {
  try {
    await DirectMessage.updateMany(
      { to: req.user._id, from: req.params.senderId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ message: 'DM marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;