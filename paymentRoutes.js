// backend/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const Order = require('../models/Order');
const Payment = require('../models/Payment');

// 1) Create a payment for an order (mock)
router.post('/create', auth, async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (String(order.customer) !== String(req.user.userId)) {
      return res.status(403).json({ message: 'You can only pay for your own orders' });
    }

    // create mock payment
    const payment = await Payment.create({
      order: order._id,
      amount: order.totalPrice,
      status: 'created',
      provider: 'mock',
      providerPaymentId: 'mock_pay_' + Date.now()
    });

    // in a real integration, here you would create Razorpay/Stripe order and send client_secret / order_id

    res.status(201).json({
      message: 'Payment created (mock)',
      payment
    });
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 2) Confirm payment success (mock)
router.post('/confirm', auth, async (req, res) => {
  try {
    const { paymentId, success } = req.body; // success: true/false

    const payment = await Payment.findById(paymentId).populate('order');
    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    if (String(payment.order.customer) !== String(req.user.userId)) {
      return res.status(403).json({ message: 'You can only confirm your own payments' });
    }

    if (success) {
      payment.status = 'success';
      await payment.save();

      payment.order.paymentStatus = 'paid';
      payment.order.paymentId = payment._id.toString();
      await payment.order.save();

      return res.json({
        message: 'Payment marked as success',
        payment,
        order: payment.order
      });
    } else {
      payment.status = 'failed';
      await payment.save();

      payment.order.paymentStatus = 'failed';
      await payment.order.save();

      return res.json({
        message: 'Payment marked as failed',
        payment,
        order: payment.order
      });
    }
  } catch (err) {
    console.error('Confirm payment error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
