import express from 'express';
import DirectMessage from '../models/directmessage.js';
import User from '../models/user.js';
import Profile from '../models/profile.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Get conversation with a specific user
router.get('/conversation/:userId', auth, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const otherUserId = req.params.userId;

    const messages = await DirectMessage.getConversation(currentUserId, otherUserId);

    // Enrich with profile avatars
    const enrichedMessages = await Promise.all(
      messages.map(async (msg) => {
        const msgObj = msg.toObject();
        try {
          const fromProfile = await Profile.findOne({ userId: msg.from._id });
          const toProfile = await Profile.findOne({ userId: msg.to._id });
          
          msgObj.from.avatar = fromProfile?.avatar || '';
          msgObj.to.avatar = toProfile?.avatar || '';
        } catch (err) {
          console.error('Error fetching profiles:', err);
        }
        return msgObj;
      })
    );

    res.json(enrichedMessages);
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// Send a direct message
router.post('/send', auth, async (req, res) => {
  try {
    const { to, text } = req.body;
    const from = req.user._id;

    if (!to || !text?.trim()) {
      return res.status(400).json({ error: 'Recipient and message text are required' });
    }

    // Check if recipient exists
    const recipient = await User.findById(to);
    if (!recipient) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const message = new DirectMessage({
      from,
      to,
      text: text.trim()
    });

    await message.save();
    await message.populate('from', 'email username');
    await message.populate('to', 'email username');

    // Enrich with profiles
    const messageObj = message.toObject();
    try {
      const fromProfile = await Profile.findOne({ userId: from });
      const toProfile = await Profile.findOne({ userId: to });
      
      messageObj.from.avatar = fromProfile?.avatar || '';
      messageObj.to.avatar = toProfile?.avatar || '';
    } catch (err) {
      console.error('Error fetching profiles:', err);
    }

    res.status(201).json(messageObj);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Mark messages as read
router.put('/read/:senderId', auth, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const senderId = req.params.senderId;

    const result = await DirectMessage.markAsRead(currentUserId, senderId);

    res.json({ 
      success: true, 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Get unread count
router.get('/unread/count', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const count = await DirectMessage.getUnreadCount(userId);

    res.json({ unreadCount: count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Get recent conversations
router.get('/recent', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get all messages where user is either sender or receiver
    const messages = await DirectMessage.find({
      $or: [{ from: userId }, { to: userId }],
      isDeleted: false
    })
      .populate('from', 'email username')
      .populate('to', 'email username')
      .sort({ createdAt: -1 })
      .limit(100);

    // Group by conversation partner
    const conversations = new Map();
    
    for (const msg of messages) {
      const partnerId = msg.from._id.toString() === userId ? msg.to._id.toString() : msg.from._id.toString();
      
      if (!conversations.has(partnerId)) {
        const partner = msg.from._id.toString() === userId ? msg.to : msg.from;
        const partnerProfile = await Profile.findOne({ userId: partnerId });
        
        conversations.set(partnerId, {
          user: {
            _id: partner._id,
            email: partner.email,
            username: partner.username,
            avatar: partnerProfile?.avatar || ''
          },
          lastMessage: msg,
          unreadCount: await DirectMessage.countDocuments({
            from: partnerId,
            to: userId,
            isRead: false,
            isDeleted: false
          })
        });
      }
    }

    const conversationsList = Array.from(conversations.values());
    res.json(conversationsList);
  } catch (error) {
    console.error('Error fetching recent conversations:', error);
    res.status(500).json({ error: 'Failed to fetch recent conversations' });
  }
});

// Delete a message
router.delete('/:messageId', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const messageId = req.params.messageId;

    const message = await DirectMessage.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Only sender can delete
    if (message.from.toString() !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete this message' });
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;
