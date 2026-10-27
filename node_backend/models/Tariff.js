/**
 * Tariff.js
 * ---------
 * Mongoose model for demonstration utility tariff rates.
 * Stored in MongoDB collection 'tariffs'.
 */

const mongoose = require('mongoose');

const tariffSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      unique: true,
      default: 1
    },
    name: {
      type: String,
      required: true,
      trim: true,
      default: 'Demonstration Institutional Tariff (Estimated Non-Official Model)'
    },
    energy_rate_lkr_per_kwh: {
      type: Number,
      required: true,
      min: [0.01, 'Energy rate must be greater than 0'],
      max: [1000.0, 'Energy rate exceeds maximum allowable limit'],
      default: 38.50
    },
    demand_rate_lkr_per_kw: {
      type: Number,
      required: true,
      min: [0.0, 'Demand rate cannot be negative'],
      max: [50000.0, 'Demand rate exceeds maximum allowable limit'],
      default: 1450.00
    },
    fixed_charge_lkr: {
      type: Number,
      required: true,
      min: [0.0, 'Fixed charge cannot be negative'],
      max: [100000.0, 'Fixed charge exceeds maximum allowable limit'],
      default: 3000.00
    },
    effective_from: {
      type: Date,
      default: Date.now
    },
    active: {
      type: Boolean,
      default: true
    }
  },
  {
    collection: 'tariffs',
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret.id = ret.id !== undefined && ret.id !== null ? ret.id : ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

const Tariff = mongoose.models.Tariff || mongoose.model('Tariff', tariffSchema);

module.exports = Tariff;
