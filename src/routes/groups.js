import express from 'express';
import auth from '../middleware/auth.js';
import * as groupController from '../controllers/groupController.js';
import Review from '../models/review.js'; // ยังคงใช้สำหรับ routes ย่อยที่ไม่ย้าย
import Report from '../models/report.js'; // ยังคงใช้สำหรับ routes ย่อยที่ไม่ย้าย
import Group from '../models/group.js';   // ใช้สำหรับ review/report logic

const router = express.Router();

// --- Main CRUD Operations (ใช้ Controller) ---
router.post('/', auth, groupController.createGroup);
router.get('/', groupController.getGroups);
router.get('/:id', groupController.getGroupById);
router.put('/:id', auth, groupController.updateGroup);
router.delete('/:id', auth, groupController.deleteGroup);

// --- Member Actions (ใช้ Controller) ---
router.post('/:id/join', auth, groupController.joinGroup);
router.post('/:id/leave', auth, groupController.leaveGroup);
router.delete('/:groupId/members/:memberId', auth, groupController.removeMember); // แก้ parameter ให้ตรงกับ controller
router.put('/:groupId/members/:memberId/role', auth, groupController.updateMemberRole); // แก้ parameter ให้ตรงกับ controller
router.put('/:id/unban/:userId', auth, async (req, res) => {
    // Logic Unban (เก็บไว้ inline หรือย้ายก็ได้ แต่นี่คือตัวอย่าง inline เดิมที่ทำงานได้)
    try {
        const group = await Group.findById(req.params.id);
        if (!group) return res.status(404).json({ error: 'Group not found' });
        // Check Owner/Admin logic...
        group.bannedUsers = group.bannedUsers.filter(id => id.toString() !== req.params.userId);
        await group.save();
        res.json({ message: 'Unbanned' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Reviews & Reports (คงเดิมไว้ เพราะ User ไม่ได้แจ้งปัญหา) ---
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
  } catch (error) { res.status(400).json({ error: error.message }); }
});

export default router;