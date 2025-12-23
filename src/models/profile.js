import mongoose from 'mongoose';

const profileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  avatar: {
    type: String,
    trim: true
  },
  bio: {
    type: String,
    trim: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Profile = mongoose.model('Profile', profileSchema);
export default Profile;