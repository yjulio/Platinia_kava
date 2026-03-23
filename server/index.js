// ===== Kava Sales Book — Backend API =====
'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'kava.db');
const PORT = process.env.PORT || 4000;

// ---- Database Setup ----
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    kilos REAL NOT NULL,
    costPerKilo REAL NOT NULL,
    amount REAL NOT NULL,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS debts (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    member TEXT NOT NULL,
    amount REAL NOT NULL,
    notes TEXT DEFAULT '',
    paid INTEGER DEFAULT 0,
    paidDate TEXT
  );

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    memberId TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    role TEXT DEFAULT 'Member',
    joined TEXT NOT NULL,
    fee REAL DEFAULT 0,
    feeStatus TEXT DEFAULT 'Unpaid',
    feePaidAmount REAL DEFAULT 0,
    consumption REAL DEFAULT 0,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrate: add consumption column if missing
try {
    db.prepare('SELECT consumption FROM members LIMIT 1').get();
} catch (_) {
    db.exec('ALTER TABLE members ADD COLUMN consumption REAL DEFAULT 0');
}

// Seed default settings
const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

if (!getSettingStmt.get('adminPin')) {
    setSettingStmt.run('adminPin', '1234');
}
if (!getSettingStmt.get('timeout')) {
    setSettingStmt.run('timeout', '15');
}

