// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    email: { type: String, required: true, unique: true },

    password: { type: String, required: true },

    // IMPORTANT: allow delivery_partner role
    role: {
      type: String,
      enum: ['customer', 'restaurant', 'restaurant_owner', 'delivery_partner', 'admin'],
      default: 'customer',
      required: true
    },

    // for restaurant owners / delivery partners
    vehicle: { type: String },

    isAvailable: {
      type: Boolean,
      default: false
    },

    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: [0, 0]
      }
    }
  },
  { timestamps: true }
);

// make sure model name has capital U
module.exports = mongoose.model('User', userSchema);
