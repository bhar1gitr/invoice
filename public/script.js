const API_URL = "http://localhost:5000/api";
let myChart = null;
let currentEditId = null;
window.clientData = new Map();
window.userUPI = "";
let currentChatId = null;
let signatureBase64 = "";

window.onload = async () => {
    document.getElementById('cur-date').innerText = new Date().toLocaleDateString('en-IN');
    await loadSettings();
    await fetchCRM();
    resetForm();
    fetchStats();
};

async function showSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    
    const target = document.getElementById(sectionId + '-section');
    if (target) {
        target.style.display = 'block';
        document.getElementById('nav-' + sectionId).classList.add('active');
    }

    if (sectionId === 'view') fetchHistory();
    if (sectionId === 'dashboard') fetchStats();
    if (sectionId === 'crm') fetchCRM();
}

// --- FOOLPROOF SIGNATURE UPLOADER ---
function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            signatureBase64 = e.target.result;
            
            // Inject the image directly into the preview box with strict CSS for the PDF engine
            document.getElementById('signature-preview').innerHTML = 
                `<img src="${signatureBase64}" alt="Signature" style="height: 50px; width: auto; display: block; margin-bottom: 5px;">`;
                
            console.log("Signature loaded successfully!");
        };
        reader.readAsDataURL(file);
    }
}

// --- EDIT LOGIC ---
async function editInvoice(id) {
    try {
        const res = await fetch(`${API_URL}/invoices`);
        const all = await res.json();
        const inv = all.find(i => i._id === id);
        
        if (!inv) return alert("Invoice not found!");

        currentEditId = id;
        document.getElementById('invoice-page-title').innerText = "Edit Invoice: " + inv.invoiceNo;
        document.getElementById('save-btn').innerText = "🆙 Update Invoice";
        
        // Load Details
        document.getElementById('inv-no').innerText = inv.invoiceNo;
        document.getElementById('cur-date').innerText = inv.date;
        document.getElementById('client-name').innerText = inv.client.name;
        document.getElementById('client-addr').innerText = inv.client.address;
        document.getElementById('client-gst').innerText = inv.client.gstin;

        // Load Items
        const rows = document.getElementById('rows');
        rows.innerHTML = "";
        inv.items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="text" value="${item.description}" class="item-name"></td>
                <td><input type="number" class="qty" value="${item.qty}" oninput="calculate()"></td>
                <td><input type="number" class="rate" value="${item.price}" oninput="calculate()"></td>
                <td><input type="number" class="gst" value="${item.gst}" oninput="calculate()"></td>
                <td class="row-total" style="text-align: right; font-weight: bold;">₹ ${item.total.toFixed(2)}</td>
                <td class="no-print"><button onclick="this.closest('tr').remove(); calculate();" style="color:red; background:none; border:none; cursor:pointer;">&times;</button></td>
            `;
            rows.appendChild(tr);
        });

        calculate();
        showSection('new');
    } catch (e) { alert("Error loading invoice"); }
}

// --- CALCULATION ---
function calculate() {
    let sub = 0, tax = 0;
    document.querySelectorAll('#rows tr').forEach(row => {
        const q = parseFloat(row.querySelector('.qty').value) || 0;
        const r = parseFloat(row.querySelector('.rate').value) || 0;
        const g = parseFloat(row.querySelector('.gst').value) || 0;
        const lineTotal = (q * r) + (q * r * g / 100);
        row.querySelector('.row-total').innerText = `₹ ${lineTotal.toFixed(2)}`;
        sub += (q * r); tax += (q * r * g / 100);
    });
    document.getElementById('sub-total').innerText = `₹ ${sub.toFixed(2)}`;
    document.getElementById('tax-total').innerText = `₹ ${tax.toFixed(2)}`;
    const grand = (sub + tax).toFixed(2);
    document.getElementById('grand-total').innerText = `₹ ${grand}`;
    generateQR(grand);
}

function addNewRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" placeholder="Description" class="item-name"></td>
        
        <td><input type="text" placeholder="HSN" class="item-hsn"></td>
        
        <td><input type="number" class="qty" value="1" oninput="calculate()"></td>
        
        <td><input type="number" class="rate" value="0" oninput="calculate()"></td>
        
        <td><input type="number" class="gst" value="18" oninput="calculate()"></td>
        
        <td class="row-total" style="text-align: right; font-weight: bold;">₹ 0.00</td>
        
        <td class="no-print" style="text-align: center;">
            <button onclick="this.closest('tr').remove(); calculate();" style="color: #ef4444; background:none; border:none; cursor:pointer; font-size: 18px; font-weight: bold;">&times;</button>
        </td>
    `;
    document.getElementById('rows').appendChild(tr);
}

function resetForm() {
    currentEditId = null;
    document.getElementById('invoice-page-title').innerText = "Create New Invoice";
    document.getElementById('save-btn').innerText = "💾 Save to Database";
    document.getElementById('inv-no').innerText = "#INV-" + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('rows').innerHTML = "";
    document.getElementById('client-name').innerText = "Client Name";
    document.getElementById('client-addr').innerText = "Client Address...";
    document.getElementById('client-gst').innerText = "00XXXXX0000X0Z0";
    loadSettings();
    addNewRow();
}

async function saveToDB() {
    const cleanNum = (s) => parseFloat(s.replace(/[₹, ]/g, '')) || 0;
    const clientName = document.getElementById('client-name').innerText.trim();
    
    if(clientName === "" || clientName === "Client Name") return alert("Please type a Client Name!");

    const invoiceData = {
        invoiceNo: document.getElementById('inv-no').innerText,
        date: document.getElementById('cur-date').innerText,
        businessName: document.getElementById('biz-name').innerText,
        client: { name: clientName, address: document.getElementById('client-addr').innerText, gstin: document.getElementById('client-gst').innerText },
        items: Array.from(document.querySelectorAll('#rows tr')).map(row => ({
            description: row.querySelector('.item-name').value,
            qty: parseFloat(row.querySelector('.qty').value),
            price: parseFloat(row.querySelector('.rate').value),
            gst: parseFloat(row.querySelector('.gst').value),
            total: cleanNum(row.querySelector('.row-total').innerText)
        })),
        grandTotal: cleanNum(document.getElementById('grand-total').innerText)
    };

    try {
        const method = currentEditId ? 'PUT' : 'POST';
        const url = currentEditId ? `${API_URL}/invoices/${currentEditId}` : `${API_URL}/invoices`;

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(invoiceData)
        });
        
        if (res.ok) {
            alert(currentEditId ? "✅ Updated!" : "✅ Saved!");
            resetForm();
            showSection('view');
        } else {
            alert("❌ Save Failed: Duplicate ID?");
        }
    } catch (err) { alert("⚠️ Backend offline."); }
}