// ---- ID Generation ----
function generateId() {
    return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// ---- Express App ----
const app = express();
app.use(express.json({ limit: '5mb' }));

// ---- Sales ----
app.get('/api/sales', (_req, res) => {
    const rows = db.prepare('SELECT * FROM sales ORDER BY date DESC').all();
    res.json(rows);
});

app.post('/api/sales', (req, res) => {
    const { date, kilos, costPerKilo, amount, notes } = req.body;
    if (!date || !kilos || !costPerKilo || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = generateId();
    db.prepare('INSERT INTO sales (id, date, kilos, costPerKilo, amount, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, date, +kilos, +costPerKilo, +amount, notes || '');
    res.status(201).json({ id });
});

app.delete('/api/sales/:id', (req, res) => {
    db.prepare('DELETE FROM sales WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// ---- Expenses ----
app.get('/api/expenses', (_req, res) => {
    const rows = db.prepare('SELECT * FROM expenses ORDER BY date DESC').all();
    res.json(rows);
});

app.post('/api/expenses', (req, res) => {
    const { date, category, description, amount, notes } = req.body;
    if (!date || !category || !description || amount == null) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = generateId();
    db.prepare('INSERT INTO expenses (id, date, category, description, amount, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, date, category, description, +amount, notes || '');
    res.status(201).json({ id });
});

app.delete('/api/expenses/:id', (req, res) => {
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// ---- Debts ----
app.get('/api/debts', (_req, res) => {
    const rows = db.prepare('SELECT * FROM debts ORDER BY date DESC').all();
    rows.forEach(r => { r.paid = !!r.paid; });
    res.json(rows);
});

app.post('/api/debts', (req, res) => {
    const { date, member, amount, notes } = req.body;
    if (!date || !member || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const id = generateId();
    db.prepare('INSERT INTO debts (id, date, member, amount, notes, paid, paidDate) VALUES (?, ?, ?, ?, ?, 0, NULL)')
        .run(id, date, member, +amount, notes || '');
    res.status(201).json({ id });
});

app.put('/api/debts/:id/pay', (req, res) => {
    const { paidDate } = req.body;
    db.prepare('UPDATE debts SET paid = 1, paidDate = ? WHERE id = ?')
        .run(paidDate || new Date().toISOString().split('T')[0], req.params.id);
    res.json({ ok: true });
});

app.delete('/api/debts/:id', (req, res) => {
    db.prepare('DELETE FROM debts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// ---- Members ----
app.get('/api/members', (_req, res) => {
    const rows = db.prepare('SELECT * FROM members ORDER BY name ASC').all();
    res.json(rows);
});

app.post('/api/members', (req, res) => {
    const { memberId, name, phone, role, joined, fee, feeStatus, feePaidAmount, consumption, notes } = req.body;
    if (!memberId || !name || !joined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const existing = db.prepare('SELECT id FROM members WHERE memberId = ?').get(memberId);
    if (existing) {
        return res.status(409).json({ error: 'Member ID already exists' });
    }
    const id = generateId();
    db.prepare(`INSERT INTO members (id, memberId, name, phone, role, joined, fee, feeStatus, feePaidAmount, consumption, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, memberId, name, phone || '', role || 'Member', joined, +fee || 0, feeStatus || 'Unpaid', +feePaidAmount || 0, +consumption || 0, notes || '');
    res.status(201).json({ id });
});

app.put('/api/members/:id', (req, res) => {
    const { memberId, name, phone, role, joined, fee, feeStatus, feePaidAmount, consumption, notes } = req.body;
    if (!memberId || !name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    // Check for duplicate memberId (excluding self)
    const dup = db.prepare('SELECT id FROM members WHERE memberId = ? AND id != ?').get(memberId, req.params.id);
    if (dup) {
        return res.status(409).json({ error: 'Member ID already exists' });
    }
    db.prepare(`UPDATE members SET memberId=?, name=?, phone=?, role=?, joined=?, fee=?, feeStatus=?, feePaidAmount=?, consumption=?, notes=? WHERE id=?`)
        .run(memberId, name, phone || '', role || 'Member', joined, +fee || 0, feeStatus || 'Unpaid', +feePaidAmount || 0, +consumption || 0, notes || '', req.params.id);
    res.json({ ok: true });
});

app.delete('/api/members/:id', (req, res) => {
    db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// Bulk import members
app.post('/api/members/bulk', (req, res) => {
    const { members: list } = req.body;
    if (!Array.isArray(list)) {
        return res.status(400).json({ error: 'Expected array of members' });
    }
    const insert = db.prepare(`INSERT OR IGNORE INTO members (id, memberId, name, phone, role, joined, fee, feeStatus, feePaidAmount, consumption, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((items) => {
        let added = 0;
        for (const m of items) {
            const result = insert.run(
                generateId(), m.memberId, m.name, m.phone || '', m.role || 'Member',
                m.joined || new Date().toISOString().split('T')[0],
                +m.fee || 0, m.feeStatus || 'Unpaid', +m.feePaidAmount || 0, +m.consumption || 0, m.notes || ''
            );
            if (result.changes > 0) added++;
        }
        return added;
    });
    const added = tx(list);
    res.json({ added, total: list.length });
});

// ---- Settings ----
app.get('/api/settings/:key', (req, res) => {
    const row = getSettingStmt.get(req.params.key);
    res.json({ value: row ? row.value : null });
});

app.put('/api/settings/:key', (req, res) => {
    const { value } = req.body;
    if (value == null) {
        return res.status(400).json({ error: 'Missing value' });
    }
    setSettingStmt.run(req.params.key, String(value));
    res.json({ ok: true });
});

// ---- Auth (PIN verification) ----
app.post('/api/auth/verify', (req, res) => {
    const { pin } = req.body;
    const stored = getSettingStmt.get('adminPin');
    const correct = stored && stored.value === pin;
    res.json({ valid: correct });
});

app.put('/api/auth/pin', (req, res) => {
    const { currentPin, newPin } = req.body;
    const stored = getSettingStmt.get('adminPin');
    if (!stored || stored.value !== currentPin) {
        return res.status(403).json({ error: 'Current PIN is incorrect' });
    }
    if (!newPin || newPin.length < 4 || !/^\d+$/.test(newPin)) {
        return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    }
    setSettingStmt.run('adminPin', newPin);
    res.json({ ok: true });
});

// ---- Start ----
app.listen(PORT, '127.0.0.1', () => {
    console.log(`Kava API running on http://127.0.0.1:${PORT}`);
});
