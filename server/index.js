// ===== Kava Sales Book — Backend API (JSON file storage) =====
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const DATA_PATH = path.join(__dirname, 'kava-data.json');
const PORT = process.env.PORT || 4000;

// ---- Data Layer ----
function loadData() {
    if (!fs.existsSync(DATA_PATH)) {
        return {
            sales: [],
            expenses: [],
            debts: [],
            settings: { adminPin: '1234', timeout: '15' }
        };
    }
    try {
        return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    } catch (_) {
        return { sales: [], expenses: [], debts: [], settings: { adminPin: '1234', timeout: '15' } };
    }
}

function saveData(data) {
    const tmp = DATA_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_PATH);
}

// Initialise on startup
let store = loadData();
if (!store.settings) store.settings = { adminPin: '1234', timeout: '15' };
if (!store.sales) store.sales = [];
if (!store.expenses) store.expenses = [];
if (!store.debts) store.debts = [];
if (!store.transactions) store.transactions = [];
saveData(store);

// ---- ID Generation ----
function generateId() {
    return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// ---- Express App ----
const app = express();
app.use(express.json({ limit: '5mb' }));

// ---- Sales ----
app.get('/api/sales', (_req, res) => {
    store = loadData();
    res.json([...store.sales].sort((a, b) => b.date.localeCompare(a.date)));
});

app.post('/api/sales', (req, res) => {
    const { date, kilos, costPerKilo, amount, notes } = req.body;
    if (!date || !kilos || !costPerKilo || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    store = loadData();
    const record = { id: generateId(), date, kilos: +kilos, costPerKilo: +costPerKilo, amount: +amount, notes: notes || '' };
    store.sales.push(record);
    saveData(store);
    res.status(201).json({ id: record.id });
});

app.delete('/api/sales/:id', (req, res) => {
    store = loadData();
    store.sales = store.sales.filter(s => s.id !== req.params.id);
    saveData(store);
    res.json({ ok: true });
});

// ---- Expenses ----
app.get('/api/expenses', (_req, res) => {
    store = loadData();
    res.json([...store.expenses].sort((a, b) => b.date.localeCompare(a.date)));
});

app.post('/api/expenses', (req, res) => {
    const { date, category, description, amount, notes } = req.body;
    if (!date || !category || !description || amount == null) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    store = loadData();
    const record = { id: generateId(), date, category, description, amount: +amount, notes: notes || '' };
    store.expenses.push(record);
    saveData(store);
    res.status(201).json({ id: record.id });
});

app.delete('/api/expenses/:id', (req, res) => {
    store = loadData();
    store.expenses = store.expenses.filter(e => e.id !== req.params.id);
    saveData(store);
    res.json({ ok: true });
});

// ---- Debts ----
app.get('/api/debts', (_req, res) => {
    store = loadData();
    res.json([...store.debts].sort((a, b) => b.date.localeCompare(a.date)));
});

app.post('/api/debts', (req, res) => {
    const { date, member, amount, notes } = req.body;
    if (!date || !member || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    store = loadData();
    const record = { id: generateId(), date, member, amount: +amount, notes: notes || '', paid: false, paidDate: null };
    store.debts.push(record);
    saveData(store);
    res.status(201).json({ id: record.id });
});

app.put('/api/debts/:id/pay', (req, res) => {
    const { paidDate } = req.body;
    store = loadData();
    const debt = store.debts.find(d => d.id === req.params.id);
    if (!debt) return res.status(404).json({ error: 'Not found' });
    debt.paid = true;
    debt.paidDate = paidDate || new Date().toISOString().split('T')[0];
    saveData(store);
    res.json({ ok: true });
});

app.delete('/api/debts/:id', (req, res) => {
    store = loadData();
    store.debts = store.debts.filter(d => d.id !== req.params.id);
    saveData(store);
    res.json({ ok: true });
});

// ---- Settings ----
app.get('/api/settings/:key', (req, res) => {
    store = loadData();
    const value = store.settings[req.params.key] ?? null;
    res.json({ value });
});

app.put('/api/settings/:key', (req, res) => {
    const { value } = req.body;
    if (value == null) return res.status(400).json({ error: 'Missing value' });
    store = loadData();
    store.settings[req.params.key] = String(value);
    saveData(store);
    res.json({ ok: true });
});

// ---- Auth (PIN verification) ----
app.post('/api/auth/verify', (req, res) => {
    store = loadData();
    const correct = store.settings.adminPin === req.body.pin;
    res.json({ valid: correct });
});

app.put('/api/auth/pin', (req, res) => {
    const { currentPin, newPin } = req.body;
    store = loadData();
    if (store.settings.adminPin !== currentPin) {
        return res.status(403).json({ error: 'Current PIN is incorrect' });
    }
    if (!newPin || newPin.length < 4 || !/^\d+$/.test(newPin)) {
        return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    }
    store.settings.adminPin = newPin;
    saveData(store);
    res.json({ ok: true });
});

// ---- Transactions (individual barman till entries) ----
app.get('/api/transactions', (_req, res) => {
    store = loadData();
    res.json([...store.transactions].sort((a, b) => {
        const dc = b.date.localeCompare(a.date);
        return dc !== 0 ? dc : b.time.localeCompare(a.time);
    }));
});

app.post('/api/transactions', (req, res) => {
    const { id, date, time, amount, note } = req.body;
    if (!date || !amount) return res.status(400).json({ error: 'Missing required fields' });
    store = loadData();
    const record = { id: id || generateId(), date, time: time || '', amount: +amount, note: note || '' };
    if (!store.transactions.find(t => t.id === record.id)) {
        store.transactions.push(record);
        saveData(store);
    }
    res.status(201).json(record);
});

app.post('/api/transactions/sync', (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.json({ synced: 0 });
    store = loadData();
    const existingIds = new Set(store.transactions.map(t => t.id));
    let synced = 0;
    items.forEach(item => {
        if (!item.date || !item.amount) return;
        const id = item.id || generateId();
        if (!existingIds.has(id)) {
            store.transactions.push({ id, date: item.date, time: item.time || '', amount: +item.amount, note: item.note || '' });
            existingIds.add(id);
            synced++;
        }
    });
    if (synced > 0) saveData(store);
    res.json({ synced });
});

app.delete('/api/transactions/:id', (req, res) => {
    store = loadData();
    store.transactions = store.transactions.filter(t => t.id !== req.params.id);
    saveData(store);
    res.json({ ok: true });
});

// ---- Serve frontend static files ----
app.use(express.static(path.join(__dirname, '..')));

// ---- Start ----
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kava Sales Book running at http://127.0.0.1:${PORT}`);
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
        for (const net of iface) {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`  Barman page (phone): http://${net.address}:${PORT}/barman.html`);
            }
        }
    }
});