// --- SETTINGS ---
async function saveSettings() {
    const profile = {
        name: document.getElementById('set-biz-name').value,
        address: document.getElementById('set-biz-addr').value,
        gstin: document.getElementById('set-biz-gst').value,
        upi: document.getElementById('set-biz-upi').value
    };
    try {
        await fetch(`${API_URL}/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
        localStorage.setItem('quickbill_profile', JSON.stringify(profile));
        alert("✅ Settings Updated!");
        loadSettings();
        showSection('new');
    } catch (e) { alert("Server Error"); }
}

async function loadSettings() {
    try {
        const res = await fetch(`${API_URL}/profile`);
        const data = await res.json();
        if (data.name) {
            document.getElementById('set-biz-name').value = data.name;
            document.getElementById('set-biz-addr').value = data.address;
            document.getElementById('set-biz-gst').value = data.gstin;
            document.getElementById('set-biz-upi').value = data.upi;
            document.getElementById('biz-name').innerText = data.name;
            document.getElementById('biz-addr').innerText = data.address;
            document.getElementById('biz-gst').innerText = data.gstin;
            window.userUPI = data.upi;
        }
    } catch (e) {}
}

async function fetchHistory() {
    const res = await fetch(`${API_URL}/invoices`);
    const data = await res.json();
    document.getElementById('invoice-list-body').innerHTML = data.map(inv => `
        <tr>
            <td>${inv.date}</td>
            <td><strong>${inv.invoiceNo}</strong></td>
            <td>${inv.client.name}</td>
            <td>₹ ${inv.grandTotal.toLocaleString()}</td>
            <td><span class="status-pill">Paid</span></td>
            <td><button class="btn btn-outline" onclick="editInvoice('${inv._id}')">✏️ Edit</button></td>
        </tr>`).join('');
}

// --- HELPERS ---
function generateQR(amount) {
    const div = document.getElementById('qrcode');
    div.innerHTML = "";
    if(amount > 0 && window.userUPI) {
        const upi = `upi://pay?pa=${window.userUPI}&pn=${encodeURIComponent(document.getElementById('biz-name').innerText)}&am=${amount}&cu=INR`;
        new QRCode(div, { text: upi, width: 80, height: 80 });
    }
}

async function fetchCRM() {
    const res = await fetch(`${API_URL}/invoices`);
    const data = await res.json();
    const map = new Map();
    data.forEach(i => map.set(i.client.name, i.client));
    window.clientData = map;
    document.getElementById('client-selector').innerHTML = '<option value="">-- Select Client --</option>' + Array.from(map.keys()).map(k => `<option value="${k}">${k}</option>`).join('');
    document.getElementById('crm-body').innerHTML = Array.from(map.values()).map(c => `<tr><td><strong>${c.name}</strong></td><td>${c.gstin}</td><td>Active</td></tr>`).join('');
}

function fillClientDetails() {
    const c = window.clientData.get(document.getElementById('client-selector').value);
    if(c) { document.getElementById('client-name').innerText = c.name; document.getElementById('client-addr').innerText = c.address; document.getElementById('client-gst').innerText = c.gstin; }
}

async function fetchStats() {
    const res = await fetch(`${API_URL}/stats`);
    const s = await res.json();
    document.getElementById('stat-sales').innerText = "₹ " + s.totalRevenue.toLocaleString();
    document.getElementById('stat-pending').innerText = "₹ " + s.pending.toLocaleString();
    document.getElementById('stat-count').innerText = s.count;
    updateChart(s.monthlyData);
}

function updateChart(monthlyData) {
    const ctx = document.getElementById('revenueChart').getContext('2d');
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, { type: 'line', data: { labels: Object.keys(monthlyData), datasets: [{ label: 'Sales', data: Object.values(monthlyData), borderColor: '#2563eb', fill: true, backgroundColor: 'rgba(37, 99, 235, 0.1)', tension: 0.3 }] } });
}

