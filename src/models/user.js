import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import validator from 'validator';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: false,  // ไม่บังคับสำหรับ user เก่า
    unique: true,
    sparse: true,  // ใช้ sparse index เพื่อให้ค่า null ไม่ซ้ำกันได้
    trim: true,
    minlength: 3,
    maxlength: 30,
    validate: {
      validator: function(value) {
        // Username can only contain letters, numbers, underscore, and hyphen
        if (!value) return true; // Allow empty/null
        return /^[a-zA-Z0-9_-]+$/.test(value);
      },
      message: 'Username can only contain letters, numbers, underscore, and hyphen'
    }
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate(value) {
      if (!validator.isEmail(value)) {
        throw new Error('Invalid email');
      }
    }
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  const user = this;
  if (user.isModified('password')) {
    user.password = await bcrypt.hash(user.password, 8);
  }
  next();
});

// Check password
userSchema.methods.comparePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;