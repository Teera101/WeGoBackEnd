import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import User from '../models/user.js';
import Profile from '../models/profile.js';
import auth from '../middleware/auth.js';

const router = express.Router();
const otpStore = new Map();

const createTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error('[CONFIG ERROR] Missing EMAIL_USER or EMAIL_PASSWORD');
    return null;
  }

  const host = process.env.EMAIL_HOST || 'smtp.resend.com';
  const port = parseInt(process.env.EMAIL_PORT || '465');
  const secure = process.env.EMAIL_SECURE === 'true' || port === 465;

  return nodemailer.createTransport({
    host: host,
    port: port,
    secure: secure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

const verifyEmailConnection = async () => {
  console.log('[INFO] Checking email configuration...');
  const transporter = createTransporter();
  if (!transporter) {
    console.log('[WARN] Email config missing, skipping verification');
    return;
  }
  try {
    await transporter.verify();
    console.log('[INFO] Email server ready');
  } catch (error) {
    console.error('[ERROR] Email connection failed:', error.message);
  }
};

verifyEmailConnection();

const sendOTPEmail = async (email, otp) => {
  const sender = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
      <div style="background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <h1 style="color: #0f172a; text-align: center;">Reset Password</h1>
        <p style="color: #475569; margin-bottom: 24px;">Use this OTP to reset your password (valid for 10 mins):</p>
        <div style="background: #f1f5f9; padding: 24px; text-align: center; margin-bottom: 24px; border-radius: 12px;">
          <span style="font-size: 32px; font-weight: bold; color: #0f172a; letter-spacing: 8px;">${otp}</span>
        </div>
      </div>
    </div>
  `;

  try {
    const transporter = createTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: `"WeGo Security" <${sender}>`,
        to: email,
        subject: 'WeGo - Password Reset OTP',
        html: emailHtml
      });
      console.log(`[INFO] OTP sent to ${email} using ${sender}`);
      return { success: true };
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV MODE] OTP for ${email}: ${otp}`);
      return { success: true, devMode: true };
    }
    return { success: false, error: 'Email provider missing' };
  } catch (error) {
    console.error(`[ERROR] Send OTP failed:`, error.message);
    return { success: false, error: error.message };
  }
};

const sendResetEmail = async (email, token) => {
  const sender = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  const frontendUrl = process.env.CLIENT_URL || 'http://localhost:3000';
  const cleanUrl = frontendUrl.replace(/\/$/, '');
  const resetLink = `${cleanUrl}/auth/reset-password-confirm?token=${token}`;
  
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #0f172a;">Reset Password Link</h2>
        <p>Click below to reset your password (expires in 1 hour):</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="font-size: 12px; color: #94a3b8;">Link: ${resetLink}</p>
      </div>
    </div>
  `;

  try {
    const transporter = createTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: `"WeGo Security" <${sender}>`,
        to: email,
        subject: 'WeGo - Password Reset Link',
        html: emailHtml
      });
      console.log(`[INFO] Reset link sent to ${email} using ${sender}`);
      return { success: true };
    }
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV MODE] Link for ${email}: ${resetLink}`);
      return { success: true, devMode: true };
    }
    return { success: false };
  } catch (error) {
    console.error('[ERROR] Send Link failed:', error.message);
    return { success: false };
  }
};

router.post('/register', async (req, res) => {
  try {
    const userData = { ...req.body };
    if (userData.username) userData.username = userData.username.trim();
    
    const user = new User(userData);
    await user.save();
    
    const profile = new Profile({
      userId: user._id,
      name: user.username || user.email.split('@')[0],
      bio: '',
      avatar: ''
    });
    await profile.save();
    
    const token = jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET);
    res.status(201).json({ user, token });
  } catch (error) {
    console.error('[ERROR] Register:', error.message);
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
      user = await User.findOne({ username });
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
    console.error('[ERROR] Login:', error.message);
    res.status(400).json({ error: error.message });
  }
});

router.get('/me', auth, async (req, res) => {
  res.json(req.user);
});

router.post('/logout', auth, async (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ message: 'If the email exists, an OTP has been sent' });

    if (otpStore.has(email.toLowerCase())) {
      const old = otpStore.get(email.toLowerCase());
      clearTimeout(old.timeoutId);
      otpStore.delete(email.toLowerCase());
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    const timeoutId = setTimeout(() => {
      otpStore.delete(email.toLowerCase());
    }, 10 * 60 * 1000);

    otpStore.set(email.toLowerCase(), { otp, expiresAt, timeoutId });

    const result = await sendOTPEmail(email, otp);
    
    if (!result.success && !result.devMode) {
      otpStore.delete(email.toLowerCase());
      console.error(`[ERROR] Failed to send OTP to ${email}: ${result.error}`);
    }
    
    res.json({ 
      message: 'If the email exists, an OTP has been sent',
      devOTP: result.devMode ? otp : undefined
    });
  } catch (error) {
    console.error('[ERROR] Forgot Password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const stored = otpStore.get(email.toLowerCase());
    if (!stored) return res.status(400).json({ error: 'OTP expired or not found' });
    if (stored.expiresAt < Date.now()) {
      otpStore.delete(email.toLowerCase());
      return res.status(400).json({ error: 'OTP expired' });
    }
    if (stored.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.password = newPassword;
    await user.save();

    clearTimeout(stored.timeoutId);
    otpStore.delete(email.toLowerCase());

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[ERROR] Reset Password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/forgot-password-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ message: 'If the email exists, a reset link has been sent' });

    if (!process.env.JWT_SECRET) {
      console.error('[ERROR] JWT_SECRET missing');
      return res.status(500).json({ error: 'Server config error' });
    }

    const token = jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const result = await sendResetEmail(email, token);

    res.json({ 
      message: 'If the email exists, a reset link has been sent', 
      devLinkToken: result.devMode ? token : undefined 
    });
  } catch (error) {
    console.error('[ERROR] Forgot Password Link:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

router.post('/verify-reset-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token is required' });

    let payload;
    try {
      if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const user = await User.findById(payload._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ email: user.email });
  } catch (error) {
    console.error('[ERROR] Verify Token:', error);
    res.status(500).json({ message: 'Failed to verify token' });
  }
});

router.post('/reset-password-confirm', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 chars' });

    let payload;
    try {
      if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const user = await User.findById(payload._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = password;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[ERROR] Reset Confirm:', error);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

export default router;