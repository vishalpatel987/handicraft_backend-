const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const Admin = require('../models/Admin');

// Check if any admin exists in the system
const checkAdminExists = async () => {
  const adminCount = await Admin.countDocuments({ isActive: true });
  return adminCount > 0;
};

// Admin signup - Only allow if no admin exists
const adminSignup = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!email || !password || !username) {
      return res.status(400).json({ message: 'Username, email and password are required' });
    }

    // Check if any admin already exists
    const adminExists = await checkAdminExists();
    if (adminExists) {
      return res.status(403).json({ 
        message: 'Admin account already exists. Please login instead.' 
      });
    }

    // Check if admin with this email already exists (inactive)
    const existingAdminByEmail = await Admin.findOne({ email });
    if (existingAdminByEmail) {
      return res.status(409).json({ message: 'Admin with this email already exists' });
    }

    // Check if admin with this username already exists
    const existingAdminByUsername = await Admin.findOne({ username });
    if (existingAdminByUsername) {
      return res.status(409).json({ message: 'Admin with this username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = new Admin({ 
      username, 
      email, 
      password: hashedPassword,
      role: 'super_admin' // First admin becomes super admin
    });
    await admin.save();

    // Generate JWT token for immediate login
    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        isAdmin: true,
        role: admin.role,
        type: 'admin'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.status(201).json({ 
      message: 'Admin registered successfully',
      token,
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Admin login
const adminLogin = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if ((!username && !email) || !password) {
      return res.status(400).json({ message: 'Email/Username and password are required' });
    }
    
    // Find admin by email or username
    const admin = await Admin.findOne(email ? { email } : { username });
    if (!admin) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(403).json({ message: 'Admin account is deactivated' });
    }
    
    // Compare password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();
    
    // Use a consistent JWT secret - ensure it's the same as in middleware
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    
    // Generate JWT with admin-specific claims
    const token = jwt.sign(
      {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        isAdmin: true,
        role: admin.role,
        type: 'admin' // Add type to distinguish from other tokens
      },
      jwtSecret,
      { expiresIn: '24h' }
    );
    
    console.log('Admin login successful:', { id: admin._id, email: admin.email, role: admin.role });
    
    res.json({
      success: true,
      token,
      user: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        isAdmin: true,
        role: admin.role,
        lastLogin: admin.lastLogin
      },
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update admin credentials
const updateAdminCredentials = async (req, res) => {
  try {
    const { username, email, currentPassword, newPassword } = req.body;
    const adminId = req.user.id; // From JWT token

    // Find the admin
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, admin.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Prepare update object
    const updateData = {};
    
    if (username && username.trim() !== '') {
      updateData.username = username.trim();
    }
    
    if (email && email.trim() !== '') {
      // Check if email is already taken by another admin
      const existingAdmin = await Admin.findOne({ email: email.trim(), _id: { $ne: adminId } });
      if (existingAdmin) {
        return res.status(409).json({ message: 'Email is already taken by another admin' });
      }
      updateData.email = email.trim().toLowerCase();
    }
    
    if (newPassword && newPassword.trim() !== '') {
      // Hash new password
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    // Update admin
    const updatedAdmin = await Admin.findByIdAndUpdate(
      adminId,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Admin credentials updated successfully',
      user: {
        id: updatedAdmin._id,
        username: updatedAdmin.username,
        email: updatedAdmin.email,
        isAdmin: true,
        role: updatedAdmin.role,
        lastLogin: updatedAdmin.lastLogin
      }
    });
  } catch (error) {
    console.error('Update admin credentials error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Admin token verification endpoint
const verifyAdminToken = async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret);
    
    // Check if it's an admin token
    if (!decoded.isAdmin || (decoded.role !== 'admin' && decoded.role !== 'super_admin')) {
      return res.status(403).json({ message: 'Not an admin token' });
    }

    res.json({
      valid: true,
      user: {
        id: decoded.id,
        username: decoded.username,
        email: decoded.email,
        isAdmin: decoded.isAdmin,
        role: decoded.role
      }
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Check admin registration status
const checkAdminStatus = async (req, res) => {
  try {
    // Add CORS headers explicitly
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    
    const adminExists = await checkAdminExists();
    res.json({
      adminExists,
      message: adminExists 
        ? 'Admin account exists. Please login to continue.' 
        : 'No admin account found. Please register as the first admin.'
    });
  } catch (error) {
    console.error('Check admin status error:', error);
    // Add CORS headers even on error
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Email template function for admin OTP
const sendAdminOTPEmail = async (email, otp, adminName) => {
  const subject = 'Riko Craft Admin - Password Reset OTP';
  
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
      <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #333; margin: 0; font-size: 24px;">Riko Craft Admin</h1>
          <p style="color: #666; margin: 5px 0; font-size: 14px;">Password Reset Request</p>
        </div>
        
        <div style="margin-bottom: 25px;">
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0;">
            Dear <strong>${adminName}</strong>,
          </p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 15px 0;">
            You have requested to reset your password for the Riko Craft Admin Panel.
          </p>
          <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 15px 0;">
            Please use the One-Time Password (OTP) given below to reset your password:
          </p>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; margin: 25px 0;">
          <p style="color: #333; font-size: 14px; margin: 0 0 10px 0;">🔐 Your Admin OTP is:</p>
          <div style="background-color: #772a4b; color: white; padding: 15px; border-radius: 6px; font-size: 24px; font-weight: bold; letter-spacing: 3px;">
            ${otp}
          </div>
        </div>
        
        <div style="margin: 25px 0; padding: 15px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
          <p style="color: #856404; font-size: 14px; margin: 0; line-height: 1.5;">
            <strong>⚠️ Important:</strong> This OTP is valid for the next 10 minutes only. Please do not share this code with anyone for your security.
          </p>
        </div>
        
        <div style="margin: 25px 0;">
          <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0;">
            If you did not request this password reset, please ignore this email.
          </p>
        </div>
        
        <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          <p style="color: #666; font-size: 14px; margin: 0; line-height: 1.6;">
            <strong>Warm regards,</strong><br>
            Riko Craft Admin Team
          </p>
          <div style="margin-top: 15px; color: #666; font-size: 12px;">
            <p style="margin: 5px 0;">🌐 www.rikocraft.com</p>
            <p style="margin: 5px 0;">📩 Email: Care@Rikocraft.com</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const textBody = `
Dear ${adminName},

You have requested to reset your password for the Riko Craft Admin Panel.

🔐 Your Admin OTP is: ${otp}

This OTP is valid for the next 10 minutes only. Please do not share this code with anyone for your security.

If you did not request this password reset, please ignore this email.

Warm regards,
Riko Craft Admin Team
🌐 www.rikocraft.com
📩 Email: Care@Rikocraft.com
  `;

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      text: textBody,
      html: htmlBody
    });
    console.log(`Admin OTP email sent to ${email}`);
  } catch (mailErr) {
    console.error('Error sending admin OTP email:', mailErr);
    throw mailErr;
  }
};

// Forgot Password - Send OTP (like user system)
// =======================
const adminForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const admin = await Admin.findOne({ email });
    if (!admin) {
      // Don't reveal if admin exists or not for security
      return res.json({ message: 'If an admin account exists with this email, an OTP has been sent' });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.json({ message: 'If an admin account exists with this email, an OTP has been sent' });
    }

    // Generate OTP and expiry (10 minutes)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP in admin record
    admin.resetPasswordOTP = otp;
    admin.resetPasswordExpires = expiresAt;
    await admin.save();

    // Send OTP via email (with fallback to console for development)
    try {
      await sendAdminOTPEmail(email, otp, admin.username || admin.email);
      console.log(`Admin OTP sent to: ${email}`);
    } catch (mailErr) {
      console.error('Error sending admin OTP email:', mailErr);
      // For development: show OTP in console if email fails
      console.log('\n=== ADMIN OTP (DEVELOPMENT MODE) ===');
      console.log(`Email: ${email}`);
      console.log(`OTP: ${otp}`);
      console.log('Use this OTP to reset password');
      console.log('=====================================\n');
    }

    res.json({ message: 'If an admin account exists with this email, an OTP has been sent' });

    // Email sending code (commented out for development)
    /*
    // Check if email configuration exists
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('Email configuration missing. Please set EMAIL_USER and EMAIL_PASS environment variables.');
      
      // For development: show reset link in console
      const resetLink = `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174'}/admin/reset-password/${token}`;
      console.log('\n=== PASSWORD RESET LINK (DEVELOPMENT MODE) ===');
      console.log(`Reset Link: ${resetLink}`);
      console.log('Copy this link and open in browser to reset password');
      console.log('===============================================\n');
      
      return res.json({ 
        message: 'Password reset link generated. Check server console for the link (development mode).' 
      });
    }

    // Send email with reset link
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const resetLink = `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174'}/admin/reset-password/${token}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Riko Craft Admin - Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #333; margin: 0; font-size: 24px;">Riko Craft Admin</h1>
              <p style="color: #666; margin: 5px 0; font-size: 14px;">Password Reset Request</p>
            </div>
            <div style="margin-bottom: 25px;">
              <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0;">
                Hello Admin,
              </p>
              <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 15px 0;">
                You have requested to reset your password for the Riko Craft Admin Panel. Click the button below to reset your password:
              </p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #772a4b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                Reset Password
              </a>
            </div>
            <div style="margin: 25px 0;">
              <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0;">
                This link will expire in 15 minutes for security purposes.
              </p>
              <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 15px 0;">
                If you didn't request this password reset, please ignore this email.
              </p>
            </div>
            <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
              <p style="color: #666; font-size: 14px; margin: 0; line-height: 1.6;">
                <strong>Warm regards,</strong><br>
                Riko Craft Admin Team
              </p>
              <div style="margin-top: 15px; color: #666; font-size: 12px;">
                <p style="margin: 5px 0;">🌐 www.rikocraft.com</p>
                <p style="margin: 5px 0;">📩 Email: Care@Rikocraft.com</p>
              </div>
            </div>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to: ${email}`);

    res.json({ message: 'If an admin account exists with this email, a reset link has been sent' });
    */
  } catch (err) {
    console.error('Forgot password error:', err);
    
    // Handle specific nodemailer errors
    if (err.code === 'EAUTH') {
      return res.status(500).json({ 
        message: 'Email authentication failed. Please check email configuration.' 
      });
    }
    
    if (err.code === 'ECONNECTION') {
      return res.status(500).json({ 
        message: 'Email service connection failed. Please try again later.' 
      });
    }

    res.status(500).json({ 
      message: 'Failed to send reset email. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

// =======================
// Verify Admin OTP and Reset Password
// =======================
const adminVerifyOTPAndResetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP, and new password are required' });
    }

    // Validate password strength
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Find the admin
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(403).json({ message: 'Admin account is deactivated' });
    }

    // Verify OTP
    if (!admin.resetPasswordOTP || admin.resetPasswordOTP !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Check if OTP has expired
    if (!admin.resetPasswordExpires || admin.resetPasswordExpires < new Date()) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    admin.password = hashedPassword;
    admin.lastPasswordChange = new Date();
    admin.resetPasswordOTP = null; // Clear OTP after use
    admin.resetPasswordExpires = null; // Clear expiry
    await admin.save();

    console.log(`Password reset successful for admin: ${admin.email}`);

    res.json({ 
      message: 'Password reset successful. You can now login with your new password.',
      success: true
    });
  } catch (err) {
    console.error('Admin OTP verification and reset error:', err);
    res.status(500).json({ 
      message: 'Failed to reset password. Please try again.',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
};

module.exports = {
  adminLogin,
  adminSignup,
  updateAdminCredentials,
  verifyAdminToken,
  checkAdminStatus,
  adminForgotPassword,
  adminVerifyOTPAndResetPassword
}; 