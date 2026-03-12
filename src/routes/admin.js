import express from 'express';
import User from '../models/user.js';
import Activity from '../models/activity.js';
import Group from '../models/group.js';
import Event from '../models/event.js';
import Chat from '../models/chat.js';
import Profile from '../models/profile.js';
import Report from '../models/report.js';
import Notification from '../models/notification.js';
import auth from '../middleware/auth.js';
import nodemailer from 'nodemailer';

const router = express.Router();

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

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    return res.status(403).json({ 
      message: 'Access denied. Admin only.',
      error: 'Forbidden',
      userRole: req.user?.role
    });
  }
};

router.use(auth);
router.use(isAdmin);

router.get('/users/stats', async (req, res) => {
  try {
    const total = await User.countDocuments();
    const recent = await User.find()
      .select('email username role createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      total,
      recent
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('email username role isBlocked isOnline lastActive createdAt')
      .sort({ createdAt: -1 });

    const userIds = users.map(user => user._id);
    const profiles = await Profile.find({ userId: { $in: userIds } })
      .select('userId name avatar');

    const usersWithProfiles = users.map(user => {
      const profile = profiles.find(p => p.userId.toString() === user._id.toString());
      return {
        ...user.toObject(),
        profile: profile ? { name: profile.name, avatar: profile.avatar } : null
      };
    });

    res.status(200).json({
      users: usersWithProfiles
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/users/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    const { isBlocked } = req.body;

    if (id === req.user._id.toString()) {
      return res.status(400).json({ 
        message: 'Cannot block yourself',
        error: 'You cannot block your own account'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isBlocked = isBlocked;
    await user.save();

    res.status(200).json({
      message: `User ${isBlocked ? 'blocked' : 'unblocked'} successfully`,
      user: {
        _id: user._id,
        email: user.email,
        username: user.username,
        role: user.role,
        isBlocked: user.isBlocked
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    ).select('email username role');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'User role updated successfully',
      user
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/activities/stats', async (req, res) => {
  try {
    const total = await Activity.countDocuments();
    const recent = await Activity.find()
      .select('title category status createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      total,
      recent
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/activities', async (req, res) => {
  try {
    let activities = await Activity.find()
      .populate('createdBy', 'email username')
      .populate('participants.user', 'email username')
      .sort({ createdAt: -1 })
      .lean();

    try {
      const missingCreatorIds = activities
        .filter(a => a.createdBy && !a.createdBy.username)
        .map(a => String(a.createdBy._id));

      if (missingCreatorIds.length > 0) {
        const profiles = await Profile.find({ userId: { $in: missingCreatorIds } }).select('userId name');
        const profileMap = new Map(profiles.map(p => [String(p.userId), p.name]));
        activities = activities.map(a => {
          if (a.createdBy && !a.createdBy.username) {
            const name = profileMap.get(String(a.createdBy._id));
            if (name) {
              a.createdBy.username = name;
            }
          }
          return a;
        });
      }
    } catch (pfErr) {
    }

    res.status(200).json({
      activities
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/activities/:id/important', async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }
    
    activity.isImportant = !activity.isImportant;
    await activity.save();
    
    if (activity.isImportant) {
      (async () => {
        try {
          const io = req.app.get('io');
          const allUsers = await User.find({ _id: { $ne: req.user._id } });

          for (const targetUser of allUsers) {
            try {
              const notification = new Notification({
                recipient: targetUser._id,
                sender: req.user._id,
                type: 'recommendation',
                title: '📢 กิจกรรมพิเศษจากแอดมิน!',
                message: `มีกิจกรรมไฮไลท์ "${activity.title}" เข้ามาใหม่ ลองเข้าไปดูรายละเอียดสิ!`,
                relatedId: activity._id
              });
              await notification.save();

              if (io) {
                io.to(targetUser._id.toString()).emit('notification:new', notification);
              }

              if (targetUser.email) {
                const emailHtml = `
                  <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 12px; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #ea580c; text-align: center;">📢 ประกาศกิจกรรมพิเศษจากแอดมิน!</h2>
                    <div style="background: white; padding: 24px; border-radius: 8px; margin-top: 20px; border: 2px solid #fef3c7;">
                      <p style="color: #334155; font-size: 16px;">สวัสดีครับ,</p>
                      <p style="color: #334155; font-size: 16px;">ระบบได้คัดเลือกกิจกรรม <strong>"${activity.title}"</strong> ให้เป็นกิจกรรมไฮไลท์ประจำแพลตฟอร์ม 🌟</p>
                      <p style="color: #334155; font-size: 16px;">รีบเข้าไปดูรายละเอียดและเข้าร่วมกิจกรรมนี้บน WeGo ได้เลยครับ!</p>
                    </div>
                  </div>
                `;
                await sendNotificationEmail(targetUser.email, `WeGo - 🌟 กิจกรรมไฮไลท์จากแอดมิน: ${activity.title}`, emailHtml);
              }
            } catch (innerErr) {
            }
          }
        } catch (err) {
        }
      })();
    }

    res.status(200).json({ message: 'Status updated', isImportant: activity.isImportant });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/activities/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const activity = await Activity.findByIdAndDelete(id);

    if (!activity) {
      return res.status(404).json({ message: 'Activity not found' });
    }

    res.status(200).json({
      message: 'Activity deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/groups/stats', async (req, res) => {
  try {
    const total = await Group.countDocuments();
    const recent = await Group.find()
      .select('name category members createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      total,
      recent
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/groups', async (req, res) => {
  try {
    const groupsCount = await Group.countDocuments();
    
    if (groupsCount === 0) {
      return res.status(200).json({ groups: [] });
    }
    
    const groups = await Group.find()
      .populate({
        path: 'createdBy',
        select: 'email username',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'members.user',
        select: 'email username',
        options: { strictPopulate: false }
      })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      groups
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const group = await Group.findByIdAndDelete(id);

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    res.status(200).json({
      message: 'Group deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/events/stats', async (req, res) => {
  try {
    const total = await Event.countDocuments();
    const recent = await Event.find()
      .select('title activityId date createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      total,
      recent
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/events', async (req, res) => {
  try {
    const eventsCount = await Event.countDocuments();
    
    if (eventsCount === 0) {
      return res.status(200).json({ events: [] });
    }
    
    const events = await Event.find()
      .populate({
        path: 'createdBy',
        select: 'email username',
        options: { strictPopulate: false }
      })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      events
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findByIdAndDelete(id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.status(200).json({
      message: 'Event deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/chats/stats', async (req, res) => {
  try {
    const total = await Chat.countDocuments();
    const recent = await Chat.find()
      .select('type participants messages createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      total,
      recent
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/chats', async (req, res) => {
  try {
    const chatsCount = await Chat.countDocuments();
    
    if (chatsCount === 0) {
      return res.status(200).json({ chats: [] });
    }
    
    const chats = await Chat.find()
      .populate({
        path: 'participants.user',
        select: 'email username',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'groupInfo.relatedActivity',
        select: 'title',
        options: { strictPopulate: false }
      })
      .populate({
        path: 'createdBy',
        select: 'email username',
        options: { strictPopulate: false }
      })
      .sort({ updatedAt: -1 })
      .lean();

    res.status(200).json({
      chats
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/chats/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const chat = await Chat.findByIdAndDelete(id);

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    res.status(200).json({
      message: 'Chat deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalUsers,
      totalActivities,
      totalGroups,
      totalEvents,
      totalChats,
      totalReports,
      pendingReports,
      recentUsers,
      recentActivities
    ] = await Promise.all([
      User.countDocuments(),
      Activity.countDocuments(),
      Group.countDocuments(),
      Event.countDocuments(),
      Chat.countDocuments(),
      Report.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      User.find().select('email username role createdAt').sort({ createdAt: -1 }).limit(5),
      Activity.find().select('title category status createdAt').sort({ createdAt: -1 }).limit(5)
    ]);

    res.status(200).json({
      stats: {
        totalUsers,
        totalActivities,
        totalGroups,
        totalEvents,
        totalChats,
        totalReports,
        pendingReports
      },
      recentUsers,
      recentActivities
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const { status, targetType } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (targetType) query.targetType = targetType;

    const reports = await Report.find(query)
      .populate('reportedBy', 'email username')
      .populate('reviewedBy', 'email username')
      .sort({ createdAt: -1 });

    res.status(200).json({
      reports
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/reports/:id', async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('reportedBy', 'email username')
      .populate('reviewedBy', 'email username');

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    let targetDetails = null;
    if (report.targetType === 'group') {
      targetDetails = await Group.findById(report.targetId)
        .populate('createdBy', 'email username')
        .select('name description members');
    } else if (report.targetType === 'activity') {
      targetDetails = await Activity.findById(report.targetId)
        .populate('createdBy', 'email username')
        .select('title description category');
    } else if (report.targetType === 'user') {
      targetDetails = await User.findById(report.targetId)
        .select('email username role isBlocked');
    }

    res.status(200).json({
      report,
      targetDetails
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/reports/:id', async (req, res) => {
  try {
    const { status, adminNotes } = req.body;

    if (!['pending', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    report.status = status;
    if (adminNotes) report.adminNotes = adminNotes;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();

    await report.save();
    await report.populate('reportedBy', 'email username');
    await report.populate('reviewedBy', 'email username');

    res.status(200).json({
      message: 'Report updated successfully',
      report
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/reports/:id/action', async (req, res) => {
  try {
    const { action, reason } = req.body; 
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    let result = {};

    switch (action) {
      case 'delete':
        if (report.targetType === 'group') {
          await Group.findByIdAndDelete(report.targetId);
          result.message = 'Group deleted successfully';
        } else if (report.targetType === 'activity') {
          await Activity.findByIdAndDelete(report.targetId);
          result.message = 'Activity deleted successfully';
        }
        
        report.status = 'resolved';
        report.adminNotes = `Content deleted. Reason: ${reason || 'Violated community guidelines'}`;
        break;

      case 'block_user':
        let ownerId;
        if (report.targetType === 'group') {
          const group = await Group.findById(report.targetId);
          ownerId = group?.createdBy;
        } else if (report.targetType === 'activity') {
          const activity = await Activity.findById(report.targetId);
          ownerId = activity?.createdBy;
        } else if (report.targetType === 'user') {
          ownerId = report.targetId;
        }

        if (ownerId) {
          await User.findByIdAndUpdate(ownerId, { isBlocked: true });
          result.message = 'User blocked successfully';
        }

        report.status = 'resolved';
        report.adminNotes = `User blocked. Reason: ${reason || 'Repeated violations'}`;
        break;

      case 'warn':
        report.status = 'resolved';
        report.adminNotes = `Warning issued. Reason: ${reason || 'First-time offense'}`;
        result.message = 'Warning issued';
        break;

      case 'dismiss':
        report.status = 'dismissed';
        report.adminNotes = `Report dismissed. Reason: ${reason || 'No violation found'}`;
        result.message = 'Report dismissed';
        break;

      default:
        return res.status(400).json({ message: 'Invalid action' });
    }

    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();
    await report.save();

    res.status(200).json({
      ...result,
      report
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;