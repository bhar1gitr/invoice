const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    invoiceNo: { type: String, required: true, unique: true },
    invoiceType: { type: String, default: 'Tax Invoice' },
    date: { type: String, required: true },
    businessName: String,
    client: {
        name: String,
        address: String,
        gstin: String,
        email: String
    },
    items: [{
        description: String,
        hsn: String,
        qty: Number,
        price: Number,
        gst: Number,
        total: Number
    }],
    subTotal: Number,
    taxTotal: Number,
    grandTotal: Number,
    signature: String, // Base64 String
    status: { type: String, default: 'Unpaid' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Invoice', invoiceSchema);