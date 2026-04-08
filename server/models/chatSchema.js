const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    title: String,
    messages: [
        {
            role: { type: String, enum: ['user', 'assistant', 'system'] },
            content: String,
            timestamp: { type: Date, default: Date.now }
        }
    ],
    createdAt: { type: Date, default: Date.now }
});

// IMPORTANT: Export the model
module.exports = mongoose.model('Chat', chatSchema);