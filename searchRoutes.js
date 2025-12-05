const express = require('express');
const router = express.Router();
const Restaurant = require('../models/Restaurant');
const MenuItem = require('../models/MenuItem');

// Simple text search without Elasticsearch
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) return res.status(400).json({ message: "Search query missing" });

    // Case-insensitive partial match
    const regex = new RegExp(q, 'i');

    const restaurants = await Restaurant.find({
      name: regex
    }).select('name address cuisine rating');

    const items = await MenuItem.find({
      name: regex
    }).select('name price restaurant');

    res.json({
      query: q,
      restaurants,
      items
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
