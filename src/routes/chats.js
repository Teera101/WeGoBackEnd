import express from 'express';
import Chat from '../models/chat.js';
import User from '../models/user.js';
import Activity from '../models/activity.js';
import Profile from '../models/profile.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth);

router.post('/direct', async (req, res) => {
  try {
    const { recipientId } = req.body;
    const currentUserId = req.user._id;

    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({ message: 'Recipient user not found' });
    }

    if (currentUserId.equals(recipientId)) {
      return res.status(400).json({ message: 'Cannot create chat with yourself' });
    }

    const chat = await Chat.createDirectChat(currentUserId, recipientId);
    
    await chat.populate({
      path: 'participants.user',
      select: 'email username isOnline createdAt',
      populate: { path: 'profile', select: 'avatar bio' }
    });

    res.status(200).json({
      message: 'Direct chat created/retrieved successfully',
      chat
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/group', async (req, res) => {
  try {
    const { name, description, participantIds = [], relatedActivityId } = req.body;
    const currentUserId = req.user._id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: 'Group name is required' });
    }

    const participants = [
      { user: currentUserId, role: 'owner' } 
    ];

    for (const userId of participantIds) {
      if (!userId.equals || !currentUserId.equals(userId)) {
        const user = await User.findById(userId);
        if (user) {
          participants.push({ user: userId, role: 'member' });
        }
      }
    }

    let relatedActivity = null;
    if (relatedActivityId) {
      relatedActivity = await Activity.findById(relatedActivityId);
      if (!relatedActivity) {
        return res.status(404).json({ message: 'Related activity not found' });
      }
    }

    const groupInfo = {
      name: name.trim(),
      description: description?.trim() || '',
      relatedActivity: relatedActivityId || null
    };

    const chat = await Chat.createGroupChat({
      participants,
      groupInfo,
      createdBy: currentUserId
    });

    if (relatedActivity) {
      relatedActivity.chat = chat._id;
      await relatedActivity.save();
    }

    await chat.populate({
      path: 'participants.user',
      select: 'email username isOnline createdAt',
      populate: { path: 'profile', select: 'avatar bio' }
    });
    await chat.populate('groupInfo.relatedActivity', 'title category');

    res.status(201).json({
      message: 'Group chat created successfully',
      chat
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const { type, limit = 20, page = 1 } = req.query;

    const query = {
      'participants.user': currentUserId,
      isActive: true
    };

    if (type && ['direct', 'group'].includes(type)) {
      query.type = type;
    }

    const total = await Chat.countDocuments(query);

    const chats = await Chat.find(query)
      .populate({
        path: 'participants.user',
        select: 'email username isOnline createdAt',
        populate: { path: 'profile', select: 'avatar bio' }
      })
      .populate('groupInfo.relatedActivity', 'title category')
      .sort({ lastMessageAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const chatsWithInfo = chats.map(chat => {
      if (chat.participants) {
        chat.participants = chat.participants.filter(p => p.user);
      }

      const chatObj = chat.toObject();
      chatObj.unreadCount = chat.getUnreadCount(currentUserId);
      
      if (chat.messages && chat.messages.length > 0) {
        const lastMsg = chat.messages[chat.messages.length - 1];
        chatObj.lastMessagePreview = {
          content: lastMsg.isDeleted ? '[Message deleted]' : lastMsg.content,
          type: lastMsg.type,
          sender: lastMsg.sender || { username: 'Deleted User' },
          createdAt: lastMsg.createdAt
        };
      } else {
        chatObj.lastMessagePreview = null;
      }

      return chatObj;
    });

    res.status(200).json({
      chats: chatsWithInfo,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
        hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user._id;
    const { limit = 50, page = 1 } = req.query;

    const chat = await Chat.findById(id)
      .populate('participants.user', 'email username isOnline')
      .populate('messages.sender', 'email username isOnline')
      .populate('groupInfo.relatedActivity', 'title category location');

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const originalCount = chat.participants.length;
    chat.participants = chat.participants.filter(p => p.user != null);
    
    let needsSave = false;
    if (chat.participants.length !== originalCount) {
        needsSave = true;
    }

    if (chat.type === 'group' && chat.participants.length > 0) {
        const ownerExists = chat.participants.some(p => p.role === 'owner');
        if (!ownerExists) {
            const newOwner = chat.participants.find(p => p.role === 'admin') || chat.participants[0];
            if (newOwner) {
                newOwner.role = 'owner';
                needsSave = true;
                chat.messages.push({
                    sender: currentUserId,
                    content: `System: Ownership transferred to ${newOwner.user.username || 'new owner'} automatically.`,
                    type: 'system',
                    createdAt: new Date()
                });
            }
        }
    }

    if (needsSave) {
        await chat.save();
    }

    const relatedActivity = chat.groupInfo?.relatedActivity;
    if (relatedActivity) {
      const ActivityModel = Activity;
      const activity = await ActivityModel.findById(relatedActivity._id);
      if (activity) {
        const storedParticipants = activity.participants.length;
        const creatorId = activity.createdBy ? activity.createdBy.toString() : null;
        const creatorInParticipants = creatorId ? activity.participants.some(p => p.user && p.user.toString() === creatorId) : false;
        const creatorOccupiesSlot = creatorId && !creatorInParticipants;
        const effectiveCount = storedParticipants + (creatorOccupiesSlot ? 1 : 0);

        const isActivityFull = activity.maxParticipants && effectiveCount >= activity.maxParticipants;
        const userIsActivityParticipant = activity.participants.some(p => p.user && p.user.equals(currentUserId));

        if (isActivityFull && !userIsActivityParticipant) {
          const isInChat = chat.participants.some(p => p.user && p.user._id.equals(currentUserId));
          if (!isInChat) {
             return res.status(403).json({ message: 'Activity is full - access to chat is restricted to participants' });
          }
        }
      }
    }

    const isParticipant = chat.participants.some(p => p.user && p.user._id && p.user._id.equals(currentUserId));
    if (!isParticipant) {
      return res.status(403).json({ message: 'You are not a participant in this chat' });
    }

    const chatObj = chat.toObject();
    const totalMessages = chat.messages.filter(m => !m.isDeleted).length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const messages = chat.messages
      .filter(m => !m.isDeleted)
      .slice(-parseInt(limit) - skip)
      .slice(-parseInt(limit));

    const extractSenderId = (s) => {
      if (!s) return null;
      if (typeof s === 'string') return s;
      if (typeof s === 'object') {
        if (s._id) return s._id.toString();
        if (s.userId) return s.userId.toString();
      }
      return null;
    };

    const senderIds = Array.from(new Set(messages.map(m => extractSenderId(m.sender)).filter(Boolean)));
    let profilesByUser = {};
    if (senderIds.length > 0) {
      const profiles = await Profile.find({ userId: { $in: senderIds } });
      profiles.forEach(p => {
        if (p && p.userId) profilesByUser[p.userId.toString()] = p;
      });
    }

    const enrichedMessages = messages.map(m => {
      const mm = m.toObject ? m.toObject() : { ...m };
      
      if (!mm.sender) {
        mm.sender = {
          _id: 'deleted',
          username: 'Deleted User',
          email: '',
          avatar: '',
          isOnline: false
        };
        return mm;
      }

      const sid = mm.sender._id ? mm.sender._id.toString() : mm.sender.toString();
      const prof = sid ? profilesByUser[sid] : null;
      
      if (mm.sender) {
        mm.sender.avatar = (prof && prof.avatar) ? prof.avatar : (mm.sender.avatar || '');
      }
      return mm;
    });

    chatObj.messages = enrichedMessages;
    chatObj.messagesPagination = {
      total: totalMessages,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(totalMessages / parseInt(limit)),
      hasMore: skip + parseInt(limit) < totalMessages
    };

    chatObj.unreadCount = chat.getUnreadCount(currentUserId);

    res.status(200).json({ chat: chatObj });
  } catch (error) {
    console.error("Get Chat Error:", error); 
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, type = 'text', fileUrl } = req.body;
    const currentUserId = req.user._id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    if (!['text', 'image', 'file', 'system'].includes(type)) {
      return res.status(400).json({ message: 'Invalid message type' });
    }

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const isParticipant = chat.participants.some(p => p.user && p.user.equals(currentUserId));
    if (!isParticipant) {
      return res.status(403).json({ message: 'You are not a participant in this chat' });
    }

    await chat.addMessage(currentUserId, content.trim(), type, fileUrl);
    await chat.populate('messages.sender', 'email username');

    const newMessage = chat.messages[chat.messages.length - 1];

    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${id}`).emit('message:receive', {
        chatId: id,
        message: newMessage
      });
    }

    res.status(201).json({
      message: 'Message sent successfully',
      messageData: newMessage
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/messages/:messageId', async (req, res) => {
  try {
    const { id, messageId } = req.params;
    const { content } = req.body;
    const currentUserId = req.user._id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const message = chat.messages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (!message.sender.equals(currentUserId)) {
      return res.status(403).json({ message: 'You can only edit your own messages' });
    }

    if (message.isDeleted) {
      return res.status(400).json({ message: 'Cannot edit a deleted message' });
    }

    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();

    await chat.save();

    res.status(200).json({
      message: 'Message updated successfully',
      messageData: message
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id/messages/:messageId', async (req, res) => {
  try {
    const { id, messageId } = req.params;
    const currentUserId = req.user._id;

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const message = chat.messages.id(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const participant = chat.participants.find(p => p.user && p.user.equals(currentUserId));
    const isAdmin = participant && participant.role === 'admin';
    const isSender = message.sender.equals(currentUserId);

    if (!isSender && !isAdmin) {
      return res.status(403).json({ message: 'You can only delete your own messages or be an admin' });
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.content = '[Message deleted]';

    if (chat.lastMessage && chat.lastMessage.equals(messageId)) {
      const lastActiveMessage = chat.messages
        .filter(m => !m.isDeleted)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      
      chat.lastMessage = lastActiveMessage ? lastActiveMessage._id : null;
    }

    await chat.save();

    res.status(200).json({
      message: 'Message deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const { messageIds = [] } = req.body;
    const currentUserId = req.user._id;

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const isParticipant = chat.participants.some(p => p.user && p.user.equals(currentUserId));
    if (!isParticipant) {
      return res.status(403).json({ message: 'You are not a participant in this chat' });
    }

    await chat.markAsRead(currentUserId, messageIds);

    res.status(200).json({
      message: messageIds.length > 0 
        ? `${messageIds.length} messages marked as read` 
        : 'All messages marked as read'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, role = 'member' } = req.body;
    const currentUserId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'Can only add participants to group chats' });
    }

    const currentParticipant = chat.participants.find(p => p.user && p.user.equals(currentUserId));
    if (!currentParticipant || currentParticipant.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can add participants' });
    }

    await chat.addParticipant(userId, role);

    await chat.addMessage(
      currentUserId, 
      `${user.email} has been added to the chat`, 
      'system'
    );

    await chat.populate({
      path: 'participants.user',
      select: 'email username isOnline createdAt',
      populate: { path: 'profile', select: 'avatar bio' }
    });

    res.status(200).json({
      message: 'Participant added successfully',
      chat
    });
    try {
      const io = req.app.get('io');
      const parts = chat.participants
        .filter(p => p.user)
        .map(p => ({ id: p.user._id, email: p.user.email, username: p.user.username, role: p.role, isOnline: !!p.user.isOnline }));
      io.to(`chat:${chat._id}`).emit('chat:participants', { participants: parts });
    } catch (emitErr) {
      console.error('Failed to emit chat:participants after add:', emitErr);
    }
  } catch (error) {
    if (error.message === 'User is already a participant') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id/participants/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const currentUserId = req.user._id;

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'Can only remove participants from group chats' });
    }

    const currentParticipant = chat.participants.find(p => p.user && p.user.equals(currentUserId));
    const isAdmin = currentParticipant && (currentParticipant.role === 'admin' || currentParticipant.role === 'owner');
    const isSelf = currentUserId.toString() === userId;

    if (!isAdmin && !isSelf) {
      return res.status(403).json({ message: 'Only admins can remove other participants' });
    }

    const participantToRemove = chat.participants.find(p => p.user && p.user.toString() === userId);
    
    if (participantToRemove && participantToRemove.role === 'owner') {
      const candidates = chat.participants.filter(p => p.user && p.user.toString() !== userId);
      
      if (candidates.length > 0) {
        let newOwner = candidates.find(p => p.role === 'admin') || candidates[0];
        
        newOwner.role = 'owner';
        await chat.save();

        await chat.addMessage(
          currentUserId, 
          `Ownership has been transferred to ${newOwner.user.username || 'new owner'}`, 
          'system'
        );
      }
    }

    const userToRemove = await User.findById(userId);

    await chat.removeParticipant(userId);

    if (chat.groupInfo && chat.groupInfo.relatedActivity) {
      try {
        await Activity.findByIdAndUpdate(chat.groupInfo.relatedActivity, {
          $pull: { participants: { user: userId } }
        });
      } catch (err) {
        console.error('Failed to sync activity removal:', err);
      }
    }

    if (isSelf) {
      await chat.addMessage(
        currentUserId, 
        `${userToRemove?.email || 'User'} has left the chat`, 
        'system'
      );
    } else {
      await chat.addMessage(
        currentUserId, 
        `${userToRemove?.email || 'User'} has been removed from the chat`, 
        'system'
      );
    }

    await chat.populate({
      path: 'participants.user',
      select: 'email username isOnline createdAt',
      populate: { path: 'profile', select: 'avatar bio' }
    });

    res.status(200).json({
      message: 'Participant removed successfully',
      chat
    });
    try {
      const io = req.app.get('io');
      const parts = chat.participants
        .filter(p => p.user)
        .map(p => ({ id: p.user._id, email: p.user.email, username: p.user.username, role: p.role, isOnline: !!p.user.isOnline }));
      io.to(`chat:${chat._id}`).emit('chat:participants', { participants: parts });
    } catch (emitErr) {
      console.error('Failed to emit chat:participants after remove:', emitErr);
    }
  } catch (error) {
    if (error.message === 'User is not a participant') {
      return res.status(200).json({ message: 'User already removed' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/participants/:userId/role', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { role } = req.body;
    const currentUserId = req.user._id;

    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin or member' });
    }

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    if (chat.type !== 'group') {
      return res.status(400).json({ message: 'Can only update roles in group chats' });
    }

    const currentParticipant = chat.participants.find(p => p.user && p.user.equals(currentUserId));
    if (!currentParticipant || currentParticipant.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can update participant roles' });
    }

    const targetParticipant = chat.participants.find(p => p.user && p.user.equals(userId));
    if (!targetParticipant) {
      return res.status(404).json({ message: 'Participant not found' });
    }

    targetParticipant.role = role;
    await chat.save();

    await chat.populate({
      path: 'participants.user',
      select: 'email username isOnline createdAt',
      populate: { path: 'profile', select: 'avatar bio' }
    });

    res.status(200).json({
      message: 'Participant role updated successfully',
      chat
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/mute', async (req, res) => {
  try {
    const { id } = req.params;
    const { isMuted } = req.body;
    const currentUserId = req.user._id;

    if (typeof isMuted !== 'boolean') {
      return res.status(400).json({ message: 'isMuted must be a boolean value' });
    }

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const participant = chat.participants.find(p => p.user && p.user.equals(currentUserId));
    if (!participant) {
      return res.status(403).json({ message: 'You are not a participant in this chat' });
    }

    participant.isMuted = isMuted;
    await chat.save();

    res.status(200).json({
      message: isMuted ? 'Chat muted successfully' : 'Chat unmuted successfully',
      isMuted
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user._id;

    const chat = await Chat.findById(id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const participant = chat.participants.find(p => p.user && p.user.equals(currentUserId));
    if (!participant) {
      return res.status(403).json({ message: 'You are not a participant in this chat' });
    }

    if (chat.type === 'direct') {
      await chat.removeParticipant(currentUserId);
      res.status(200).json({ message: 'Left chat successfully' });
    } else {
      if (participant.role === 'owner') {
        const candidates = chat.participants.filter(p => p.user && !p.user.equals(currentUserId));
        if (candidates.length > 0) {
          let newOwner = candidates.find(p => p.role === 'admin') || candidates[0];
          newOwner.role = 'owner';
          await chat.save();
          
          await chat.addMessage(
            currentUserId,
            `Ownership transferred to ${newOwner.user.username || 'new owner'}`,
            'system'
          );
        }
      }

      await chat.removeParticipant(currentUserId);
      res.status(200).json({ message: 'Left group chat successfully' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { groupInfo } = req.body;
    const chatId = req.params.id;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const participant = chat.participants.find(p => 
      p.user && p.user.toString() === userId.toString()
    );

    if (!participant || (participant.role !== 'admin' && participant.role !== 'owner')) {
      return res.status(403).json({ message: 'Permission denied. Only admins can edit group info.' });
    }

    const updateData = {};
    if (groupInfo) {
      if (groupInfo.name) updateData['groupInfo.name'] = groupInfo.name;
      if (groupInfo.description !== undefined) updateData['groupInfo.description'] = groupInfo.description;
      if (groupInfo.maxMembers !== undefined) updateData['groupInfo.maxMembers'] = parseInt(groupInfo.maxMembers);
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      { $set: updateData },
      { new: true } 
    ).populate('participants.user', 'email username isOnline')
     .populate('groupInfo.relatedActivity', 'title category');

    if (chat.groupInfo && chat.groupInfo.relatedActivity) {
      try {
        const activityId = chat.groupInfo.relatedActivity;
        const activityUpdates = {};
        
        if (groupInfo.name) activityUpdates.title = groupInfo.name;
        if (groupInfo.description !== undefined) activityUpdates.description = groupInfo.description;
        if (groupInfo.maxMembers !== undefined) activityUpdates.maxParticipants = parseInt(groupInfo.maxMembers);

        if (Object.keys(activityUpdates).length > 0) {
          await Activity.findByIdAndUpdate(activityId, { $set: activityUpdates });
        }
      } catch (err) {
        console.error('Failed to sync activity:', err);
      }
    }
    
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('chat:updated', updatedChat);
    }

    res.json(updatedChat);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id/destroy', async (req, res) => {
  try {
    const chatId = req.params.id;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    const participant = chat.participants.find(p => 
      p.user && p.user.toString() === userId.toString()
    );

    if (!participant || participant.role !== 'owner') {
      return res.status(403).json({ message: 'Permission denied. Only the group owner can delete this group.' });
    }

    await Chat.findByIdAndDelete(chatId);

    if (chat.groupInfo && chat.groupInfo.relatedActivity) {
      try {
        await Activity.findByIdAndDelete(chat.groupInfo.relatedActivity);
      } catch (err) {
        console.error('Failed to delete related activity:', err);
      }
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('chat:deleted', { chatId });
    }

    res.json({ message: 'Group chat deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;