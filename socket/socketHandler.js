const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const ChatRoom = require('../models/ChatRoom');
const SupportQuery = require('../models/SupportQuery');
const SupportTicket = require('../models/SupportTicket');

// Store active connections
const activeConnections = new Map();
const roomConnections = new Map();

// Initialize Socket.IO
const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        process.env.ADMIN_FRONTEND_URL || 'http://localhost:5174',
        process.env.BACKEND_URL || 'http://localhost:5175',
        'https://handicraft-user.vercel.app',
        'https://handicarft-user.vercel.app',
        'https://handicraft-admin.vercel.app',
        'https://handicraft-admin-pi.vercel.app',
        'https://handicraft-admin-iota.vercel.app',
        'https://handicarft-backend.onrender.com',
      ],
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.replace('Bearer ', '') ||
                   socket.handshake.headers.Authorization?.replace('Bearer ', '');
      
      console.log('Socket auth attempt:', {
        hasAuthToken: !!socket.handshake.auth.token,
        hasHeaderAuth: !!socket.handshake.headers.authorization,
        hasHeaderAuth2: !!socket.handshake.headers.Authorization,
        token: token ? token.substring(0, 20) + '...' : 'none'
      });
      
      if (!token) {
        // Allow guest connections for customer support
        socket.userId = 'guest_' + socket.id;
        socket.userType = 'customer';
        socket.userName = 'Guest User';
        socket.userEmail = 'guest@example.com';
        console.log('No token provided, allowing as guest');
        return next();
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id || decoded.userId;
        // Check for admin type from JWT token
        socket.userType = decoded.type === 'admin' || decoded.isAdmin ? 'admin' : (decoded.userType || 'customer');
        socket.userName = decoded.name || decoded.userName || 'User';
        socket.userEmail = decoded.email || decoded.userEmail || 'user@example.com';
        console.log('Socket authenticated user:', { 
          userId: socket.userId, 
          userName: socket.userName, 
          userType: socket.userType,
          isAdmin: decoded.isAdmin,
          type: decoded.type,
          role: decoded.role
        });
      } catch (jwtError) {
        // If JWT is expired or invalid, try to refresh or allow as guest
        console.log('JWT expired or invalid, allowing as guest:', jwtError.message);
        socket.userId = 'guest_' + socket.id;
        socket.userType = 'customer';
        socket.userName = 'Guest User';
        socket.userEmail = 'guest@example.com';
      }
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      // Allow guest connections even if auth fails
      socket.userId = 'guest_' + socket.id;
      socket.userType = 'customer';
      socket.userName = 'Guest User';
      socket.userEmail = 'guest@example.com';
      next();
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId} (${socket.userType})`);
    
    // Store connection
    activeConnections.set(socket.userId, {
      socketId: socket.id,
      userId: socket.userId,
      userType: socket.userType,
      userName: socket.userName,
      userEmail: socket.userEmail,
      connectedAt: new Date(),
      isOnline: true
    });

    // Join user to their personal room
    socket.join(`user_${socket.userId}`);

    // Handle admin joining admin room
    socket.on('join_admin_room', () => {
      if (socket.userType === 'admin' || socket.userType === 'super_admin') {
        socket.join('admin_room');
        console.log(`Admin ${socket.userId} joined admin_room`);
        console.log('Admin room participants:', io.sockets.adapter.rooms.get('admin_room')?.size || 0);
      } else {
        console.log(`User ${socket.userId} (${socket.userType}) tried to join admin_room but is not admin`);
      }
    });

    // Handle joining support chat room
    socket.on('join_support_room', async (data) => {
      try {
        const { roomId } = data;
        
        if (!roomId) {
          socket.emit('error', { message: 'Room ID is required' });
          return;
        }

        // Find or create chat room
        let room = await ChatRoom.findOne({ roomId: roomId });
        
        if (!room) {
          // Create new room if it doesn't exist
          // Extract user info from roomId if socket.userName is Guest User
          let displayName = socket.userName;
          if (socket.userName === 'Guest User' && roomId.includes('support_')) {
            // Try to get user info from roomId or database
            const userIdFromRoomId = roomId.split('_')[1];
            if (userIdFromRoomId && userIdFromRoomId !== 'guest') {
              try {
                const User = require('../models/User');
                const user = await User.findById(userIdFromRoomId);
                if (user) {
                  displayName = user.name || user.email || 'User';
                  socket.userName = displayName;
                  socket.userEmail = user.email;
                }
              } catch (err) {
                console.log('Could not fetch user info:', err.message);
              }
            }
          }
          
          room = new ChatRoom({
            roomId: roomId,
            roomName: `Support Chat - ${displayName}`,
            roomType: 'customer_support',
            participants: [{
              userId: socket.userId,
              userType: socket.userType,
              userName: displayName,
              userEmail: socket.userEmail,
              joinedAt: new Date(),
              lastSeenAt: new Date(),
              isActive: true
            }]
          });
          await room.save();
        } else {
          // Add participant if not already in room
          const existingParticipant = room.participants.find(p => p.userId === socket.userId);
          if (!existingParticipant) {
            room.participants.push({
              userId: socket.userId,
              userType: socket.userType,
              userName: socket.userName,
              userEmail: socket.userEmail,
              joinedAt: new Date(),
              lastSeenAt: new Date(),
              isActive: true
            });
            await room.save();
          }
        }

        // Join socket room
        socket.join(roomId);
        
        // Track room connections
        if (!roomConnections.has(roomId)) {
          roomConnections.set(roomId, new Set());
        }
        roomConnections.get(roomId).add(socket.userId);

        // Notify room about new participant
        socket.to(roomId).emit('user_joined', {
          userId: socket.userId,
          userName: socket.userName,
          userType: socket.userType,
          timestamp: new Date()
        });

        // Send room info to user
        socket.emit('room_joined', {
          _id: room._id,
          roomId: room.roomId,
          roomName: room.roomName,
          participants: room.participants,
          messages: room.messages.slice(-50) // Last 50 messages
        });

        console.log(`User ${socket.userId} joined room ${roomId}`);
      } catch (error) {
        console.error('Error joining support room:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
      try {
        const { roomId, message, messageType = 'text' } = data;
        
        if (!roomId || !message) {
          socket.emit('error', { message: 'Room ID and message are required' });
          return;
        }

        // Find room
        const room = await ChatRoom.findOne({ roomId: roomId });
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Create message
        const messageData = {
          messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          senderId: socket.userId,
          senderName: socket.userName,
          senderType: socket.userType,
          message: message,
          messageType: messageType,
          attachments: [],
          isRead: false,
          readBy: [],
          createdAt: new Date()
        };

        // Add message to room
        room.messages.push(messageData);
        room.lastMessageAt = new Date();
        room.lastActivityAt = new Date();
        room.messageCount += 1;
        await room.save();

        // Broadcast message to all room participants
        io.to(roomId).emit('new_message', {
          ...messageData,
          roomId: roomId
        });

        // Send typing stop event
        socket.to(roomId).emit('typing_stop', {
          userId: socket.userId,
          userName: socket.userName
        });

        console.log(`Message sent in room ${roomId} by ${socket.userId}`);
      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data) => {
      const { roomId } = data;
      if (roomId) {
        socket.to(roomId).emit('typing_start', {
          userId: socket.userId,
          userName: socket.userName
        });
      }
    });

    socket.on('typing_stop', (data) => {
      const { roomId } = data;
      if (roomId) {
        socket.to(roomId).emit('typing_stop', {
          userId: socket.userId,
          userName: socket.userName
        });
      }
    });

    // Handle message read status
    socket.on('mark_messages_read', async (data) => {
      try {
        const { roomId } = data;
        
        if (!roomId) return;

        const room = await ChatRoom.findOne({ roomId: roomId });
        if (!room) return;

        // Mark messages as read
        room.messages.forEach(message => {
          if (!message.readBy.some(r => r.userId === socket.userId)) {
            message.readBy.push({
              userId: socket.userId,
              readAt: new Date()
            });
          }
        });

        // Update participant's last seen
        const participant = room.participants.find(p => p.userId === socket.userId);
        if (participant) {
          participant.lastSeenAt = new Date();
        }

        await room.save();

        // Notify other participants
        socket.to(roomId).emit('messages_read', {
          userId: socket.userId,
          userName: socket.userName,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });

    // Handle support query updates
    socket.on('query_status_update', async (data) => {
      try {
        const { queryId, status, response } = data;
        
        if (!queryId) return;

        const query = await SupportQuery.findById(queryId);
        if (!query) return;

        // Update query status
        query.status = status;
        query.lastActivityAt = new Date();

        // Add response if provided
        if (response) {
          query.responses.push({
            message: response,
            sender: 'admin',
            senderName: 'Admin',
            senderEmail: 'admin@rikocraft.com',
            createdAt: new Date()
          });
        }

        await query.save();

        // Notify customer about update
        io.to(`user_${query.customerEmail}`).emit('query_updated', {
          queryId: query._id,
          status: query.status,
          response: response,
          timestamp: new Date()
        });

        console.log(`Query ${queryId} status updated to ${status}`);
      } catch (error) {
        console.error('Error updating query status:', error);
      }
    });

    // Handle support ticket updates
    socket.on('ticket_status_update', async (data) => {
      try {
        const { ticketId, status, message } = data;
        
        if (!ticketId) return;

        const ticket = await SupportTicket.findById(ticketId);
        if (!ticket) return;

        // Update ticket status
        ticket.status = status;
        ticket.lastActivityAt = new Date();

        // Add message if provided
        if (message) {
          ticket.messages.push({
            message: message,
            sender: 'admin',
            senderName: 'Admin',
            senderEmail: 'admin@rikocraft.com',
            isInternal: false,
            createdAt: new Date()
          });
        }

        await ticket.save();

        // Notify customer about update
        io.to(`user_${ticket.customerEmail}`).emit('ticket_updated', {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          status: ticket.status,
          message: message,
          timestamp: new Date()
        });

        console.log(`Ticket ${ticketId} status updated to ${status}`);
      } catch (error) {
        console.error('Error updating ticket status:', error);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
      
      // Remove from active connections
      activeConnections.delete(socket.userId);
      
      // Remove from room connections and notify only once
      const userRooms = [];
      roomConnections.forEach((users, roomId) => {
        if (users.has(socket.userId)) {
          userRooms.push(roomId);
          users.delete(socket.userId);
          if (users.size === 0) {
            roomConnections.delete(roomId);
          }
        }
      });
      
      // Notify only the rooms the user was actually in
      userRooms.forEach(roomId => {
        socket.to(roomId).emit('user_left', {
          userId: socket.userId,
          userName: socket.userName,
          timestamp: new Date()
        });
      });
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  return io;
};

// Utility functions
const getActiveConnections = () => {
  return Array.from(activeConnections.values());
};

const getRoomConnections = (roomId) => {
  return roomConnections.get(roomId) || new Set();
};

const broadcastToRoom = (io, roomId, event, data) => {
  io.to(roomId).emit(event, data);
};

const broadcastToUser = (io, userId, event, data) => {
  io.to(`user_${userId}`).emit(event, data);
};

const broadcastToAdmins = (io, event, data) => {
  activeConnections.forEach((connection) => {
    if (connection.userType === 'admin' || connection.userType === 'super_admin') {
      io.to(connection.socketId).emit(event, data);
    }
  });
};

module.exports = {
  initializeSocket,
  getActiveConnections,
  getRoomConnections,
  broadcastToRoom,
  broadcastToUser,
  broadcastToAdmins
};
