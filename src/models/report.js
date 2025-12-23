import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  targetType: {
    type: String,
    enum: ['group', 'activity', 'user'],
    required: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'targetType'
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    enum: [
      'spam',
      'inappropriate_content',
      'harassment',
      'false_information',
      'scam',
      'other'
    ],
    required: true
  },
  details: {
    type: String,
    required: true,
    trim: true,
    maxLength: 1000
  },
  status: {
    type: String,
    enum: ['pending', 'reviewing', 'resolved', 'dismissed'],
    default: 'pending'
  },
  adminNotes: {
    type: String,
    trim: true,
    maxLength: 1000
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for querying
reportSchema.index({ targetType: 1, targetId: 1 });
reportSchema.index({ reportedBy: 1 });
reportSchema.index({ status: 1, createdAt: -1 });

// Unique compound index to prevent duplicate reports from same user for same target
reportSchema.index({ targetId: 1, reportedBy: 1 }, { unique: true });

const Report = mongoose.model('Report', reportSchema);
export default Report;
