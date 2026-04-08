const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Ollama } = require('ollama');
const ollama = new Ollama();

const Chat = require('./models/chatSchema');
const Profile = require('./models/Profile');
const Invoice = require('./models/Invoice');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

mongoose.connect('mongodb://localhost:27017/quickbill')
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ Connection Error:", err));

app.post('/api/invoices', async (req, res) => {
    try {
        const newInvoice = new Invoice(req.body);
        await newInvoice.save();
        res.status(201).json({ message: "Success" });
    } catch (err) {
        if (err.code === 11000) {
            res.status(400).json({ message: "Duplicate Invoice Number. Please change the ID." });
        } else {
            res.status(500).json({ message: err.message });
        }
    }
});

app.get('/api/invoices', async (req, res) => {
    const data = await Invoice.find().sort({ createdAt: -1 });
    res.json(data);
});

app.get('/api/stats', async (req, res) => {
    const invoices = await Invoice.find();
    const totalRevenue = invoices.reduce((s, i) => s + i.grandTotal, 0);
    const pending = invoices.filter(i => i.status === 'Unpaid').reduce((s, i) => s + i.grandTotal, 0);

    const monthlyData = {};
    invoices.forEach(inv => {
        const m = inv.date.split('/')[1] || "01";
        monthlyData[m] = (monthlyData[m] || 0) + inv.grandTotal;
    });
    res.json({ totalRevenue, pending, count: invoices.length, monthlyData });
});