// --- ENHANCED PDF DOWNLOAD ---
function downloadPDF() {
    // 1. Clean the UI
    const style = document.createElement('style'); 
    style.id = 'pdf-clean-style';
    style.innerHTML = `
        .no-print { display: none !important; } 
        .editable-field { border: none !important; background: transparent !important; } 
        .table-wrapper input { border: none !important; background: transparent !important; padding: 0 !important; }
        /* Force the signature container to stay visible */
        #signature-preview { opacity: 1 !important; visibility: visible !important; }
    `;
    document.head.appendChild(style);
    
    // 2. Set PDF Options
    const opt = {
        margin: 10, 
        filename: `${document.getElementById('inv-no').innerText.replace('#', '')}.pdf`,
        image: { type: 'jpeg', quality: 1 }, 
        html2canvas: { 
            scale: 2, 
            useCORS: true, 
            allowTaint: true, // Forces image rendering
            logging: true     // Helps catch render errors
        }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // 3. Generate and Cleanup
    html2pdf().set(opt).from(document.getElementById('bill-area')).save().then(() => {
        document.getElementById('pdf-clean-style').remove();
    });
}

function toggleProforma() { 
    document.getElementById('inv-label').innerText = document.getElementById('invoice-mode').value.toUpperCase(); 
}

// Initialize chat history on page load
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch(`${API_URL}/ai/history/last`);
        const data = await res.json();
        if(data) {
            currentChatId = data._id;
            const output = document.getElementById('chat-output');
            output.innerHTML = "";
            data.messages.forEach(m => appendMessage(m.role === 'user' ? 'user' : 'ai', m.content));
        }
    } catch (e) { console.log("Starting fresh chat session."); }
});

