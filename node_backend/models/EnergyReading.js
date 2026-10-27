/**
 * EnergyReading.js
 * ----------------
 * Mongoose model for three-phase electrical telemetry readings.
 * Stored in MongoDB collection 'energy_readings'.
 * Supports dynamic building reference, balanced three-phase parameters,
 * incremental cumulative energy tracking, and simulation identification.
 */

const mongoose = require('mongoose');

const energyReadingSchema = new mongoose.Schema(
  {
    building_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Building',
      required: [true, 'Building reference is required'],
      index: true
    },
    building_code: {
      type: String,
      trim: true,
      uppercase: true,
      index: true
    },
    building_name: {
      type: String,
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: [true, 'Reading timestamp is required'],
      index: true
    },
    voltage: {
      type: Number,
      required: [true, 'Line voltage is required'],
      min: [0, 'Voltage cannot be negative']
    },
    current: {
      type: Number,
      required: [true, 'Line current is required'],
      min: [0, 'Current cannot be negative']
    },
    power_factor: {
      type: Number,
      required: [true, 'Power factor is required'],
      min: [0, 'Power factor cannot be negative'],
      max: [1.0, 'Power factor cannot exceed 1.0']
    },
    frequency: {
      type: Number,
      required: [true, 'Grid frequency is required'],
      min: [0, 'Frequency cannot be negative']
    },
    apparent_power_kva: {
      type: Number,
      required: [true, 'Apparent power is required'],
      min: [0, 'Apparent power cannot be negative']
    },
    active_power_kw: {
      type: Number,
      required: [true, 'Active power is required'],
      min: [0, 'Active power cannot be negative']
    },
    reactive_power_kvar: {
      type: Number,
      required: [true, 'Reactive power is required'],
      min: [0, 'Reactive power cannot be negative']
    },
    energy_kwh: {
      type: Number,
      required: [true, 'Cumulative energy in kWh is required'],
      min: [0, 'Energy cannot be negative']
    },
    is_simulated: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    collection: 'energy_readings',
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Compound indexes for time-series queries
energyReadingSchema.index({ building_id: 1, timestamp: -1 });
energyReadingSchema.index({ building_code: 1, timestamp: -1 });
energyReadingSchema.index({ timestamp: -1 });

const EnergyReading = mongoose.models.EnergyReading || mongoose.model('EnergyReading', energyReadingSchema);

module.exports = EnergyReading;
