const express = require('express');
const MenuItem = require('../models/MenuItem');
const auth = require('../middleware/authMiddleware'); // protects creation/modification

const router = express.Router();

// Create menu item (protected - restaurant owner)
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, price, image, category, restaurant } = req.body;

    // you could check that req.user is owner of restaurant here (optional)
    const item = await MenuItem.create({
      name,
      description,
      price,
      image,
      category,
      restaurant,
      available: true
    });

    res.status(201).json({ message: 'Menu item created', item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all menu items (public)
router.get('/', async (req, res) => {
  try {
    const items = await MenuItem.find().populate('restaurant', 'name address');
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get menu items by restaurant id
router.get('/restaurant/:restaurantId', async (req, res) => {
  try {
    const items = await MenuItem.find({ restaurant: req.params.restaurantId });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single item
router.get('/:id', async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id).populate('restaurant', 'name');
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update item (protected)
router.put('/:id', auth, async (req, res) => {
  try {
    const updated = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Updated', item: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete item (protected)
router.delete('/:id', auth, async (req, res) => {
  try {
    const removed = await MenuItem.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
