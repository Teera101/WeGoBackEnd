import Group from '../models/group.js';
import mongoose from 'mongoose';

// ✅ Helper Functions
// ฟังก์ชันช่วยค้นหากลุ่มแบบฉลาด (เผื่ออนาคตใช้ Event หรือ Chat ID)
async function findGroupSmartly(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  // ลองหาด้วย ID ตรงๆ ก่อน
  let group = await Group.findById(id);
  if (group) return group;
  return null;
}

// ✅ Helper: ดึง ID ผู้ใช้ให้ชัวร์ที่สุด
const getUserId = (req) => {
  if (req.user && req.user._id) return req.user._id;
  if (req.user && req.user.id) return req.user.id;
  return null;
};

// ----------------------------------------------------
// Main Functions
// ----------------------------------------------------

export const createGroup = async (req, res) => {
  try {
    const userId = getUserId(req);
    
    // ✅ สร้างกลุ่มพร้อมยัดผู้สร้างเป็น Owner ทันที
    const newGroup = new Group({
      ...req.body,
      createdBy: userId,
      members: [{ 
        userId: userId, 
        role: 'owner', 
        joinedAt: new Date() 
      }]
    });

    const savedGroup = await newGroup.save();
    
    // Populate ข้อมูลกลับไปให้ Frontend แสดงผลได้เลย
    await savedGroup.populate('members.userId', 'name avatar email');
    await savedGroup.populate('createdBy', 'name avatar email');
    
    res.status(201).json(savedGroup);
  } catch (err) {
    console.error("Create Group Error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getGroups = async (req, res) => {
  try {
    const groups = await Group.find().populate('members.userId', 'name avatar email');
    res.status(200).json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getGroupById = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.userId', 'name avatar email')
      .populate('createdBy', 'name avatar email')
      .populate('bannedUsers', 'name avatar email');
      
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.status(200).json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateGroup = async (req, res) => {
  try {
    const group = await Group.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('members.userId', 'name avatar email');
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.status(200).json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteGroup = async (req, res) => {
  try {
    const group = await Group.findByIdAndDelete(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    res.status(200).json({ message: 'Group deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ ฟังก์ชัน Join Group (ที่ขาดหายไปจนทำให้เกิด Error)
export const joinGroup = async (req, res) => {
  try {
    const userId = getUserId(req);
    const group = await findGroupSmartly(req.params.id);
    
    if (!group) return res.status(404).json({ error: 'Group not found' });
    
    // เช็คว่าโดนแบนไหม
    if (group.bannedUsers && group.bannedUsers.includes(userId)) {
        return res.status(403).json({ error: 'You are banned from this group' });
    }

    // เช็คว่าเป็นสมาชิกอยู่แล้วไหม
    const isMember = group.members.some(m => m.userId.toString() === userId.toString());
    if (isMember) return res.status(400).json({ error: 'Already a member' });

    // เพิ่มสมาชิก
    group.members.push({ userId: userId, role: 'member', joinedAt: new Date() });
    await group.save();
    
    // Populate กลับไป
    await group.populate('members.userId', 'name avatar email');
    
    res.json({ message: 'Joined successfully', group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ✅ ฟังก์ชัน Leave Group (ที่ขาดหายไป)
export const leaveGroup = async (req, res) => {
  try {
    const userId = getUserId(req);
    const group = await findGroupSmartly(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const index = group.members.findIndex(m => m.userId.toString() === userId.toString());
    if (index === -1) return res.status(400).json({ error: 'Not a member' });

    group.members.splice(index, 1);
    
    // ถ้าสมาชิกหมดกลุ่ม ให้ลบกลุ่มทิ้ง (Optional Logic)
    if (group.members.length === 0) {
        await Group.findByIdAndDelete(group._id);
        return res.json({ message: 'Group deleted (empty)' });
    }

    await group.save();
    res.json({ message: 'Left group successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const removeMember = async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    const requesterId = getUserId(req).toString();
    
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const requester = group.members.find(m => m.userId.toString() === requesterId);
    if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
        return res.status(403).json({ message: 'Permission denied' });
    }

    group.members = group.members.filter(m => m.userId.toString() !== memberId);
    
    if (!group.bannedUsers.includes(memberId)) {
        group.bannedUsers.push(memberId);
    }

    await group.save();
    res.json({ message: 'Member removed successfully', members: group.members });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const updateMemberRole = async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    const { role } = req.body;
    const requesterId = getUserId(req).toString();

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const requester = group.members.find(m => m.userId.toString() === requesterId);
    if (!requester || requester.role !== 'owner') {
        return res.status(403).json({ message: 'Only Owner can manage roles' });
    }

    const member = group.members.find(m => m.userId.toString() === memberId);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    member.role = role;
    await group.save();
    res.json({ message: `Role updated to ${role}`, member });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};