// backend/routes/menuRoutes.js
const express = require('express');
const MenuItem = require('../models/MenuItem');
const Restaurant = require('../models/Restaurant');
const auth = require('../middleware/authMiddleware');
const redis = require('../config/redisClient');

// socket helper – avoids circular require
const { getIo } = require('../utils/socket');

const router = express.Router();

/**
 * Safely emit a socket event to a room without crashing the request
 */
function safeEmit(room, event, payload) {
  try {
    const io = getIo();
    if (io) io.to(room).emit(event, payload);
  } catch (err) {
    console.error(`Socket emit error (${event} -> ${room}):`, err && err.stack ? err.stack : err);
  }
}

/* =========================================================
    CREATE MENU ITEM (OWNER ONLY)
   ========================================================= */
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, price, image, category, restaurant } = req.body;

    if (!restaurant) return res.status(400).json({ message: 'restaurant id required' });

    // verify restaurant exists and belongs to the user
    const rest = await Restaurant.findById(restaurant);
    if (!rest) return res.status(404).json({ message: 'Restaurant not found' });

    if (rest.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Access denied. Not the owner.' });
    }

    const item = await MenuItem.create({
      name,
      description,
      price,
      image,
      category,
      restaurant,
      available: true
    });

    // clear redis cache
    try {
      await redis.del(`menu:restaurant:${restaurant}`);
      await redis.del('restaurants:all');
    } catch (e) {
      console.warn('Redis cache clear failed (menu create):', e && e.message ? e.message : e);
    }

    // Socket emit (best-effort)
    safeEmit(`restaurant_${restaurant}`, 'menu:created', item);

    res.status(201).json({ message: 'Menu item created', item });
  } catch (err) {
    console.error('Create menu item error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* =========================================================
    GET ALL MENU ITEMS (PUBLIC)
   ========================================================= */
router.get('/', async (req, res) => {
  try {
    const items = await MenuItem.find().populate('restaurant', 'name address');
    res.json(items);
  } catch (err) {
    console.error('Get all menu items error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* =========================================================
    GET MENU BY RESTAURANT (CACHED)
   ========================================================= */
router.get('/restaurant/:restaurantId', async (req, res) => {
  try {
    const rid = req.params.restaurantId;
    const cacheKey = `menu:restaurant:${rid}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    } catch (e) {
      // continue, we can still fetch from DB
      console.warn('Redis get failed (menu by restaurant):', e && e.message ? e.message : e);
    }

    const items = await MenuItem.find({ restaurant: rid });
    try {
      await redis.set(cacheKey, JSON.stringify(items), 'EX', 60 * 5);
    } catch (e) {
      console.warn('Redis set failed (menu by restaurant):', e && e.message ? e.message : e);
    }

    res.json(items);
  } catch (err) {
    console.error('Get menu by restaurant error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* =========================================================
    GET SINGLE MENU ITEM
   ========================================================= */
router.get('/:id', async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id).populate('restaurant', 'name');
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    console.error('Get menu item error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* =========================================================
    UPDATE MENU ITEM (OWNER ONLY)
   ========================================================= */
router.put('/:id', auth, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Menu item not found' });

    const rest = await Restaurant.findById(item.restaurant);
    if (!rest) return res.status(404).json({ message: 'Restaurant not found' });

    if (rest.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Access denied. Not the owner.' });
    }

    const updated = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true });

    try {
      await redis.del(`menu:restaurant:${item.restaurant}`);
      await redis.del('restaurants:all');
    } catch (e) {
      console.warn('Redis cache clear failed (menu update):', e && e.message ? e.message : e);
    }

    safeEmit(`restaurant_${item.restaurant}`, 'menu:updated', updated);

    res.json({ message: 'Updated', item: updated });
  } catch (err) {
    console.error('Update menu item error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

/* =========================================================
    DELETE MENU ITEM (OWNER ONLY)
   ========================================================= */
router.delete('/:id', auth, async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Menu item not found' });

    const rest = await Restaurant.findById(item.restaurant);
    if (!rest) return res.status(404).json({ message: 'Restaurant not found' });

    if (rest.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Access denied. Not the owner.' });
    }

    await MenuItem.findByIdAndDelete(req.params.id);

    try {
      await redis.del(`menu:restaurant:${item.restaurant}`);
      await redis.del('restaurants:all');
    } catch (e) {
      console.warn('Redis cache clear failed (menu delete):', e && e.message ? e.message : e);
    }

    safeEmit(`restaurant_${item.restaurant}`, 'menu:deleted', { id: item._id });

    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete menu item error:', err && err.stack ? err.stack : err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
