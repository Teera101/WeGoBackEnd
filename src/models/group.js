import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  maxMembers: {
    type: Number,
    default: 100
  },
  cover: {
    type: String, 
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    _id: false,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // ✅✅ เพิ่ม: บัญชีรายชื่อคนโดนแบน ✅✅
  bannedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  relatedActivity: {
    type: String
  }
}, { timestamps: true });

const Group = mongoose.model('Group', groupSchema);
export default Group;