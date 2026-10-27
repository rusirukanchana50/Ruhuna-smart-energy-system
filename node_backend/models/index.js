/**
 * models/index.js
 * ---------------
 * Central export file for Mongoose models.
 */

const Building = require('./Building');
const User = require('./User');
const EnergyReading = require('./EnergyReading');
const Alert = require('./Alert');
const Tariff = require('./Tariff');
const FacultySetting = require('./FacultySetting');

module.exports = {
  Building,
  User,
  EnergyReading,
  Alert,
  Tariff,
  FacultySetting
};
