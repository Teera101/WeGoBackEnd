import express from 'express';
import Report from '../models/report.js';
import Activity from '../models/activity.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Middleware to check admin role
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
};

// Get all reports (admin only) with filtering
router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const { status, targetType, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filters = {};
    if (status) filters.status = status;
    if (targetType) filters.targetType = targetType;

    const reports = await Report.find(filters)
      .populate('reportedBy', 'email username')
      .populate('reviewedBy', 'email username')
      .populate('targetId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Report.countDocuments(filters);

    res.json({
      reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a single report by ID (admin only)
router.get('/:id', auth, isAdmin, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('reportedBy', 'email username')
      .populate('reviewedBy', 'email username')
      .populate('targetId');

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update report status (admin only)
router.patch('/:id', auth, isAdmin, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (status) report.status = status;
    if (adminNotes !== undefined) report.adminNotes = adminNotes;
    
    if (status && status !== 'pending') {
      report.reviewedBy = req.user._id;
      report.reviewedAt = new Date();
    }

    await report.save();
    await report.populate('reportedBy', 'email username');
    await report.populate('reviewedBy', 'email username');

    res.json({ message: 'Report updated successfully', report });
  } catch (error) {
    console.error('Update report error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete a report (admin only)
router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Also remove from embedded activity.reports if targetType is activity
    if (report.targetType === 'activity') {
      try {
        await Activity.updateOne(
          { _id: report.targetId },
          { $pull: { reports: { user: report.reportedBy } } }
        );
        console.log('[ADMIN] Removed embedded report from activity', report.targetId);
      } catch (e) {
        console.warn('[ADMIN] Failed to remove embedded report:', e.message);
      }
    }

    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
