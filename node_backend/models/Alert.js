/**
 * Alert.js
 * --------
 * Mongoose model for electrical alerts and abnormal conditions.
 * Stored in MongoDB collection 'alerts'.
 * Maintains alert type, severity, active/cleared states, threshold metadata,
 * and administrator acknowledgment logs.
 */

const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      unique: true,
      sparse: true,
      index: true
    },
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
      index: true
    },
    alert_type: {
      type: String,
      required: [true, 'Alert type is required'],
      trim: true,
      index: true
    },
    severity: {
      type: String,
      required: [true, 'Severity is required'],
      enum: ['INFO', 'WARNING', 'CRITICAL'],
      default: 'WARNING',
      index: true
    },
    measured_value: {
      type: Number,
      default: null
    },
    threshold_value: {
      type: Number,
      default: null
    },
    message: {
      type: String,
      required: [true, 'Alert message is required'],
      trim: true
    },
    acknowledged: {
      type: Boolean,
      default: false,
      index: true
    },
    acknowledged_by: {
      type: String,
      default: null
    },
    acknowledged_at: {
      type: Date,
      default: null
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true
    },
    cleared_at: {
      type: Date,
      default: null
    }
  },
  {
    collection: 'alerts',
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

// Compound indexes for alert engine lookups and dashboard queries
alertSchema.index({ building_id: 1, is_active: 1 });
alertSchema.index({ building_id: 1, alert_type: 1, is_active: 1 });
alertSchema.index({ is_active: 1, severity: 1 });
alertSchema.index({ timestamp: -1 });

const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);

module.exports = Alert;
