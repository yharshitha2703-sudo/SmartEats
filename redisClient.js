const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redis = new Redis(redisUrl);

redis.on('connect', () => console.log('✅ Connected to Redis'));
redis.on('error', (err) => console.error('Redis error', err));

module.exports = redis;

