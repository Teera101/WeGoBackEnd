import express from 'express';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import User from '../models/user.js';
import Profile from '../models/profile.js';
import auth from '../middleware/auth.js';

const router = express.Router();

const otpStore = new Map();

let transporter = null;

const initTransporter = () => {
  if (!transporter && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
    transporter = nodemailer.createTransport({
      pool: true,
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }
  return transporter;
};

const sendOTPEmail = async (email, otp) => {
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
      <div style="background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #0f172a; margin: 0; font-size: 24px; font-weight: bold;">Reset Password</h1>
        </div>
        <p style="color: #475569; font-size: 16px; margin-bottom: 24px;">
          Use the following OTP code to reset your password. This code is valid for 10 minutes.
        </p>
        <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 32px; font-weight: bold; color: #0f172a; letter-spacing: 8px; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 14px; text-align: center;">
          If you didn't request this, please ignore this email.
        </p>
      </div>
    </div>
  `;

  try {
    const mailTransporter = initTransporter();
    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: `"WeGo Security" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'WeGo - Password Reset OTP',
        html: emailHtml
      });
      return { success: true };
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV ONLY] OTP for ${email}: ${otp}`);
      return { success: true, devMode: true };
    }
    return { success: false, error: 'No email provider configured' };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
};

const sendResetEmail = async (email, token) => {
  const frontendUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const resetLink = `${frontendUrl}/auth/reset-password-confirm?token=${token}`;
  
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <h2 style="color: #0f172a; margin-top:0;">Reset Password Link</h2>
        <p style="color: #475569;">Click the button below to reset your password. This link expires in 1 hour.</p>
        <div style="text-align:center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="font-size: 12px; color: #94a3b8;">Or copy this link: ${resetLink}</p>
      </div>
    </div>
  `;

  try {
    const mailTransporter = initTransporter();
    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: `"WeGo Security" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'WeGo - Password Reset Link',
        html: emailHtml
      });
      return { success: true };
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV ONLY] Link for ${email}: ${resetLink}`);
      return { success: true, devMode: true };
    }
    return { success: false };
  } catch (error) {
    console.error('Link send error:', error);
    return { success: false };
  }
};

router.post('/register', async (req, res) => {
  try {
    const userData = { ...req.body };
    if (userData.username) {
      userData.username = userData.username.trim();
    }
    const user = new User(userData);
    await user.save();
    
    const profile = new Profile({
      userId: user._id,
      name: user.username ? user.username : user.email.split('@')[0],
      bio: '',
      avatar: ''
    });
    await profile.save();
    
    const token = jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET);
    res.status(201).json({ user, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    
    let user;
    if (email) {
      user = await User.findOne({ email: email.toLowerCase() });
    } else if (username) {
      user = await User.findOne({ username: username });
    } else {
      throw new Error('Please provide email or username');
    }
    
    if (!user || !(await user.comparePassword(password))) {
      throw new Error('Invalid login credentials');
    }

    let profile = await Profile.findOne({ userId: user._id });
    if (!profile) {
      profile = new Profile({
        userId: user._id,
        name: user.email.split('@')[0],
        bio: '',
        avatar: ''
      });
      await profile.save();
    }

    const token = jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET);
    res.json({ user, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/me', auth, async (req, res) => {
  res.json(req.user);
});

router.post('/logout', auth, async (req, res) => {
  try {
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.json({ message: 'If the email exists, an OTP has been sent' });
    }

    // --- ส่วนที่ปรับแก้: ลบอันเก่าทิ้งทันทีถ้ามี (Force Update) ---
    const existingOTP = otpStore.get(email.toLowerCase());
    if (existingOTP) {
      // เคลียร์ Timeout ของอันเก่าเพื่อไม่ให้ Memory Leak
      if (existingOTP.timeoutId) {
        clearTimeout(existingOTP.timeoutId);
      }
      // ลบทิ้งเลย
      otpStore.delete(email.toLowerCase());
    }
    // -----------------------------------------------------

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    const timeoutId = setTimeout(() => {
      otpStore.delete(email.toLowerCase());
    }, 10 * 60 * 1000);

    otpStore.set(email.toLowerCase(), { 
      otp, 
      expiresAt, 
      createdAt: Date.now(),
      timeoutId 
    });

    const result = await sendOTPEmail(email, otp);
    
    if (!result.success && !result.devMode) {
      otpStore.delete(email.toLowerCase());
      // ถ้าส่งไม่ผ่าน ไม่ต้อง throw error ให้ frontend แต่ให้เงียบไว้ (เพื่อความปลอดภัย)
      // หรือถ้าอยากรู้ Error จริงๆ ให้ uncomment บรรทัดล่าง
      // throw new Error(result.error || 'Failed to send email');
    }
    
    res.json({ 
      message: 'If the email exists, an OTP has been sent',
      devOTP: result.devMode ? otp : undefined
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    }

    const storedOTP = otpStore.get(email.toLowerCase());
    if (!storedOTP) {
      return res.status(400).json({ error: 'รหัส OTP หมดอายุหรือไม่มีในระบบ (กรุณาขอรหัสใหม่)' });
    }

    if (storedOTP.expiresAt < Date.now()) {
      otpStore.delete(email.toLowerCase());
      return res.status(400).json({ error: 'รหัส OTP หมดอายุแล้ว' });
    }

    if (storedOTP.otp !== otp) {
      return res.status(400).json({ error: 'รหัส OTP ไม่ถูกต้อง' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }

    user.password = newPassword;
    await user.save();

    if (storedOTP.timeoutId) {
      clearTimeout(storedOTP.timeoutId);
    }
    otpStore.delete(email.toLowerCase());

    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน' });
  }
});

router.post('/forgot-password-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ message: 'If the email exists, a reset link has been sent' });

    const token = jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const result = await sendResetEmail(email, token);

    res.json({ message: 'If the email exists, a reset link has been sent', devLinkToken: result.devMode ? token : undefined });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process request' });
  }
});

router.post('/verify-reset-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token is required' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const user = await User.findById(payload._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ email: user.email });
  } catch (error) {
    res.status(500).json({ message: 'Failed to verify token' });
  }
});

router.post('/reset-password-confirm', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const user = await User.findById(payload._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = password;
    await user.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

export default router;