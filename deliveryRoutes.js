// backend/routes/deliveryRoutes.js
// Delivery partner routes (register, available, auto-assign, accept, location, complete, orders/history)
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Order = require('../models/Order');
const auth = require('../middleware/authMiddleware');
const { publishToOrdersQueue } = require('../utils/rabbitmq'); // optional; if not present function checks are in place

// use the singleton socket helper to avoid circular require problems
let io = null;
try {
  const { getIo } = require('../utils/socket');
  io = getIo();
} catch (e) {
  io = null;
}


// -----------------------------
// Delivery Partner Registration
// -----------------------------
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, vehicle } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password required' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already exists' });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      role: 'delivery_partner',
      vehicle: vehicle || '',
      isAvailable: true
    });

    const userSafe = user.toObject();
    delete userSafe.password;

    res.status(201).json({ message: 'Delivery partner registered', user: userSafe });
  } catch (err) {
    console.error('Delivery register error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// -----------------------------
// Get available delivery partners
// -----------------------------
router.get('/available', auth, async (req, res) => {
  try {
    const partners = await User.find({ role: 'delivery_partner', isAvailable: true })
      .select('-password');
    res.json(partners);
  } catch (err) {
    console.error('Get available partners error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// -----------------------------
// SIMPLE AUTO-ASSIGN ALGORITHM
// Anyone with admin or restaurant_owner role can trigger this.
// POST /api/delivery/auto-assign/:orderId
// -----------------------------
router.post('/auto-assign/:orderId', auth, async (req, res) => {
  try {
    if (!['admin', 'restaurant_owner'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only admin or restaurant owner can auto-assign' });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.status === 'completed') {
      return res.status(400).json({ message: 'Order already completed' });
    }
    if (order.assignedTo) {
      return res.status(400).json({ message: 'Order already assigned' });
    }

    // pick first available partner (could be nearest or round-robin)
    const partner = await User.findOne({
      role: 'delivery_partner',
      isAvailable: true
    }).sort({ updatedAt: 1 });

    if (!partner) {
      return res.status(409).json({ message: 'No available delivery partners' });
    }

    // assign and set status
        // assign and set canonical 'assigned' status (owner assignment)
    order.assignedTo = partner._id;
    order.status = 'assigned';
    await order.save();

    partner.isAvailable = false;
    await partner.save();

    // notify socket listeners (non-fatal)
    try {
      if (io) {
        io.to(`order_${order._id.toString()}`).emit('order:update', {
          orderId: order._id,
          status: order.status,
          assignedTo: order.assignedTo,
          updatedAt: order.updatedAt
        });
      }
    } catch (emitErr) {
      console.error('Socket emit error (auto-assign):', emitErr && emitErr.stack ? emitErr.stack : emitErr);
    }

    // publish to queue if available (non-fatal)
    try {
      if (typeof publishToOrdersQueue === 'function') {
        await publishToOrdersQueue({
          type: 'order.auto_assigned',
          orderId: order._id,
          deliveryPartnerId: partner._id,
          timestamp: new Date().toISOString()
        });
      }
    } catch (pubErr) {
      console.error('Publish to RabbitMQ failed (auto-assign):', pubErr && pubErr.stack ? pubErr.stack : pubErr);
    }

    res.json({
      message: 'Order auto-assigned',
      order,
      partner: {
        _id: partner._id,
        name: partner.name,
        email: partner.email,
        vehicle: partner.vehicle
      }
    });
  } catch (err) {
    console.error('Auto-assign error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// -----------------------------
// Accept an order (delivery partner)
// PUT /api/delivery/accept/:orderId
// -----------------------------
router.put('/accept/:orderId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({ message: 'Delivery partner only' });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.status === 'completed') {
      return res.status(400).json({ message: 'Order already completed' });
    }

    order.status = 'out_for_delivery';
    order.assignedTo = req.user.userId;
    await order.save();

    await User.findByIdAndUpdate(req.user.userId, { isAvailable: false });

    try {
      if (io) io.to(`order_${order._id.toString()}`).emit('order:update', {
        orderId: order._id,
        status: order.status,
        assignedTo: order.assignedTo,
        updatedAt: order.updatedAt
      });
    } catch (emitErr) {
      console.error('Socket emit error (accept):', emitErr && emitErr.stack ? emitErr.stack : emitErr);
    }

    try {
      if (typeof publishToOrdersQueue === 'function') {
        await publishToOrdersQueue({
          type: 'order.accepted',
          orderId: order._id,
          deliveryPartnerId: req.user.userId,
          timestamp: new Date().toISOString()
        });
      }
    } catch (pubErr) {
      console.error('Publish to RabbitMQ failed (accept):', pubErr && pubErr.stack ? pubErr.stack : pubErr);
    }

    res.json({ message: 'Order accepted', order });
  } catch (err) {
    console.error('Accept order error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// -----------------------------
// Update delivery partner location
// PUT /api/delivery/location
// -----------------------------
router.put('/location', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({ message: 'Delivery partner only' });
    }

    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'lat and lng numeric required' });
    }

    await User.findByIdAndUpdate(req.user.userId, {
      currentLocation: { type: 'Point', coordinates: [lng, lat] }
    }, { new: true });

    try {
      if (io) io.to(`partner_${req.user.userId}`).emit('partner:location', {
        partnerId: req.user.userId,
        lat, lng, updatedAt: new Date().toISOString()
      });
    } catch (emitErr) {
      console.error('Socket emit error (location):', emitErr && emitErr.stack ? emitErr.stack : emitErr);
    }

    res.json({ message: 'Location updated' });
  } catch (err) {
    console.error('Update location error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// -----------------------------
// Mark order as delivered (complete)
// PUT /api/delivery/complete/:orderId
// -----------------------------
router.put('/complete/:orderId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({ message: 'Delivery partner only' });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (String(order.assignedTo) !== String(req.user.userId)) {
      return res.status(403).json({ message: 'You are not assigned to this order' });
    }

    order.status = 'completed';

    try {
      await order.save();
    } catch (saveErr) {
      console.error('Order save error (complete):', saveErr && saveErr.stack ? saveErr.stack : saveErr);
      return res.status(500).json({ message: 'Failed to save order', error: String(saveErr && saveErr.message ? saveErr.message : saveErr) });
    }

    try {
      await User.findByIdAndUpdate(req.user.userId, { isAvailable: true });
    } catch (userErr) {
      console.error('Partner update error (complete):', userErr && userErr.stack ? userErr.stack : userErr);
    }

    try {
      if (io) io.to(`order_${order._id.toString()}`).emit('order:update', {
        orderId: order._id,
        status: order.status,
        updatedAt: order.updatedAt
      });
    } catch (emitErr) {
      console.error('Socket emit error (complete):', emitErr && emitErr.stack ? emitErr.stack : emitErr);
    }

    try {
      if (typeof publishToOrdersQueue === 'function') {
        await publishToOrdersQueue({
          type: 'order.completed',
          orderId: order._id,
          deliveryPartnerId: req.user.userId,
          timestamp: new Date().toISOString()
        });
      }
    } catch (pubErr) {
      console.error('Publish to RabbitMQ failed (complete):', pubErr && pubErr.stack ? pubErr.stack : pubErr);
    }

    res.json({ message: 'Order marked as delivered', order });
  } catch (err) {
    console.error('Complete order error (route):', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error', error: String(err && err.message ? err.message : err) });
  }
});

// -----------------------------
// Delivery partner: Assigned orders (for dashboard)
// GET /api/delivery/orders
// -----------------------------
router.get('/orders', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({ message: 'Delivery partner only' });
    }

    // return orders assigned to this partner that are not completed
    const orders = await Order.find({
      assignedTo: req.user.userId,
      status: { $ne: 'completed' }
    })
      .populate('restaurant', 'name')
      .sort({ updatedAt: -1 });

    res.json(orders);
  } catch (err) {
    console.error('Get delivery orders error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// -----------------------------
// Delivery partner: History (completed orders)
// GET /api/delivery/history
// -----------------------------
router.get('/history', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery_partner') {
      return res.status(403).json({ message: 'Delivery partner only' });
    }

    const orders = await Order.find({
      assignedTo: req.user.userId,
      status: 'completed'
    })
      .populate('restaurant', 'name')
      .sort({ updatedAt: -1 })
      .limit(200);

    res.json(orders);
  } catch (err) {
    console.error('Get delivery history error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});
// alias: GET /api/delivery/partners  -> same as /available
router.get('/partners', auth, async (req, res) => {
  try {
    // reuse the same query as /available (all available delivery partners)
    const partners = await User.find({ role: 'delivery_partner', isAvailable: true }).select('name email _id vehicle').lean();
    res.json(partners);
  } catch (err) {
    console.error('GET /delivery/partners error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