async function askERPBot() {
    const queryInput = document.getElementById('user-query');
    const query = queryInput.value.trim();
    const output = document.getElementById('chat-output');
    
    if(!query) return;

    appendMessage('user', query);
    queryInput.value = ""; 

    const loadingId = 'ai-' + Date.now();
    appendMessage('ai', "⌛ Compiling report...", loadingId);

    try {
        const dataRes = await fetch(`${API_URL}/invoices`);
        const allInvoices = await dataRes.json();

        const aiRes = await fetch(`${API_URL}/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: query,
                contextData: allInvoices,
                chatId: currentChatId
            })
        });

        const result = await aiRes.json();
        currentChatId = result.chatId;
        let answer = result.answer;

        // CHECK FOR PDF TRIGGER
        if (answer.includes("[GENERATE_PDF]")) {
            answer = answer.replace("[GENERATE_PDF]", "").trim();
            
            // Decide which PDF to generate based on query
            if (query.toLowerCase().includes("month") || 
                query.toLowerCase().includes("sales") || 
                query.toLowerCase().includes("report") ||
                query.toLowerCase().includes("summary")) {
                generateSummaryPDF(answer, allInvoices);
            } else {
                downloadPDF();
            }
        }

        document.getElementById(loadingId).innerText = answer;
        
    } catch (e) {
        console.error(e);
        document.getElementById(loadingId).innerText = `❌ Error: ${e.message}`;
    }
}

// --- ENHANCED PDF GENERATOR WITH PROPER DATA FORMATTING ---
function generateSummaryPDF(reportText, invoiceData) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // --- 1. CLEAN THE TEXT FIRST ---
    // Remove stars (**), remove the trigger tag, and replace the Rupee symbol
    let cleanText = reportText
        .replace(/\*\*/g, '') 
        .replace(/₹/g, 'Rs. ') 
        .replace(/\[GENERATE_PDF\]/gi, '')
        .trim();

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (2 * margin);
    let yPosition = margin;

    // --- 2. HEADER ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(37, 99, 235); // Blue color
    doc.text("Business Sales Report", margin, yPosition);
    yPosition += 10;

    // Blue Line
    doc.setDrawColor(37, 99, 235);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;

    // --- 3. AI SUMMARY TEXT ---
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    
    // Use splitTextToSize on the CLEANED text
    const splitLines = doc.splitTextToSize(cleanText, contentWidth);
    doc.text(splitLines, margin, yPosition);
    
    // Calculate how much space the text took
    const textHeight = (splitLines.length * 7); 
    yPosition += textHeight + 10;

    // --- 4. DATA TABLE ---
    if (invoiceData && invoiceData.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.text("Transaction Details", margin, yPosition);
        yPosition += 7;

        // Table Header
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, yPosition, contentWidth, 8, 'F');
        doc.setFontSize(10);
        doc.text("Date", margin + 2, yPosition + 6);
        doc.text("Client", margin + 40, yPosition + 6);
        doc.text("Amount", margin + 130, yPosition + 6);
        yPosition += 10;

        // Table Rows
        doc.setFont("helvetica", "normal");
        invoiceData.slice(0, 15).forEach(inv => {
            if (yPosition > pageHeight - 20) { doc.addPage(); yPosition = 20; }
            
            doc.text(String(inv.date), margin + 2, yPosition);
            doc.text(String(inv.client.name).substring(0, 25), margin + 40, yPosition);
            // Use Rs. instead of ₹ symbol here too
            doc.text(`Rs. ${inv.grandTotal.toLocaleString()}`, margin + 130, yPosition);
            
            yPosition += 7;
        });
    }

    // --- 5. FOOTER ---
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated by QuickBill AI on ${new Date().toLocaleString()}`, margin, pageHeight - 10);

    doc.save(`Sales_Report_${Date.now()}.pdf`);
}

function appendMessage(role, text, id = null) {
    const output = document.getElementById('chat-output');
    const msgDiv = document.createElement('div');
    msgDiv.id = id || '';
    msgDiv.className = `msg ${role === 'user' ? 'user-msg' : 'ai-msg'}`;
    
    // Replace newlines with <br> and handle simple Markdown-style bolding
    // Alternatively, use: msgDiv.innerHTML = marked.parse(text); 
    let formattedText = text
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); 

    msgDiv.innerHTML = formattedText;
    
    output.appendChild(msgDiv);
    output.scrollTop = output.scrollHeight;
}

function resetChat() {
    currentChatId = null;
    document.getElementById('chat-output').innerHTML = '<div class="msg ai-msg">💬 Chat reset. How can I help?</div>';
}

function toggleChat() {
    const chatWindow = document.getElementById('chat-widget-window');
    chatWindow.classList.toggle('hidden');
    
    // Optional: Auto-focus the input box when opened
    if (!chatWindow.classList.contains('hidden')) {
        setTimeout(() => {
            document.getElementById('user-query').focus();
        }, 300); // Wait for the animation to finish
    }
}