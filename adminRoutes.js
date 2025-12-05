// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const redis = require('../config/redisClient');

// models
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');

// middlewares
const auth = require('../middleware/authMiddleware');
const { getIo } = require("../utils/socket");  // ✅ FIX 1 — use getIo()

// optional RabbitMQ
let publishToOrdersQueue = null;
try {
  publishToOrdersQueue = require("../utils/rabbitmq").publishToOrdersQueue;
} catch (_) {}

/* ADMIN CHECK */
const checkAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access only' });
  }
  next();
};

/* GET ALL USERS */
router.get('/users', auth, checkAdmin, async (req, res) => {
  const users = await User.find().select('-password');
  res.json(users);
});

/* GET ALL RESTAURANTS */
router.get('/restaurants', auth, checkAdmin, async (req, res) => {
  const restaurants = await Restaurant.find();
  res.json(restaurants);
});

/* APPROVE RESTAURANT */
router.put('/restaurants/:id/approve', auth, checkAdmin, async (req, res) => {
  try {
    const restaurantId = req.params.id;
    const { ownerId } = req.body || {};

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });

    restaurant.approved = true;

    if (ownerId) {
      const ownerUser = await User.findById(ownerId);
      if (!ownerUser) {
        return res.status(400).json({ message: 'Owner not found' });
      }

      restaurant.owner = ownerId;

      if (ownerUser.role !== "restaurant_owner") {
        ownerUser.role = "restaurant_owner";
      }

      ownerUser.restaurant = restaurantId;
      await ownerUser.save();
    }

    await restaurant.save();
    res.json({ message: "Restaurant approved", restaurant });
  } catch (err) {
    console.error("Approve restaurant error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* CLEAR CACHE */
router.post('/cache/clear', auth, checkAdmin, async (req, res) => {
  try {
    await redis.del("restaurants:all");

    const keys = await redis.keys("menu:restaurant:*");
    for (const k of keys) await redis.del(k);

    res.json({ message: "cache cleared" });
  } catch (err) {
    console.error("Cache clear error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ADMIN STATS */
router.get('/stats', auth, checkAdmin, async (req, res) => {
  try {
    const usersCount = await User.countDocuments();
    const ordersCount = await Order.countDocuments();
    const restaurantsCount = await Restaurant.countDocuments();

    const revenueAgg = await Order.aggregate([
      { $match: { status: { $in: ["completed", "delivered"] } } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } }
    ]);

    const totalRevenue = revenueAgg[0]?.total || 0;

    res.json({
      users: usersCount,
      orders: ordersCount,
      restaurants: restaurantsCount,
      revenue: totalRevenue
    });

  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* GET ALL ORDERS */
router.get('/orders', auth, checkAdmin, async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate("restaurant", "name")
      .populate("customer", "name email")
      .sort({ createdAt: -1 })
      .limit(500);

    res.json(orders);

  } catch (err) {
    console.error("Admin orders error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ASSIGN ORDER TO DELIVERY PARTNER */
router.post('/assign-to-partner', auth, checkAdmin, async (req, res) => {
  try {
    const { orderId, partnerId } = req.body;

    if (!orderId || !partnerId)
      return res.status(400).json({ message: "orderId & partnerId required" });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const partner = await User.findById(partnerId);
    if (!partner || partner.role !== "delivery_partner") {
      return res.status(404).json({ message: "Delivery partner not found" });
    }

    order.assignedTo = partnerId;
    order.status = "out_for_delivery"; // MUST MATCH ENUM
    await order.save();

    partner.isAvailable = false;
    await partner.save();

    // -------------------------------
    // FIXED SOCKET EMIT
    // -------------------------------
    try {
      const io = getIo(); // ✅ FIX 2 — This prevents errors
      io.to(`order_${order._id}`).emit("order:update", {
        orderId: order._id,
        status: order.status,
        assignedTo: partnerId
      });
    } catch (e) {
      console.error("Admin socket emit error:", e);
    }

    // RabbitMQ (optional)
    try {
      if (publishToOrdersQueue) {
        await publishToOrdersQueue({
          type: "order.manual_assigned",
          orderId,
          partnerId,
          timestamp: new Date()
        });
      }
    } catch (e) {
      console.error("Queue publish error:", e);
    }

    res.json({ message: "Order assigned", order, partner });

  } catch (err) {
    console.error("Admin assign error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
