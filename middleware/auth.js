//aa
const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  console.log('Auth middleware called');
  console.log('Headers:', req.headers);
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('Auth header:', authHeader);
  console.log('Token:', token ? 'Present' : 'Missing');

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    console.log('JWT Secret being used:', jwtSecret ? 'Present' : 'Missing');
    console.log('Token to verify:', token.substring(0, 20) + '...');
    
    const verified = jwt.verify(token, jwtSecret);
    console.log('Token verified successfully:', { id: verified.id, email: verified.email });
    
    // For user tokens, we don't need admin properties
    // Admin properties are only required for admin routes
    
    req.user = verified;
    next();
  } catch (error) {
    console.log('Token verification failed:', error.message);
    console.log('Error details:', error);
    res.status(400).json({ 
      message: 'Invalid token',
      error: error.message 
    });
  }
};

const isAdmin = (req, res, next) => {
  console.log('Admin check called');
  console.log('User:', req.user);
  console.log('Is admin:', req.user?.isAdmin);
  console.log('User role:', req.user?.role);
  
  if (req.user && (req.user.isAdmin === true || req.user.role === 'admin' || req.user.role === 'super_admin')) {
    console.log('Admin check passed');
    next();
  } else {
    console.error('Admin check failed:', {
      user: req.user,
      isAdmin: req.user?.isAdmin,
      role: req.user?.role
    });
    res.status(403).json({ message: 'Access denied. Admin privileges required.' });
  }
};

// Middleware for regular user authentication (no admin check)
const auth = (req, res, next) => {
  console.log('Regular auth middleware called');
  console.log('Headers:', req.headers);
  
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('Auth header:', authHeader);
  console.log('Token:', token ? 'Present' : 'Missing');

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const verified = jwt.verify(token, jwtSecret);
    console.log('Token verified:', verified);
    
    req.user = verified;
    next();
  } catch (error) {
    console.log('Token verification failed:', error.message);
    res.status(400).json({ message: 'Invalid token' });
  }
};

// Combined middleware for admin authentication
const authAdmin = (req, res, next) => {
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    isAdmin(req, res, next);
  });
};

module.exports = {
  authenticateToken,
  isAdmin,
  auth,
  authAdmin
}; 