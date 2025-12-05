const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      role
    });

    res.status(201).json({ message: 'User created', userId: user._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
// Login (temporary debug logs)
router.post('/login', async (req, res) => {
  try {
    console.log('DEBUG: /login called, body=', req.body);
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    console.log('DEBUG: user lookup result =', !!user, user ? { email: user.email, pwHashStartsWith: user.password && user.password.slice(0,6) } : null);

    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    console.log('DEBUG: bcrypt.compare result =', match);

    if (!match) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log('DEBUG: login success for', email);
    res.json({ message: 'Login successful', token });
  } catch (err) {
    console.error('ERROR /login', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delivery Partner Registration
router.post("/register/delivery", async (req, res) => {
  try {
    const { name, email, password, vehicle } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      role: "delivery_partner",
      vehicle,
      isAvailable: true
    });

    res.json({ message: "Delivery partner registered", user });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


module.exports = router;
