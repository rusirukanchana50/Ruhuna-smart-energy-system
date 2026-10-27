/**
 * Building.js
 * -----------
 * Mongoose model for campus buildings in Ruhuna Smart Energy System.
 * Enforces unique uppercase code, valid rated power capacity, and core building protection.
 */

const mongoose = require('mongoose');

const buildingSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Building name is required'],
      trim: true,
      unique: true,
      minlength: [2, 'Building name must be at least 2 characters long'],
      maxlength: [100, 'Building name cannot exceed 100 characters']
    },
    code: {
      type: String,
      required: [true, 'Building code is required'],
      trim: true,
      uppercase: true,
      unique: true,
      minlength: [2, 'Building code must be at least 2 characters long'],
      maxlength: [20, 'Building code cannot exceed 20 characters'],
      match: [/^[A-Z0-9_-]+$/, 'Building code can only contain uppercase alphanumeric characters, dashes, and underscores']
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    rated_power_kw: {
      type: Number,
      required: [true, 'Rated power in kW is required'],
      min: [0.1, 'Rated power must be a positive number greater than 0'],
      max: [10000.0, 'Rated power cannot exceed 10,000 kW'],
      default: 50.0
    },
    is_core: {
      type: Boolean,
      default: false
    }
  },
  {
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

// Pre-save middleware: ensure code is trimmed & uppercase, name is trimmed
buildingSchema.pre('save', function (next) {
  if (this.code) {
    this.code = this.code.trim().toUpperCase();
  }
  if (this.name) {
    this.name = this.name.trim();
  }
  next();
});

const Building = mongoose.models.Building || mongoose.model('Building', buildingSchema);

module.exports = Building;
