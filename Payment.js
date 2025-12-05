// backend/models/Payment.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true
    },
    amount: { type: Number, required: true }, // in rupees for now
    status: {
      type: String,
      enum: ['created', 'success', 'failed'],
      default: 'created'
    },
    provider: {
      type: String,
      enum: ['mock', 'razorpay', 'stripe'],
      default: 'mock'
    },
    providerPaymentId: { type: String }, // e.g., Razorpay payment_id
    providerOrderId: { type: String }    // e.g., Razorpay order_id
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
