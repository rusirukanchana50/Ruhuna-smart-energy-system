/**
 * server.js
 * ---------
 * HTTP server launcher for Ruhuna Smart Energy System Node.js backend.
 * Connects to MongoDB before listening on configured PORT.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const app = require('./app');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    const server = app.listen(PORT, () => {
      console.log(`[Express] Server running on http://localhost:${PORT}`);
      console.log(`[Express] Health check at http://localhost:${PORT}/api/health`);
    });

    // Graceful shutdown handling
    const handleShutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        const { disconnectDB } = require('./config/db');
        await disconnectDB();
        console.log('[Server] Graceful shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    return server;
  } catch (err) {
    console.error('[Server] Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
