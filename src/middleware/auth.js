import jwt from 'jsonwebtoken';
import User from '../models/user.js';

const auth = async (req, res, next) => {
  try {
    // Try to get token from Authorization header or cookies
    let token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token && req.cookies?.token) {
      token = req.cookies.token;
    }
    
    if (!token) {
      return res.status(401).json({ error: 'Please authenticate', message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      return res.status(401).json({ error: 'Token expired', message: 'Token has expired' });
    }
    
    const user = await User.findById(decoded._id);

    if (!user) {
      return res.status(401).json({ error: 'User not found', message: 'User not found' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ error: 'User is blocked', message: 'Your account has been blocked' });
    }

    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    res.status(401).json({ error: 'Please authenticate', message: error.message });
  }
};

export default auth;