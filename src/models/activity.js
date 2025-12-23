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
      required: false, // ไม่บังคับ เพื่อรองรับการส่ง location แบบ string
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
  // category removed: use tags instead
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
  timestamps: true // Auto-create createdAt and updatedAt
});

// Geospatial index for location-based queries
activitySchema.index({ 'location.coordinates': '2dsphere' });

// Compound indexes for common queries
activitySchema.index({ createdBy: 1, createdAt: -1 });
activitySchema.index({ date: 1, status: 1 });
// category index removed (category field deleted)
activitySchema.index({ tags: 1 });
activitySchema.index({ status: 1, visibility: 1 });

// Instance Methods

// Check if user can join the activity
activitySchema.methods.canUserJoin = function(userId) {
  // Check if activity is open (drafts are not joinable)
  if (this.status !== 'published') {
    // do not allow joining when not published
    return false;
  }
  
  // Check if already a participant
  const alreadyJoined = this.participants.some(p => p.user && p.user.equals(userId));
  if (alreadyJoined) {
    throw new Error('User already joined this activity');
  }
  
  // Check if full (do not allow joining when full)
  // Treat the creator as occupying a slot if they're not already in participants
  let creatorOccupiesSlot = false;
  if (this.createdBy) {
    const creatorId = this.createdBy.toString();
    const creatorInParticipants = this.participants.some(p => p.user && p.user.toString() === creatorId);
    creatorOccupiesSlot = !creatorInParticipants; // if creator not in participants, they count as occupying one slot
  }

  const effectiveCount = this.participants.length + (creatorOccupiesSlot ? 1 : 0);
  if (effectiveCount >= this.maxParticipants) {
    throw new Error('Activity is full');
  }
  
  return true;
};

// Add participant
activitySchema.methods.addParticipant = async function(userId, status = 'joined', note = '') {
  if (!this.canUserJoin(userId)) {
    // canUserJoin will throw a specific error if not allowed
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

// Remove participant
activitySchema.methods.removeParticipant = async function(userId) {
  const index = this.participants.findIndex(p => p.user && p.user.equals(userId));
  
  if (index === -1) {
    throw new Error('User is not a participant');
  }
  
  this.participants.splice(index, 1);
  return await this.save();
};

// Add rating
activitySchema.methods.addRating = async function(userId, rating, review = '') {
  // Check if user already rated
  const existingRatingIndex = this.ratings.findIndex(r => r.user.equals(userId));
  
  if (existingRatingIndex !== -1) {
    // Update existing rating
    this.ratings[existingRatingIndex].rating = rating;
    this.ratings[existingRatingIndex].review = review;
  } else {
    // Add new rating
    this.ratings.push({
      user: userId,
      rating: rating,
      review: review,
      createdAt: new Date()
    });
  }
  
  // Recalculate average rating
  this.calculateAverageRating();
  
  return await this.save();
};

// Calculate average rating
activitySchema.methods.calculateAverageRating = function() {
  if (this.ratings.length === 0) {
    this.averageRating = 0;
    return;
  }
  
  const sum = this.ratings.reduce((acc, r) => acc + r.rating, 0);
  this.averageRating = Math.round((sum / this.ratings.length) * 10) / 10; // Round to 1 decimal
};

// Static Methods

// Find activities near a location
activitySchema.statics.findNearby = function(latitude, longitude, maxDistance = 10000) {
  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance // in meters
      }
    },
    status: 'published',
    visibility: 'public'
  });
};

const Activity = mongoose.model('Activity', activitySchema);
export default Activity;