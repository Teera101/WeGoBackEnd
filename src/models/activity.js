import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  location: {
    address: {
      type: String,
      required: false,
      trim: true,
      default: ''
    },
    details: {
      type: String,
      trim: true,
      default: ''
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0]
      }
    }
  },
  date: {
    type: Date,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  endTime: {
    type: String
  },
  tags: [{
    type: String,
    trim: true
  }],
  maxParticipants: {
    type: Number,
    required: true,
    min: 2
  },
  difficulty: {
    type: String,
    enum: ['easy', 'moderate', 'hard'],
    default: 'moderate'
  },
  cost: {
    amount: {
      type: Number,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      default: 'THB'
    }
  },
  cover: {
    type: String
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    description: {
      type: String,
      trim: true
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['joined', 'pending', 'declined'],
      default: 'joined'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    note: {
      type: String,
      trim: true
    }
  }],
  ratings: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5
    },
    review: {
      type: String,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reports: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    reason: {
      type: String,
      required: true,
      enum: ['spam', 'inappropriate', 'misleading', 'other']
    },
    description: {
      type: String,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  requirements: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'completed', 'cancelled'],
    default: 'published'
  },
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public'
  },
  chat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

activitySchema.index({ 'location.coordinates': '2dsphere' });

activitySchema.index({ createdBy: 1, createdAt: -1 });
activitySchema.index({ date: 1, status: 1 });
activitySchema.index({ tags: 1 });
activitySchema.index({ status: 1, visibility: 1 });

activitySchema.methods.canUserJoin = function(userId) {
  if (this.status !== 'published') {
    return false;
  }
  
  const alreadyJoined = this.participants.some(p => p.user && p.user.equals(userId));
  if (alreadyJoined) {
    throw new Error('User already joined this activity');
  }
  
  let creatorOccupiesSlot = false;
  if (this.createdBy) {
    const creatorId = this.createdBy.toString();
    const creatorInParticipants = this.participants.some(p => p.user && p.user.toString() === creatorId);
    creatorOccupiesSlot = !creatorInParticipants;
  }

  const effectiveCount = this.participants.length + (creatorOccupiesSlot ? 1 : 0);
  if (effectiveCount >= this.maxParticipants) {
    throw new Error('Activity is full');
  }
  
  return true;
};

activitySchema.methods.addParticipant = async function(userId, status = 'joined', note = '') {
  if (!this.canUserJoin(userId)) {
    throw new Error('Cannot join this activity');
  }
  
  this.participants.push({
    user: userId,
    status: status,
    joinedAt: new Date(),
    note: note
  });
  
  return await this.save();
};

activitySchema.methods.removeParticipant = async function(userId) {
  const index = this.participants.findIndex(p => p.user && p.user.equals(userId));
  
  if (index === -1) {
    throw new Error('User is not a participant');
  }
  
  this.participants.splice(index, 1);
  return await this.save();
};

activitySchema.methods.addRating = async function(userId, rating, review = '') {
  const existingRatingIndex = this.ratings.findIndex(r => r.user.equals(userId));
  
  if (existingRatingIndex !== -1) {
    this.ratings[existingRatingIndex].rating = rating;
    this.ratings[existingRatingIndex].review = review;
  } else {
    this.ratings.push({
      user: userId,
      rating: rating,
      review: review,
      createdAt: new Date()
    });
  }
  
  this.calculateAverageRating();
  
  return await this.save();
};

activitySchema.methods.calculateAverageRating = function() {
  if (this.ratings.length === 0) {
    this.averageRating = 0;
    return;
  }
  
  const sum = this.ratings.reduce((acc, r) => acc + r.rating, 0);
  this.averageRating = Math.round((sum / this.ratings.length) * 10) / 10;
};

activitySchema.statics.findNearby = function(latitude, longitude, maxDistance = 10000) {
  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    status: 'published',
    visibility: 'public'
  });
};

const Activity = mongoose.model('Activity', activitySchema);
export default Activity;