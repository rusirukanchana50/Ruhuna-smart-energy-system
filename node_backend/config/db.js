/**
 * db.js
 * -----
 * Mongoose connection configuration for Ruhuna Smart Energy System.
 * Connects to MongoDB with environment variable fallback and connection monitoring.
 */

const mongoose = require('mongoose');

const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/ruhuna_energy';

/**
 * Connect to MongoDB database
 * @param {string} [customUri] - Optional custom connection URI (e.g. for testing)
 * @returns {Promise<typeof mongoose>}
 */
async function connectDB(customUri) {
  const uri = customUri || process.env.MONGODB_URI || DEFAULT_MONGODB_URI;

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
      serverSelectionTimeoutMS: 5000
    });
    console.log(`[MongoDB] Successfully connected to: ${uri}`);
    return mongoose;
  } catch (err) {
    console.error(`[MongoDB] Connection error for ${uri}:`, err.message);
    throw err;
  }
}

/**
 * Disconnect from MongoDB database
 * @returns {Promise<void>}
 */
async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[MongoDB] Connection closed.');
  }
}

module.exports = {
  connectDB,
  disconnectDB,
  DEFAULT_MONGODB_URI,
  mongoose
};
