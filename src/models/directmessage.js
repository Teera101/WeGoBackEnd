import mongoose from 'mongoose';

const directMessageSchema = new mongoose.Schema({
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true,
    trim: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  }
}, {
  timestamps: true,
  collection: 'directmessages'  // Explicitly set collection name
});

// Indexes for performance
directMessageSchema.index({ from: 1, to: 1, createdAt: -1 });
directMessageSchema.index({ to: 1, isRead: 1 });
directMessageSchema.index({ from: 1, createdAt: -1 });
directMessageSchema.index({ to: 1, createdAt: -1 });

// Static method to get conversation between two users
directMessageSchema.statics.getConversation = function(user1Id, user2Id) {
  return this.find({
    $or: [
      { from: user1Id, to: user2Id },
      { from: user2Id, to: user1Id }
    ],
    isDeleted: false
  })
    .populate('from', 'email username')
    .populate('to', 'email username')
    .sort({ createdAt: 1 });
};

// Static method to mark messages as read
directMessageSchema.statics.markAsRead = async function(userId, senderId) {
  return this.updateMany(
    { 
      to: userId, 
      from: senderId, 
      isRead: false 
    },
    { 
      isRead: true, 
      readAt: new Date() 
    }
  );
};

// Static method to get unread count
directMessageSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    to: userId,
    isRead: false,
    isDeleted: false
  });
};

const DirectMessage = mongoose.model('DirectMessage', directMessageSchema);
export default DirectMessage;
