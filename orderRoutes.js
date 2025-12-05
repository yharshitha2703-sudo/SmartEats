// backend/routes/orderRoutes.js
const express = require('express');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const auth = require('../middleware/authMiddleware');
const { publishToOrdersQueue } = require('../utils/rabbitmq');
const { getIo } = require('../utils/socket');

const router = express.Router();

/**
 * Helper to safely emit socket events without crashing the route.
 */
function safeEmit(room, event, payload) {
  try {
    const io = getIo();
    if (io) io.to(room).emit(event, payload);
  } catch (e) {
    console.error(`Socket emit error (${event} -> ${room}):`, e && e.stack ? e.stack : e);
  }
}

/* CREATE ORDER */
router.post('/', auth, async (req, res) => {
  try {
    const { restaurant, items, deliveryAddress } = req.body;
    if (!restaurant || !items || !items.length || !deliveryAddress) {
      return res.status(400).json({ message: 'restaurant, items & deliveryAddress required' });
    }

    const rest = await Restaurant.findById(restaurant);
    if (!rest) return res.status(404).json({ message: 'Restaurant not found' });

    // compute total AND build item snapshots (name + price + qty + menuItem)
    let total = 0;
    const orderItems = [];
    // fetch all menu IDs at once for performance
    const menuIds = items.map(i => i.menuItem);
    const menuDocs = await MenuItem.find({ _id: { $in: menuIds } }).lean();
    const menuById = Object.fromEntries(menuDocs.map(m => [String(m._id), m]));

    for (const it of items) {
      const menu = menuById[String(it.menuItem)];
      if (!menu) return res.status(400).json({ message: 'Invalid menu item' });

      const qty = Number(it.qty || 1);
      const price = Number(menu.price || 0);
      total += price * qty;

      orderItems.push({
        menuItem: it.menuItem,
        name: menu.name,
        price,
        qty
      });
    }

    const order = await Order.create({
      customer: req.user.userId,
      restaurant,
      items: orderItems,        // store snapshots
      totalPrice: total,
      deliveryAddress,
      status: 'pending'
    });

    // best-effort publish
    try {
      if (typeof publishToOrdersQueue === 'function') {
        await publishToOrdersQueue({
          type: 'order.created',
          orderId: order._id,
          customerId: order.customer,
          restaurantId: order.restaurant,
          totalPrice: order.totalPrice,
          createdAt: order.createdAt
        });
      }
    } catch (err) {
      console.error('RabbitMQ error (order.created):', err);
    }

    // notify socket listeners (only order room and restaurant list if you want)
    safeEmit(`order_${order._id}`, 'order:update', { orderId: order._id, status: order.status });
    // (do NOT emit to restaurant_<id> if you don't want restaurant live tracking)

    res.status(201).json({ message: 'Order created', order });
  } catch (err) {
    console.error('Create order error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* OWNER ORDER LIST */
router.get('/restaurant/:restaurantId', auth, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const rest = await Restaurant.findById(restaurantId);
    if (!rest) return res.status(404).json({ message: 'Restaurant not found' });

    if (rest.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const orders = await Order.find({ restaurant: restaurantId })
      .populate('customer', 'name email')
      .populate('items.menuItem', 'name price');

    res.json(orders);
  } catch (err) {
    console.error('Owner orders error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* UPDATE ORDER STATUS */
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status, assignedTo } = req.body;
    const order = await Order.findById(req.params.id).populate('restaurant');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const isOwner = order.restaurant && order.restaurant.owner && order.restaurant.owner.toString() === req.user.userId;
    const isAssignedDelivery = order.assignedTo && order.assignedTo.toString() === req.user.userId;

    if (!(isOwner || isAssignedDelivery)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // normalize incoming status to schema values (convert hyphens -> underscores)
    if (status) {
      let requestedStatus = (status || '').toString().trim();
      requestedStatus = requestedStatus.replace(/-/g, '_');
      order.status = requestedStatus;
    }

    // allow assignedTo update if present (owner can change this in same endpoint)
    if (assignedTo) {
      order.assignedTo = assignedTo;
    }

    await order.save();

    safeEmit(`order_${order._id.toString()}`, 'order:update', {
      orderId: order._id,
      status: order.status,
      assignedTo: order.assignedTo || null,
      updatedAt: order.updatedAt
    });

    res.json({ message: 'Status updated', order });
  } catch (err) {
    console.error('Update order status error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* ASSIGN DELIVERY PARTNER (OWNER) */
router.put('/:id/assign', auth, async (req, res) => {
  try {
    const { assignedTo } = req.body;
    const order = await Order.findById(req.params.id).populate('restaurant');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // owner-only
    if (!order.restaurant || order.restaurant.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    // minimal validation: ensure assignedTo present
    if (!assignedTo) {
      return res.status(400).json({ message: 'assignedTo (userId) required' });
    }

    // set assignedTo and set a clear status
    order.assignedTo = assignedTo;
    order.status = 'assigned';

    await order.save();

    // Notify the assigned delivery partner (room: delivery_<userId>)
    safeEmit(`delivery_${assignedTo}`, 'order:assigned', {
      orderId: order._id,
      restaurantId: order.restaurant._id,
      totalPrice: order.totalPrice,
      deliveryAddress: order.deliveryAddress
    });

    // Notify the order room so customer sees the assignment
    safeEmit(`order_${order._id.toString()}`, 'order:update', {
      orderId: order._id,
      status: order.status,
      assignedTo: order.assignedTo
    });

    return res.json({ message: 'Order assigned', order });
  } catch (err) {
    console.error('Assign order error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET orders for the logged-in customer
router.get('/my', auth, async (req, res) => {
  try {
    const userId = req.user && (req.user.userId || req.user.id);
    if (!userId) return res.status(400).json({ message: 'User not identified' });

    const orders = await Order.find({ customer: userId })
      .populate('restaurant', 'name address')
      .populate('items.menuItem', 'name price')
      .populate('customer', 'name email')
      .sort({ createdAt: -1 });

    return res.json(orders);
  } catch (err) {
    console.error('GET /api/orders/my error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

// CANCEL ORDER (customer)
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId).populate('restaurant');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (!order.customer || order.customer.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Not allowed to cancel this order' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });
    }

    order.status = 'cancelled';
    await order.save();

    // notify via sockets: order room and restaurant room
    safeEmit(`order_${order._id.toString()}`, 'order:update', {
      orderId: order._id,
      status: order.status,
      updatedAt: order.updatedAt
    });

    safeEmit(`restaurant_${order.restaurant._id}`, 'order:updated_by_customer', {
      orderId: order._id,
      status: order.status
    });

    return res.json({ message: 'Order cancelled', order });
  } catch (err) {
    console.error('Cancel order error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
