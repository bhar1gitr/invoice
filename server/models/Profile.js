const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema({
    // We use a fixed ID or 'singleton' pattern so there is only 1 profile
    profileType: { type: String, default: 'main_profile', unique: true },
    name: String,
    address: String,
    gstin: String,
    upi: String,
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Profile', ProfileSchema);