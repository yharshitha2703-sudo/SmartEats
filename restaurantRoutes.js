// backend/routes/restaurantRoutes.js
const express = require('express');
const Restaurant = require('../models/Restaurant');
const auth = require('../middleware/authMiddleware');
const redis = require('../config/redisClient');

const router = express.Router();

/* -----------------------------------------------------
   CREATE RESTAURANT (OWNER ONLY)
----------------------------------------------------- */
router.post('/', auth, async (req, res) => {
  try {
    const { name, address, description, phone, imageUrl, category, timings } = req.body;

    const restaurant = await Restaurant.create({
      name,
      address,
      description,
      phone,
      imageUrl,
      category,
      timings,
      owner: req.user.userId
    });

    await redis.del('restaurants:all');

    return res.status(201).json({ message: 'Restaurant created', restaurant });
  } catch (err) {
    console.error('CREATE REST ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* -----------------------------------------------------
   GET ALL RESTAURANTS (PUBLIC + CACHED)
----------------------------------------------------- */
router.get('/', async (req, res) => {
  try {
    const cacheKey = 'restaurants:all';

    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const restaurants = await Restaurant.find().populate('owner', 'name email');
    await redis.set(cacheKey, JSON.stringify(restaurants), 'EX', 300);

    return res.json(restaurants);
  } catch (err) {
    console.error('GET ALL REST ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* -----------------------------------------------------
   GET MY RESTAURANTS (OWNER ONLY)
----------------------------------------------------- */
router.get('/my', auth, async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const restaurants = await Restaurant.find({ owner: ownerId });

    return res.json(restaurants);
  } catch (err) {
    console.error('MY REST ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* -----------------------------------------------------
   GET SINGLE RESTAURANT
----------------------------------------------------- */
router.get('/:id', async (req, res) => {
  try {
    const rest = await Restaurant.findById(req.params.id).populate(
      'owner',
      'name email'
    );

    if (!rest) {
      return res.status(404).json({ message: 'Not found' });
    }

    return res.json(rest);
  } catch (err) {
    console.error('GET ONE REST ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* -----------------------------------------------------
   UPDATE RESTAURANT (OWNER ONLY + SAFE WHITELIST FIELDS)
----------------------------------------------------- */
router.put('/:id', auth, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });

    // Only the owner can update
    if (restaurant.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Access denied. Not the owner.' });
    }

    // Allowed fields to update
    const allowed = [
      'name',
      'address',
      'phone',
      'timings',
      'imageUrl',
      'category',
      'description'
    ];

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) {
        restaurant[key] = req.body[key];
      }
    });

    await restaurant.save();

    // Clear caches
    await redis.del('restaurants:all');
    await redis.del(`restaurant:${req.params.id}`);

    return res.json({ message: 'Restaurant updated', restaurant });
  } catch (err) {
    console.error('UPDATE REST ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* -----------------------------------------------------
   DELETE RESTAURANT (OWNER ONLY)
----------------------------------------------------- */
router.delete('/:id', auth, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ message: 'Restaurant not found' });

    // Only owner can delete
    if (restaurant.owner.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Access denied. Not the owner.' });
    }

    await restaurant.deleteOne();
    await redis.del('restaurants:all');
    await redis.del(`restaurant:${req.params.id}`);

    return res.json({ message: 'Restaurant deleted' });
  } catch (err) {
    console.error('DELETE REST ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
