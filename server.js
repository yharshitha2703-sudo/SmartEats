// server.js
// =========================
//    IMPORTS
// =========================
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const adminRoutes = require('./routes/adminRoutes');
const client = require('prom-client');
const path = require('path');

dotenv.config();

// =========================
//    EXPRESS APP
// =========================
const app = express();

// ================= PROMETHEUS METRICS =================
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 3, 5]
});

register.registerMetric(httpRequestCounter);
register.registerMetric(httpRequestDuration);

app.use(cors());
app.use(express.json());

// metrics middleware
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const diff = Number(process.hrtime.bigint() - start) / 1e9; // seconds
    const route = req.route && req.route.path ? req.route.path : req.path;

    httpRequestCounter.inc({
      method: req.method,
      route,
      status: res.statusCode
    });

    httpRequestDuration.observe(
      { method: req.method, route, status: res.statusCode },
      diff
    );
  });

  next();
});

// expose metrics for Prometheus
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// =========================
//    ROUTES
// =========================
const deliveryRoutes = require('./routes/deliveryRoutes');
const authRoutes = require('./routes/authRoutes');
const restaurantRoutes = require('./routes/restaurantRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const searchRoutes = require('./routes/searchRoutes');

app.use('/api/search', searchRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
const jwt = require('jsonwebtoken');
const Order = require('./models/Order'); 
// test route
app.get('/', (req, res) => {
  res.send('SmartEats Backend is running 🚀');
});

// serve frontend static files if you have them (optional)
// app.use(express.static(path.join(__dirname, 'frontend')));

// =========================
//    SOCKET.IO SETUP
// =========================
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// set io into singleton helper to avoid circular require problems
// make sure you created backend/utils/socket.js with setIo/getIo
const { setIo } = require('./utils/socket');
setIo(io);

// ... after creating io:
io.use((socket, next) => {
  // token can be sent by client as: io(serverUrl, { auth: { token } })
  const token = socket.handshake?.auth?.token || socket.handshake?.query?.token;
  if (!token) {
    // Not authenticated — allow read-only connections? we will still allow but mark unauthenticated
    // To force authentication, call next(new Error('Authentication error'));
    socket.authenticated = false;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // attach user info to socket
    socket.user = decoded; // expected: { userId, role, ... }
    socket.authenticated = true;
    return next();
  } catch (err) {
    console.warn('Socket auth failed:', err.message);
    // optionally reject connection:
    // return next(new Error('Authentication error'));
    socket.authenticated = false;
    return next();
  }
});

// Then the connection handler (replace your existing io.on('connection', ...))
io.on('connection', (socket) => {
  console.log('⚡ Client connected:', socket.id);

  socket.on('joinOrder', (orderId) => {
    if (!orderId) return;
    const room = `order_${orderId}`;
    socket.join(room);
    console.log(`${socket.id} joined room ${room}`);
  });

  socket.on('leaveOrder', (orderId) => {
    if (!orderId) return;
    const room = `order_${orderId}`;
    socket.leave(room);
    console.log(`${socket.id} left room ${room}`);
  });

  // Delivery partner sends frequent location updates
  socket.on('location:update', async (payload) => {
    try {
      if (!payload || !payload.orderId) return;
      const { orderId, lat, lng, timestamp } = payload;

      // basic validation
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        console.warn('Invalid location payload from', socket.id, payload);
        return;
      }

      // If socket is authenticated, ensure the sender is allowed to update this order.
      if (socket.authenticated && socket.user && socket.user.userId) {
        // check DB that the delivery partner assigned to orderId equals socket.user.userId
        try {
          const order = await Order.findById(orderId).select('assignedTo status').lean();
          if (!order) {
            console.warn('Order not found for tracking:', orderId);
            return;
          }
          // allow if order.assignedTo equals (string or ObjectId), OR if user's role is admin
          const senderId = String(socket.user.userId || socket.user._id || socket.user.id);
          const assignedTo = order.assignedTo ? String(order.assignedTo) : null;

          if (socket.user.role !== 'admin' && assignedTo !== senderId) {
            console.warn('Unauthorized location update attempt by', senderId, 'for order', orderId);
            return;
          }
        } catch (err) {
          console.warn('Order check failed', err);
          // fail-safe: don't accept update
          return;
        }
      } else {
        // not authenticated — optionally reject or allow limited behavior
        console.warn('Unauthenticated socket attempted location update:', socket.id);
        return;
      }

      const room = `order_${orderId}`;
      const data = {
        orderId,
        lat,
        lng,
        timestamp: timestamp || Date.now(),
      };

      // Broadcast to everyone in the order room (customers who joined)
      io.to(room).emit('tracking:update', data);

      // also emit a secondary event name if your frontends listen for it
      io.to(room).emit('order:location', data);

      console.log(`location:update -> order=${orderId} from ${socket.id} lat=${lat} lng=${lng}`);
    } catch (err) {
      console.error('location:update error', err);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`❌ Client disconnected: ${socket.id} (${reason})`);
  });
});


// =========================
//    MONGO + REDIS + SERVER START
// =========================
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');

    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
  });

// =========================
//  REDIS CONNECT (optional)
// =========================
const redisClient = require('./config/redisClient');

// export app/server if other modules rely on it (do NOT export io)
module.exports = { app, server };
