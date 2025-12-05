// backend/models/Order.js
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menuItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem',
    required: true
  },
  name: { type: String },
  price: { type: Number, default: 0 },
  qty: { type: Number, default: 1 }
});

const orderSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    items: { type: [orderItemSchema], default: [] },
    totalPrice: { type: Number, default: 0 },
    deliveryAddress: { type: String },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },

    // canonical allowed status values
        // canonical allowed status values
    status: {
      type: String,
      enum: [
        'pending',
        'accepted',
        'assigned',       // <-- added
        'preparing',
        'picked',
        'on_the_way',
        'out_for_delivery',
        'delivering',
        'completed',
        'cancelled'
      ],
      default: 'pending'
    }

  },
  { timestamps: true }
);

module.exports = mongoose.model('Order', orderSchema);