app.post('/api/profile', async (req, res) => {
    try {
        const { name, address, gstin, upi } = req.body;
        // Upsert: Find the profile and update it, or create it if it doesn't exist
        const profile = await Profile.findOneAndUpdate(
            { profileType: 'main_profile' },
            { name, address, gstin, upi, updatedAt: Date.now() },
            { upsert: true, new: true }
        );
        res.json(profile);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.get('/api/profile', async (req, res) => {
    try {
        const profile = await Profile.findOne({ profileType: 'main_profile' });
        res.json(profile || {});
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/invoices/:id', async (req, res) => {
    try {
        await Invoice.findByIdAndUpdate(req.params.id, req.body);
        res.status(200).json({ message: "Updated" });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// =====================================================
// COMPLETE BACKEND ROUTE: /api/ai/analyze
// =====================================================

app.post('/api/ai/analyze', async (req, res) => {
    try {
        const { prompt, contextData, chatId } = req.body;
        console.log("Processing AI Request for:", prompt);

        // ===== 1. DATE NORMALIZATION & MONTHLY FILTERING =====
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        const monthlyInvoices = (contextData || []).filter(inv => {
            if (!inv.date) return false;

            // Convert DD/MM/YYYY to MM/DD/YYYY for JavaScript Date parsing
            let dateStr = inv.date;
            if (dateStr.includes('/')) {
                const parts = dateStr.split('/');
                if (parts[0].length <= 2 && parts[1].length <= 2) {
                    // Format is DD/MM/YYYY, convert to MM/DD/YYYY
                    dateStr = `${parts[1]}/${parts[0]}/${parts[2]}`;
                }
            }

            const d = new Date(dateStr);
            const isValid = !isNaN(d.getTime());
            const isCurrentMonth = isValid && d.getMonth() === thisMonth && d.getFullYear() === thisYear;

            console.log(`Invoice ${inv.invoiceNo}: Date=${inv.date}, Parsed=${d.toDateString()}, Valid=${isValid}, CurrentMonth=${isCurrentMonth}`);

            return isCurrentMonth;
        });

        console.log(`Filtered ${monthlyInvoices.length} invoices from ${contextData?.length || 0} total`);

        // ===== 2. CALCULATE MONTHLY TOTALS =====
        const monthlyTotal = monthlyInvoices.reduce((sum, inv) => {
            return sum + (inv.grandTotal || 0);
        }, 0);

        // ===== 3. CREATE FORMATTED REPORT DATA =====
        const reportData = monthlyInvoices
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(i => {
                const clientName = i.client?.name || "Unknown";
                const amount = (i.grandTotal || 0).toLocaleString('en-IN');
                return `• Date: ${i.date} | Client: ${clientName} | Total: ₹${amount}`;
            })
            .join('\n');

        const monthName = new Date(thisYear, thisMonth, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

        // ===== 4. LOAD OR CREATE CHAT SESSION =====
        let currentChat;
        if (chatId && mongoose.Types.ObjectId.isValid(chatId)) {
            try {
                currentChat = await Chat.findById(chatId);
            } catch (e) {
                console.log("Chat ID invalid, creating new chat");
            }
        }
        if (!currentChat) {
            currentChat = new Chat({ messages: [] });
        }

        // ===== 5. BUILD SYSTEM PROMPT WITH MONTHLY DATA =====
        const systemPrompt = `You are Bharat's intelligent ERP business assistant. 

Your role:
- Analyze invoice and sales data to provide business insights
- Answer questions about monthly performance, client activity, and revenue trends
- Provide clear, actionable recommendations

CURRENT MONTH: ${monthName}

MONTHLY SALES DATA (CURRENT MONTH ONLY):
${reportData.length > 0 ? reportData : "No invoices recorded for this month yet."}

SUMMARY:
- Total Invoices This Month: ${monthlyInvoices.length}
- Monthly Revenue: ₹${monthlyTotal.toLocaleString('en-IN')}
- Average Invoice: ₹${(monthlyInvoices.length > 0 ? (monthlyTotal / monthlyInvoices.length).toFixed(0) : 0).toLocaleString('en-IN')}

PDF GENERATION RULES:
- If the user asks for a "report", "PDF", "summary", or "monthly summary", INCLUDE the [GENERATE_PDF] tag at the END of your response
- Format: "Here is your analysis... [GENERATE_PDF]"
- WITHOUT this tag, no PDF will be generated
- Always provide the data above as context when generating reports`;

        // ===== 6. PREPARE MESSAGES FOR OLLAMA =====
        const messagesForAI = [
            {
                role: 'system',
                content: systemPrompt
            },
            // Include conversation history
            ...currentChat.messages.map(m => ({
                role: m.role,
                content: m.content
            })),
            // Add current user prompt
            { role: 'user', content: prompt }
        ];

        // ===== 7. CALL OLLAMA LLM =====
        console.log("Calling Ollama with system prompt and", messagesForAI.length - 1, "context messages");

        const response = await ollama.chat({
            model: 'llama3.2:1b',
            messages: messagesForAI,
            stream: false,
            options: {
                temperature: 0.3,  // Lower temperature for more consistent output
                num_predict: 500   // Limit response length
            }
        });

        const aiAnswer = response.message.content;
        console.log("AI Response received, length:", aiAnswer.length);
        console.log("Contains [GENERATE_PDF]:", aiAnswer.includes("[GENERATE_PDF]"));

        // ===== 8. SAVE CONVERSATION TO DATABASE =====
        currentChat.messages.push({
            role: 'user',
            content: prompt
        });
        currentChat.messages.push({
            role: 'assistant',
            content: aiAnswer
        });

        if (!currentChat.title) {
            currentChat.title = prompt.substring(0, 50);
        }

        currentChat.updatedAt = new Date();
        await currentChat.save();

        // ===== 9. SEND RESPONSE TO FRONTEND =====
        res.json({
            success: true,
            chatId: currentChat._id,
            answer: aiAnswer,
            monthlyData: {
                month: monthName,
                invoiceCount: monthlyInvoices.length,
                totalRevenue: monthlyTotal,
                invoices: monthlyInvoices
            }
        });

    } catch (err) {
        console.error("AI Route Error:", err);
        res.status(500).json({
            success: false,
            error: "Backend failed to process AI request.",
            details: err.message
        });
    }
});

// =====================================================
// HELPER ROUTE: Get last chat session
// =====================================================
app.get('/api/ai/history/last', async (req, res) => {
    try {
        const lastChat = await Chat.findOne().sort({ createdAt: -1 });
        if (lastChat) {
            res.json(lastChat);
        } else {
            res.json(null);
        }
    } catch (err) {
        console.error("Error fetching chat history:", err);
        res.status(500).json({ error: "Failed to fetch chat history" });
    }
});

// =====================================================
// HELPER ROUTE: Get chat by ID
// =====================================================
app.get('/api/ai/history/:chatId', async (req, res) => {
    try {
        const chat = await Chat.findById(req.params.chatId);
        if (chat) {
            res.json(chat);
        } else {
            res.status(404).json({ error: "Chat not found" });
        }
    } catch (err) {
        console.error("Error fetching chat:", err);
        res.status(500).json({ error: "Failed to fetch chat" });
    }
});

// =====================================================
// HELPER ROUTE: Get monthly stats
// =====================================================
app.get('/api/stats', async (req, res) => {
    try {
        const invoices = await Invoice.find();

        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        // Filter current month invoices
        const monthlyInvoices = invoices.filter(inv => {
            if (!inv.date) return false;
            let dateStr = inv.date;
            if (dateStr.includes('/')) {
                const parts = dateStr.split('/');
                if (parts[0].length <= 2) {
                    dateStr = `${parts[1]}/${parts[0]}/${parts[2]}`;
                }
            }
            const d = new Date(dateStr);
            return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        });

        const totalRevenue = monthlyInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

        // Build monthly data (last 6 months)
        const monthlyData = {};
        for (let i = 5; i >= 0; i--) {
            const d = new Date(thisYear, thisMonth - i, 1);
            const m = d.getMonth();
            const y = d.getFullYear();
            const monthKey = new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

            const monthTotal = invoices
                .filter(inv => {
                    if (!inv.date) return false;
                    let dateStr = inv.date;
                    if (dateStr.includes('/')) {
                        const p = dateStr.split('/');
                        if (p[0].length <= 2) dateStr = `${p[1]}/${p[0]}/${p[2]}`;
                    }
                    const invDate = new Date(dateStr);
                    return invDate.getMonth() === m && invDate.getFullYear() === y;
                })
                .reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

            monthlyData[monthKey] = monthTotal;
        }

        res.json({
            totalRevenue: totalRevenue,
            pending: 0,  // Implement if you have payment status tracking
            count: monthlyInvoices.length,
            monthlyData: monthlyData
        });
    } catch (err) {
        console.error("Stats error:", err);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

app.listen(5000, () => console.log("🚀 Server at http://localhost:5000"));