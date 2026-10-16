require('dotenv').config();
const IORedis = require('ioredis');

const redisOptions = {
    maxRetriesPerRequest: null, // Requerido por BullMQ
    enableReadyCheck: false,    // Requerido por Upstash (evita fallos de INFO y ready check)
    family: 4,                  // Forzar IPv4: evita el algoritmo múltiple (Happy Eyeballs) de Node que provoca ETIMEDOUT
    connectTimeout: 20000,      // 20s de tolerancia para handshakes TLS en la nube
    retryStrategy(times) {
        return Math.min(times * 100, 3000);
    }
};

const redisConnection = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, redisOptions)
    : new IORedis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        ...redisOptions
    });

redisConnection.on('connect', () => {
    console.log('✅ [REDIS] Conectado exitosamente a Redis.');
});

redisConnection.on('error', (err) => {
    // Captura errores transitorios para evitar que Node.js lance un error no controlado
    console.warn('⚠️ [REDIS] Evento de conexión:', err.message);
});

module.exports = redisConnection;
