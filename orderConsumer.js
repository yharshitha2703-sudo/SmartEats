// backend/consumers/orderConsumer.js
const amqp = require('amqplib');

const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function start() {
  const conn = await amqp.connect(RABBIT_URL);
  const ch = await conn.createChannel();
  const q = 'orders';
  await ch.assertQueue(q, { durable: true });
  ch.prefetch(1);
  console.log('✅ Order consumer waiting for messages on queue:', q);

  ch.consume(q, async (msg) => {
    if (msg !== null) {
      try {
        const data = JSON.parse(msg.content.toString());
        console.log('⏳ Processing order message:', data);
        // simulate work
        await new Promise((r) => setTimeout(r, 1000));
        console.log('✅ Done processing order:', data.orderId || data);
        ch.ack(msg);
      } catch (err) {
        console.error('❌ Error processing message', err);
        ch.nack(msg, false, false);
      }
    }
  }, { noAck: false });
}

start().catch(err => {
  console.error('Order consumer failed', err);
  process.exit(1);
});
