import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    required: true
  },
  userId: {
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
  comment: {
    type: String,
    trim: true,
    maxLength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index to prevent duplicate reviews from same user for same group
reviewSchema.index({ groupId: 1, userId: 1 }, { unique: true });

// Update the updatedAt timestamp before saving
reviewSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Review = mongoose.model('Review', reviewSchema);
export default Review;
