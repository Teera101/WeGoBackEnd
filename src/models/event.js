import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['concert', 'sport', 'education', 'entertainment', 'other']
  },
  cover: {
    type: String,
    required: true
  },
  tags: [{
    type: String
  }],
  location: {
    type: String,
    required: true
  },
  time: {
    type: Date,
    required: true
  },
  maxParticipants: {
    type: Number,
    required: true,
    min: 1
  },
  currentParticipants: {
    type: Number,
    default: 0
  },
  popularity: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'full', 'closed'],
    default: 'open'
  }
}, {
  timestamps: true
});

const Event = mongoose.model('Event', eventSchema);

export default Event;