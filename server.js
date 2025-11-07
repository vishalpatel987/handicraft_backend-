// File: admin/backend/server.js
require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const shopRoutes = require("./routes/shop");
const orderRoutes = require("./routes/orders");
const authRoutes = require('./routes/auth'); // Assuming your auth routes are here
const adminAuthRoutes = require('./routes/adminAuth'); // Admin authentication routes
const lovedRoutes = require('./routes/loved'); // Assuming your loved routes are here
const categoryRoutes = require('./routes/category');
const featuredProductRoutes = require('./routes/featuredProduct');
const bestSellerRoutes = require('./routes/bestSeller');
const cartRoutes = require('./routes/cart');
const fs = require('fs');
const heroCarouselRoutes = require('./routes/heroCarousel');

const couponRoutes = require('./routes/coupon');
const blogRoutes = require('./routes/blog');
const announcementRoutes = require('./routes/announcement');
const wishlistRoutes = require('./routes/wishlist');
const crypto = require('crypto');
const settingsController = require('./controllers/settingsController');
const { initializeSocket } = require('./socket/socketHandler');
const app = express();

// Generate a random JWT secret for seller authentication if not provided


// CORS configuration - Allow specific origins for production
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174',
  process.env.BACKEND_URL || 'http://localhost:5175',
  'https://handicraft-user.vercel.app',
  'https://handicarft-user.vercel.app', // legacy typo support
  'https://handicraft-admin.vercel.app',
  'https://handicraft-admin-pi.vercel.app',
  'https://handicraft-admin-iota.vercel.app',
  'https://handicarft-backend.onrender.com',
  // Add any additional production domains above this line
];

function isVercelPreview(origin) {
  const previewPatterns = [
    /^https:\/\/handicraft-(admin|user)-.*\.vercel\.app$/,
    /^https:\/\/handicarft-(admin|user)-.*\.vercel\.app$/
  ];
  return previewPatterns.some((pattern) => pattern.test(origin));
}

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Always allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Check allowed origins
    if (allowedOrigins.includes(origin) || isVercelPreview(origin)) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      console.log('Allowed origins:', allowedOrigins);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Origin', 'Content-Length'],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Additional CORS headers for all routes
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Always allow localhost for development
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Length');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    return next();
  }
  
  // Check allowed origins for production
  if (origin && (allowedOrigins.includes(origin) || isVercelPreview(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Content-Length');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(cookieParser());

// Database health check middleware
app.use((req, res, next) => {
  const dbState = mongoose.connection.readyState;
  
  // Allow health check endpoint even if DB is not ready
  if (req.path === '/health') {
    return next();
  }
  
  if (dbState !== 1) {
    console.warn('⚠️ Database not ready, state:', dbState, 'for path:', req.path);
    
    // For critical operations, return 503
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      // Special handling for cart clear operations - allow them to fail gracefully
      if (req.path.includes('/cart/clear')) {
        console.warn('⚠️ Allowing cart clear with DB state:', dbState);
        return next();
      }
      
      return res.status(503).json({
        success: false,
        message: 'Database temporarily unavailable. Please try again in a moment.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }
    
    // For GET requests, allow with warning
    console.warn('⚠️ Allowing GET request with DB state:', dbState);
  }
  
  next();
});

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure data directories exist
const dataDir = path.join(__dirname, 'data');
const userProductDir = path.join(dataDir, 'userproduct');

// Create directories if they don't exist
[dataDir, userProductDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('Created directory:', dir);
  }
});

// Serve static files with proper MIME types
app.use('/pawnbackend/data', (req, res, next) => {
  const filePath = path.join(__dirname, 'data', req.path);
  const ext = path.extname(filePath).toLowerCase();
  
  // Set proper content type for videos and images
  if (ext === '.mp4') {
    res.setHeader('Content-Type', 'video/mp4');
  } else if (ext === '.png') {
    res.setHeader('Content-Type', 'image/png');
  } else if (ext === '.jpg' || ext === '.jpeg') {
    res.setHeader('Content-Type', 'image/jpeg');
  } else if (ext === '.gif') {
    res.setHeader('Content-Type', 'image/gif');
  }
  
  next();
}, express.static(path.join(__dirname, 'data'), {
  fallthrough: true,
  maxAge: '1h'
}));

// MongoDB Connection URL from environment variable
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://vishalpatel581012:7Gjs2vOB9X6uGw7j@binkeyit.mncq203.mongodb.net/Ricro_Craft?retryWrites=true&w=majority&appName=Binkeyit";

// MongoDB Connection with retry logic and better error handling
const connectWithRetry = async () => {
  try {
    console.log('🔄 Attempting to connect to MongoDB...');
    
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000, // 10 seconds
      socketTimeoutMS: 20000, // 20 seconds
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 10000,
      connectTimeoutMS: 10000,
      retryWrites: true,
      retryReads: true
    });
    
    console.log('✅ MongoDB connected successfully!');
    console.log('📊 Database:', mongoose.connection.db.databaseName);
    console.log('🔗 Connection state:', mongoose.connection.readyState);
    
    // Initialize default settings after successful connection
    try {
      await settingsController.initializeDefaultSettings();
      console.log('✅ Default settings initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize default settings:', error);
    }
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected. Attempting to reconnect...');
      setTimeout(connectWithRetry, 5000);
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected successfully!');
    });
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('🔄 Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  }
};

// Start connection
connectWithRetry();

// Health check endpoint
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: {
      state: dbStates[dbState] || 'unknown',
      readyState: dbState,
      connected: dbState === 1
    },
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// API Routes
app.use("/api/shop", shopRoutes);
app.use("/api/orders", orderRoutes);
app.use('/api/bestseller', bestSellerRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin/auth', adminAuthRoutes); // Admin authentication routes
app.use('/api/admin/users', require('./routes/users')); // Admin user management routes
app.use('/api/loved', lovedRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/featured-products', featuredProductRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/hero-carousel', heroCarouselRoutes);

app.use('/api/coupons', couponRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/data-page', require('./routes/dataPage'));
app.use('/api/payment', require('./routes/payment'));

app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/support', require('./routes/support'));
// app.use('/api/notifications', require('./routes/notifications')); // Temporarily disabled
app.use('/api/msg91', require('./routes/msg91'));
app.use('/api/user-activity', require('./routes/userActivity'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Test endpoint for CORS
app.get('/test-cors', (req, res) => {
  res.status(200).json({
    message: 'CORS is working correctly',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    console.error('Stack:', err.stack);
    res.status(500).json({ 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// Port from environment variable
const PORT = process.env.PORT || 5175;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📡 Health check available at: http://localhost:${PORT}/health`);
});

// Initialize Socket.IO
const io = initializeSocket(server);
console.log(`🔌 Socket.IO server initialized`);

// Make io available globally for other modules
app.set('io', io);
global.io = io;

// Set socket instance in support controller
const { setSocketInstance } = require('./controllers/supportController');
setSocketInstance(io);
console.log('Socket instance set in support controller'); 




