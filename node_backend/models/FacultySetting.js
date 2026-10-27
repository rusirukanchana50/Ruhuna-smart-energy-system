/**
 * FacultySetting.js
 * -----------------
 * Mongoose model for faculty operational configuration settings.
 * Stored in MongoDB collection 'faculty_settings'.
 */

const mongoose = require('mongoose');

const facultySettingSchema = new mongoose.Schema(
  {
    setting_key: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    setting_value: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    collection: 'faculty_settings',
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

const FacultySetting = mongoose.models.FacultySetting || mongoose.model('FacultySetting', facultySettingSchema);

module.exports = FacultySetting;
