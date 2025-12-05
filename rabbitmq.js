// backend/utils/rabbitmq.js
const amqp = require('amqplib');
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

let channelPromise = null;

async function getChannel() {
  if (channelPromise) return channelPromise;
  channelPromise = (async () => {
    const conn = await amqp.connect(RABBIT_URL);
    const ch = await conn.createChannel();
    await ch.assertQueue('orders', { durable: true });
    console.log('✅ RabbitMQ publisher ready');
    return ch;
  })();
  return channelPromise;
}

async function publishToOrdersQueue(messageObj) {
  const ch = await getChannel();
  const msg = Buffer.from(JSON.stringify(messageObj));
  return ch.sendToQueue('orders', msg, { persistent: true });
}

module.exports = { publishToOrdersQueue };
