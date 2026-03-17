import express from 'express';
import auth from '../middleware/auth.js';
import * as groupController from '../controllers/groupController.js';
import Review from '../models/review.js'; 
import Report from '../models/report.js'; 
import Group from '../models/group.js';   
import Activity from '../models/activity.js';
import Chat from '../models/chat.js';

const router = express.Router();

router.post('/', auth, groupController.createGroup);
router.get('/', groupController.getGroups);
router.get('/:id', groupController.getGroupById);
router.put('/:id', auth, groupController.updateGroup);
router.delete('/:id', auth, groupController.deleteGroup);

router.post('/:id/join', auth, groupController.joinGroup);
router.post('/:id/leave', auth, groupController.leaveGroup);

router.delete('/:groupId/members/:memberId', auth, async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const requester = group.members.find(m => m.userId.toString() === req.user._id.toString());
    if (!requester || (requester.role !== 'owner' && requester.role !== 'admin' && req.user._id.toString() !== memberId)) {
      return res.status(403).json({ error: 'No permission to remove member' });
    }

    group.members = group.members.filter(m => m.userId.toString() !== memberId);
    await group.save();

    if (group.relatedActivity) {
      const activity = await Activity.findById(group.relatedActivity);
      if (activity) {
        activity.participants = activity.participants.filter(p => p.user && p.user.toString() !== memberId);
        await activity.save();

        if (activity.chat) {
          const chat = await Chat.findById(activity.chat);
          if (chat) {
            chat.participants = chat.participants.filter(p => p.user && p.user.toString() !== memberId);
            await chat.save();
            
            const io = req.app.get('io');
            if (io) {
              io.to(`chat:${chat._id}`).emit('participant:kicked', { userId: memberId, chatId: chat._id });
            }
          }
        }
      }
    }

    res.json({ message: 'Member removed successfully', group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:groupId/members/:memberId/role', auth, groupController.updateMemberRole);

router.put('/:id/unban/:userId', auth, async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) return res.status(404).json({ error: 'Group not found' });
        group.bannedUsers = group.bannedUsers.filter(id => id.toString() !== req.params.userId);
        await group.save();
        res.json({ message: 'Unbanned' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/reviews', async (req, res) => {
  try {
    const reviews = await Review.find({ groupId: req.params.id }).populate('userId', 'email').sort({ createdAt: -1 });
    res.json({ reviews });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/reviews', auth, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const review = new Review({ groupId: req.params.id, userId: req.user._id, rating, comment });
    await review.save();
    res.status(201).json(review);
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/:id/report', auth, async (req, res) => {
  try {
    const report = new Report({ targetType: 'group', targetId: req.params.id, reportedBy: req.user._id, ...req.body });
    await report.save();
    res.status(201).json(report);
  } catch (error) { 
    if (error.code === 11000) {
      return res.status(400).json({ error: 'คุณได้รายงานเนื้อหานี้ไปแล้ว' });
    }
    res.status(400).json({ error: error.message }); 
  }
});

export default router;