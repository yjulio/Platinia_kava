// ===== Kava Sales Book - Application Logic =====

(function () {
    'use strict';

    // ---- Data Layer (API-backed) ----
    const API = '/api';
    const DEFAULT_PIN = '1234';
    const MAX_PIN_ATTEMPTS = 5;
    const LOCKOUT_SECONDS = 60;

    async function api(path, opts) {
        const res = await fetch(API + path, {
            headers: { 'Content-Type': 'application/json' },
            ...opts,
            body: opts?.body ? JSON.stringify(opts.body) : undefined,
        });
        return res.json();
    }

    async function loadAllData() {
        const [s, e, d] = await Promise.all([
            api('/sales'), api('/expenses'), api('/debts')
        ]);
        sales = s; expenses = e; debts = d;
    }

    let sales = [];
    let expenses = [];
    let debts = [];
    let activeFilter = null;
    let currentRole = null;
    let failedAttempts = 0;
    let lockoutUntil = 0;
    let sessionTimer = null;
    let sessionEndTime = 0;

    // ---- DOM Helpers ----
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ---- Bootstrap Instances (created after DOMContentLoaded) ----
    let deleteModal, bsToast;

    // ---- Utility ----
    function formatCurrency(amount) {
        return Number(amount).toLocaleString() + ' VT';
    }
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    function todayISO() { return new Date().toISOString().split('T')[0]; }

    // CSV helpers
    function csvEscape(val) {
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }
    function parseCSVLine(line) {
        const result = [];
        let current = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
                else if (ch === '"') { inQuotes = false; }
                else { current += ch; }
            } else {
                if (ch === '"') { inQuotes = true; }
                else if (ch === ',') { result.push(current); current = ''; }
                else { current += ch; }
            }
        }
        result.push(current);
        return result;
    }

    function showToast(message, isError) {
        const toastEl = $('#toast');
        const bodyEl = $('#toastBody');
        bodyEl.textContent = message;
        toastEl.classList.toggle('toast-error', !!isError);
        bsToast.show();
    }

    // ---- Filtering ----
    function filteredSales() {
        if (!activeFilter) return sales;
        return sales.filter(s => s.date.startsWith(activeFilter));
    }
    function filteredExpenses() {
        if (!activeFilter) return expenses;
        return expenses.filter(e => e.date.startsWith(activeFilter));
    }

    // ---- Dashboard ----
    function updateDashboard() {
        const fs = filteredSales();
        const fe = filteredExpenses();
        const totalSales = fs.reduce((sum, s) => sum + (s.amount || (s.kilos || 0) * (s.pricePerKilo || 0)), 0);
        const totalKilos = fs.reduce((sum, s) => sum + (s.kilos || 0), 0);
        const totalExpenses = fe.reduce((sum, e) => sum + e.amount, 0);
        const profit = totalSales - totalExpenses;

        $('#totalSales').textContent = formatCurrency(totalSales);
        $('#totalKilos').textContent = totalKilos.toFixed(2) + ' kg';
        $('#totalExpenses').textContent = formatCurrency(totalExpenses);

        const profitEl = $('#netProfit');
        profitEl.textContent = formatCurrency(profit);
        profitEl.classList.toggle('negative', profit < 0);
        profitEl.classList.toggle('text-success', profit >= 0);
        profitEl.classList.toggle('text-danger', profit < 0);
    }

    // ---- Sale Form ----
    function initSaleForm() {
        const saleDate = $('#saleDate');
        const saleKilos = $('#saleKilos');
        const saleCostPerKilo = $('#saleCostPerKilo');
        const saleAmount = $('#saleAmount');
        const saleNotes = $('#saleNotes');
        const saleForm = $('#saleForm');
        const salePurchaseCost = $('#salePurchaseCost');
        const saleNightProfit = $('#saleNightProfit');

        saleDate.value = todayISO();

        function updateSaleCalc() {
            const kilos = parseFloat(saleKilos.value) || 0;
            const costPerKilo = parseFloat(saleCostPerKilo.value) || 0;
            const earned = parseFloat(saleAmount.value) || 0;
            const purchaseCost = kilos * costPerKilo;
            const profit = earned - purchaseCost;
            salePurchaseCost.textContent = formatCurrency(purchaseCost);
            saleNightProfit.textContent = formatCurrency(profit);
            saleNightProfit.className = 'fs-5 fw-bold ' + (profit >= 0 ? 'text-success' : 'text-danger');
        }
        saleKilos.addEventListener('input', updateSaleCalc);
        saleCostPerKilo.addEventListener('input', updateSaleCalc);
        saleAmount.addEventListener('input', updateSaleCalc);

        saleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const kilos = parseFloat(saleKilos.value);
            const costPerKilo = parseFloat(saleCostPerKilo.value);
            const amount = parseFloat(saleAmount.value);
            if (!kilos || kilos <= 0) { showToast('Please enter valid kilos', true); return; }
            if (!costPerKilo || costPerKilo <= 0) { showToast('Please enter cost per kilo', true); return; }
            if (!amount || amount <= 0) { showToast('Please enter a valid amount earned', true); return; }

            await api('/sales', {
                method: 'POST', body: {
                    date: saleDate.value, kilos, costPerKilo, amount, notes: saleNotes.value.trim()
                }
            });
            saleForm.reset();
            saleDate.value = todayISO();
            salePurchaseCost.textContent = '0 VT';
            saleNightProfit.textContent = '0 VT';
            saleNightProfit.className = 'fs-5 fw-bold text-success';
            showToast('Nightly sales recorded!');
            await refreshAll();
        });
    }

    // ---- Expense Form ----
    function initExpenseForm() {
        const expenseDate = $('#expenseDate');
        const expenseForm = $('#expenseForm');
        expenseDate.value = todayISO();

        expenseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = parseFloat($('#expenseAmount').value);
            const description = $('#expenseDescription').value.trim();
            if (!description) { showToast('Please enter a description', true); return; }
            if (!amount || amount < 0) { showToast('Please enter a valid amount', true); return; }

            await api('/expenses', {
                method: 'POST', body: {
                    date: expenseDate.value,
                    category: $('#expenseCategory').value,
                    description,
                    amount,
                    notes: $('#expenseNotes').value.trim(),
                }
            });
            expenseForm.reset();
            expenseDate.value = todayISO();
            showToast('Expense recorded!');
            await refreshAll();
        });
    }

    // ---- Delete Handling (Bootstrap Modal) ----
    let pendingDeleteType = null;
    let pendingDeleteId = null;

    function requestDelete(type, id) {
        pendingDeleteType = type;
        pendingDeleteId = id;
        deleteModal.show();
    }

    function initDeleteModal() {
        deleteModal = new bootstrap.Modal($('#confirmModal'));
        const deletePinInput = $('#deletePinInput');
        const deletePinError = $('#deletePinError');

        // Reset PIN field when modal opens
        $('#confirmModal').addEventListener('show.bs.modal', () => {
            deletePinInput.value = '';
            deletePinError.style.display = 'none';
        });
        $('#confirmModal').addEventListener('shown.bs.modal', () => {
            deletePinInput.focus();
        });

        // Allow Enter key in PIN field
        deletePinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); $('#confirmDelete').click(); }
        });

        $('#confirmDelete').addEventListener('click', async () => {
            // Verify PIN before deleting
            const pinCheck = await api('/auth/verify', { method: 'POST', body: { pin: deletePinInput.value } });
            if (!pinCheck.valid) {
                deletePinError.style.display = 'block';
                deletePinInput.value = '';
                deletePinInput.focus();
                return;
            }

            if (pendingDeleteType === 'sale') {
                await api('/sales/' + pendingDeleteId, { method: 'DELETE' });
                showToast('Sale deleted');
            } else if (pendingDeleteType === 'expense') {
                await api('/expenses/' + pendingDeleteId, { method: 'DELETE' });
                showToast('Expense deleted');
            } else if (pendingDeleteType === 'debt') {
                await api('/debts/' + pendingDeleteId, { method: 'DELETE' });
                showToast('Debt deleted');
            }
            deleteModal.hide();
            pendingDeleteType = null;
            pendingDeleteId = null;
            await refreshAll();
        });
    }

    // ---- Render Sales Table ----
    function renderSalesTable() {
        const fs = filteredSales().sort((a, b) => b.date.localeCompare(a.date));
        const tbody = $('#salesTableBody');
        const noMsg = $('#noSalesMsg');
        noMsg.style.display = fs.length ? 'none' : 'block';
        tbody.innerHTML = '';

        fs.forEach(s => {
            const amount = s.amount || (s.kilos || 0) * (s.pricePerKilo || 0);
            const kilos = s.kilos || 0;
            const costPerKilo = s.costPerKilo || s.pricePerKilo || 0;
            const purchaseCost = kilos * costPerKilo;
            const nightProfit = amount - purchaseCost;
            const profitClass = nightProfit >= 0 ? 'text-success' : 'text-danger';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(s.date)}</td>
                <td>${kilos.toFixed(2)} kg</td>
                <td>${formatCurrency(costPerKilo)}</td>
                <td class="text-danger">${formatCurrency(purchaseCost)}</td>
                <td><strong class="text-gold">${formatCurrency(amount)}</strong></td>
                <td class="${profitClass} fw-bold">${formatCurrency(nightProfit)}</td>
                <td class="text-muted">${escapeHtml(s.notes || '—')}</td>
                <td class="text-center"><button class="btn-icon-delete" title="Delete"><i class="bi bi-trash"></i></button></td>
            `;
            tr.querySelector('.btn-icon-delete').addEventListener('click', () => requestDelete('sale', s.id));
            tbody.appendChild(tr);
        });
    }

    // ---- Render Expenses Table ----
    function renderExpensesTable() {
        const fe = filteredExpenses().sort((a, b) => b.date.localeCompare(a.date));
        const tbody = $('#expensesTableBody');
        const noMsg = $('#noExpensesMsg');
        noMsg.style.display = fe.length ? 'none' : 'block';
        tbody.innerHTML = '';

        fe.forEach(e => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(e.date)}</td>
                <td><span class="badge bg-secondary bg-opacity-50">${escapeHtml(e.category)}</span></td>
                <td>${escapeHtml(e.description)}</td>
                <td><strong class="text-danger">${formatCurrency(e.amount)}</strong></td>
                <td class="text-muted">${escapeHtml(e.notes || '—')}</td>
                <td class="text-center"><button class="btn-icon-delete" title="Delete"><i class="bi bi-trash"></i></button></td>
            `;
            tr.querySelector('.btn-icon-delete').addEventListener('click', () => requestDelete('expense', e.id));
            tbody.appendChild(tr);
        });
    }

    // ---- Render Daily Summary ----
    function renderDailySummary() {
        const fs = filteredSales();
        const fe = filteredExpenses();
        const dateSet = new Set();
        fs.forEach(s => dateSet.add(s.date));
        fe.forEach(e => dateSet.add(e.date));

        const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));
        const tbody = $('#summaryTableBody');
        const noMsg = $('#noSummaryMsg');
        noMsg.style.display = dates.length ? 'none' : 'block';
        tbody.innerHTML = '';

        dates.forEach(date => {
            const daySalesEntries = fs.filter(s => s.date === date);
            const dayKilos = daySalesEntries.reduce((sum, s) => sum + (s.kilos || 0), 0);
            const dayPurchaseCost = daySalesEntries.reduce((sum, s) => sum + (s.kilos || 0) * (s.costPerKilo || s.pricePerKilo || 0), 0);
            const daySales = daySalesEntries.reduce((sum, s) => sum + (s.amount || (s.kilos || 0) * (s.pricePerKilo || 0)), 0);
            const dayExpenses = fe.filter(e => e.date === date).reduce((sum, e) => sum + e.amount, 0);
            const dayProfit = daySales - dayPurchaseCost - dayExpenses;

            let profitClass = 'profit-zero';
            if (dayProfit > 0) profitClass = 'profit-positive';
            else if (dayProfit < 0) profitClass = 'profit-negative';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${escapeHtml(date)}</td>
                <td>${dayKilos.toFixed(2)} kg</td>
                <td>${formatCurrency(dayPurchaseCost)}</td>
                <td>${formatCurrency(daySales)}</td>
                <td>${formatCurrency(dayExpenses)}</td>
                <td class="${profitClass}">${formatCurrency(dayProfit)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ---- Filter ----
    function initFilter() {
        $('#btnFilterApply').addEventListener('click', () => {
            const val = $('#filterMonth').value;
            if (!val) { showToast('Select a month first', true); return; }
            activeFilter = val;
            refreshAll();
        });
        $('#btnFilterClear').addEventListener('click', () => {
            activeFilter = null;
            $('#filterMonth').value = '';
            refreshAll();
        });
    }

    // ---- Report Generation ----
    function initReport() {
        const reportMonth = $('#reportMonth');
        const btnGenerate = $('#btnGenerateReport');
        const btnPrint = $('#btnPrintReport');
        const reportOutput = $('#reportOutput');
        const reportContent = $('#reportContent');

        btnGenerate.addEventListener('click', () => {
            const month = reportMonth.value;
            if (!month) { showToast('Select a month first', true); return; }

            const [year, mon] = month.split('-');
            const monthName = new Date(year, parseInt(mon) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

            const ms = sales.filter(s => s.date.startsWith(month));
            const me = expenses.filter(e => e.date.startsWith(month));

            const totalSalesAmt = ms.reduce((sum, s) => sum + (s.amount || (s.kilos || 0) * (s.pricePerKilo || 0)), 0);
            const totalKilos = ms.reduce((sum, s) => sum + (s.kilos || 0), 0);
            const totalPurchaseCost = ms.reduce((sum, s) => sum + (s.kilos || 0) * (s.costPerKilo || s.pricePerKilo || 0), 0);
            const totalExpensesAmt = me.reduce((sum, e) => sum + e.amount, 0);
            const netProfit = totalSalesAmt - totalPurchaseCost - totalExpensesAmt;

            const expByCat = {};
            me.forEach(e => { expByCat[e.category] = (expByCat[e.category] || 0) + e.amount; });

            const dateSet = new Set();
            ms.forEach(s => dateSet.add(s.date));
            me.forEach(e => dateSet.add(e.date));
            const dates = Array.from(dateSet).sort();

            const dailyRows = dates.map(date => {
                const dayS = ms.filter(s => s.date === date);
                const dayE = me.filter(e => e.date === date);
                const dKilos = dayS.reduce((sum, s) => sum + (s.kilos || 0), 0);
                const dPurchase = dayS.reduce((sum, s) => sum + (s.kilos || 0) * (s.costPerKilo || s.pricePerKilo || 0), 0);
                const dSales = dayS.reduce((sum, s) => sum + (s.amount || (s.kilos || 0) * (s.pricePerKilo || 0)), 0);
                const dExp = dayE.reduce((sum, e) => sum + e.amount, 0);
                const dProfit = dSales - dPurchase - dExp;
                return `<tr>
                    <td>${escapeHtml(date)}</td>
                    <td>${dKilos.toFixed(2)} kg</td>
                    <td>${formatCurrency(dPurchase)}</td>
                    <td>${formatCurrency(dSales)}</td>
                    <td>${formatCurrency(dExp)}</td>
                    <td class="${dProfit >= 0 ? 'profit-positive' : 'profit-negative'}">${formatCurrency(dProfit)}</td>
                </tr>`;
            }).join('');

            const expRows = Object.entries(expByCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) =>
                `<tr><td>${escapeHtml(cat)}</td><td>${formatCurrency(amt)}</td></tr>`
            ).join('');

            const profitClass = netProfit >= 0 ? 'profit-positive' : 'profit-negative';
            const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

            reportContent.innerHTML = `
                <div class="report-header">
                    <img src="nakamal-logo.png" alt="Nakamal" class="report-logo">
                    <h2>Nakamal</h2>
                    <h3>Kava Sales Book</h3>
                    <p class="report-period">Monthly Report &mdash; ${escapeHtml(monthName)}</p>
                    <p class="report-date">Generated: ${today}</p>
                </div>
                <div class="report-summary-cards">
                    <div class="report-card"><span class="report-card-label">Total Sales</span><span class="report-card-value">${formatCurrency(totalSalesAmt)}</span></div>
                    <div class="report-card"><span class="report-card-label">Total Kilos</span><span class="report-card-value">${totalKilos.toFixed(2)} kg</span></div>
                    <div class="report-card"><span class="report-card-label">Purchase Cost</span><span class="report-card-value">${formatCurrency(totalPurchaseCost)}</span></div>
                    <div class="report-card"><span class="report-card-label">Expenses</span><span class="report-card-value">${formatCurrency(totalExpensesAmt)}</span></div>
                    <div class="report-card"><span class="report-card-label">Net Profit</span><span class="report-card-value ${profitClass}">${formatCurrency(netProfit)}</span></div>
                </div>
                <h4>Expenses by Category</h4>
                <table class="report-table"><thead><tr><th>Category</th><th>Amount</th></tr></thead>
                <tbody>${expRows || '<tr><td colspan="2" class="text-center text-muted fst-italic">No expenses</td></tr>'}</tbody></table>
                <h4>Daily Breakdown</h4>
                <table class="report-table"><thead><tr><th>Date</th><th>Kilos</th><th>Purchase</th><th>Sales</th><th>Expenses</th><th>Profit</th></tr></thead>
                <tbody>${dailyRows || '<tr><td colspan="6" class="text-center text-muted fst-italic">No records</td></tr>'}</tbody></table>
                <div class="report-footer">
                    <p>Prepared for Committee Meeting</p>
                    <p><em>Nakamal &mdash; Together Yumi Build</em></p>
                    <div class="signature-lines">
                        <div class="sig-line"><span>Prepared by</span></div>
                        <div class="sig-line"><span>Approved by</span></div>
                    </div>
                </div>`;

            reportOutput.style.display = 'block';
            btnPrint.style.display = '';
            showToast('Report generated!');
        });

        btnPrint.addEventListener('click', () => {
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Committee Report - Nakamal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Segoe UI',sans-serif;color:#222;padding:30px;line-height:1.6}
.report-header{text-align:center;margin-bottom:24px;border-bottom:3px solid #d4a017;padding-bottom:16px}
.report-logo{width:80px;height:80px;border-radius:50%;margin-bottom:8px}
.report-header h2{font-size:1.5rem;color:#333}
.report-header h3{font-size:1.1rem;color:#666;font-weight:400}
.report-period{font-size:1rem;font-weight:700;margin-top:8px;color:#444}
.report-date{font-size:.85rem;color:#888;margin-top:4px}
.report-summary-cards{display:flex;gap:12px;margin:20px 0}
.report-card{flex:1;border:2px solid #d4a017;border-radius:8px;padding:12px;text-align:center}
.report-card-label{display:block;font-size:.7rem;text-transform:uppercase;color:#888;margin-bottom:4px;font-weight:600}
.report-card-value{display:block;font-size:1.2rem;font-weight:700;color:#333}
.profit-positive{color:#27ae60!important}
.profit-negative{color:#e74c3c!important}
h4{margin:20px 0 8px;font-size:1rem;color:#333;border-bottom:1px solid #ddd;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:.85rem}
th{background:#f5f5f5;padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;font-weight:700;color:#555;text-transform:uppercase;font-size:.75rem}
td{padding:7px 10px;border-bottom:1px solid #eee}
.report-footer{margin-top:30px;text-align:center;border-top:2px solid #d4a017;padding-top:16px;color:#666}
.report-footer em{color:#999}
.signature-lines{display:flex;gap:60px;justify-content:center;margin-top:40px}
.sig-line{text-align:center}
.sig-line span{display:block;border-top:1px solid #999;padding-top:6px;min-width:160px;font-size:.8rem;color:#888;margin-top:50px}
@media print{body{padding:15px}}
</style></head><body>${$('#reportContent').innerHTML}</body></html>`);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
        });
    }

    function initDebtForm() {
        const debtDate = $('#debtDate');
        const debtForm = $('#debtForm');
        const debtMemberInput = $('#debtMember');
        debtDate.value = todayISO();

        debtForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const member = debtMemberInput.value.trim();
            const amount = parseFloat($('#debtAmount').value);
            const notes = $('#debtNotes').value.trim();
            if (!member) { showToast('Enter a member name', true); return; }
            if (!amount || amount <= 0) { showToast('Enter a valid amount', true); return; }

            await api('/debts', {
                method: 'POST', body: {
                    date: debtDate.value, member, amount, notes
                }
            });
            debtForm.reset();
            debtDate.value = todayISO();
            showToast('Debt recorded for ' + member);
            await refreshAll();
        });
    }

    // ---- Render Debts ----
    function renderDebtsTable() {
        const sorted = [...debts].sort((a, b) => {
            if (a.paid !== b.paid) return a.paid ? 1 : -1;
            return b.date.localeCompare(a.date);
        });
        const tbody = $('#debtsTableBody');
        const noMsg = $('#noDebtsMsg');
        noMsg.style.display = sorted.length ? 'none' : 'block';
        tbody.innerHTML = '';

        const totalOwed = debts.reduce((sum, d) => sum + d.amount, 0);
        const totalPaid = debts.filter(d => d.paid).reduce((sum, d) => sum + d.amount, 0);
        $('#totalDebtOwed').textContent = formatCurrency(totalOwed);
        $('#totalDebtPaid').textContent = formatCurrency(totalPaid);
        $('#totalDebtOutstanding').textContent = formatCurrency(totalOwed - totalPaid);

        sorted.forEach(d => {
            const tr = document.createElement('tr');
            if (d.paid) tr.classList.add('opacity-50');
            const statusBadge = d.paid
                ? `<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Paid${d.paidDate ? ' (' + d.paidDate + ')' : ''}</span>`
                : `<span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i>Unpaid</span>`;

            let actionBtns = '';
            if (!d.paid) {
                actionBtns = `<button class="btn btn-sm btn-outline-success btn-mark-paid me-1" title="Mark as Paid"><i class="bi bi-check2-circle"></i></button>`;
            }
            actionBtns += `<button class="btn-icon-delete" title="Delete"><i class="bi bi-trash"></i></button>`;

            tr.innerHTML = `
                <td>${escapeHtml(d.date)}</td>
                <td><strong>${escapeHtml(d.member)}</strong></td>
                <td class="${d.paid ? 'text-muted' : 'text-warning'} fw-bold">${formatCurrency(d.amount)}</td>
                <td class="text-muted">${escapeHtml(d.notes || '—')}</td>
                <td>${statusBadge}</td>
                <td class="text-center text-nowrap">${actionBtns}</td>
            `;

            const markBtn = tr.querySelector('.btn-mark-paid');
            if (markBtn) {
                markBtn.addEventListener('click', async () => {
                    await api('/debts/' + d.id + '/pay', { method: 'PUT', body: { paidDate: todayISO() } });
                    showToast(d.member + '\'s debt marked as paid!');
                    await refreshAll();
                });
            }
            tr.querySelector('.btn-icon-delete').addEventListener('click', () => requestDelete('debt', d.id));
            tbody.appendChild(tr);
        });
    }

    // ---- Refresh Everything ----
    async function refreshAll() {
        await loadAllData();
        updateDashboard();
        renderSalesTable();
        renderExpensesTable();
        renderDailySummary();
        renderDebtsTable();
        renderTrend();
        renderWeekdayChart();
        if (currentRole) {
            const isAdmin = currentRole === 'admin';
            $$('.btn-icon-delete').forEach(btn => {
                btn.style.display = isAdmin ? '' : 'none';
            });
        }
    }

    // ---- Landing Page & Auth ----
    async function getAdminPin() {
        const r = await api('/settings/adminPin');
        return r.value || DEFAULT_PIN;
    }

    async function getTimeoutMinutes() {
        const r = await api('/settings/timeout');
        return r.value !== null ? parseInt(r.value) : 15;
    }

    function isLockedOut() {
        const saved = localStorage.getItem('kava_lockout');
        if (saved) {
            const data = JSON.parse(saved);
            failedAttempts = data.attempts || 0;
            lockoutUntil = data.until || 0;
        }
        return Date.now() < lockoutUntil;
    }

    function recordFailedAttempt() {
        failedAttempts++;
        if (failedAttempts >= MAX_PIN_ATTEMPTS) {
            lockoutUntil = Date.now() + LOCKOUT_SECONDS * 1000;
        }
        localStorage.setItem('kava_lockout', JSON.stringify({ attempts: failedAttempts, until: lockoutUntil }));
    }

    function clearLockout() {
        failedAttempts = 0;
        lockoutUntil = 0;
        localStorage.removeItem('kava_lockout');
    }

    // ---- Session Timeout ----
    async function resetSessionTimer() {
        const minutes = await getTimeoutMinutes();
        if (!minutes || !currentRole) return;
        sessionEndTime = Date.now() + minutes * 60 * 1000;
    }

    function startSessionMonitor() {
        resetSessionTimer();
        if (sessionTimer) clearInterval(sessionTimer);
        sessionTimer = setInterval(async () => {
            const minutes = await getTimeoutMinutes();
            const countdown = $('#sessionCountdown');
            if (!minutes || !currentRole) {
                if (countdown) countdown.textContent = 'Off';
                return;
            }
            const remaining = Math.max(0, sessionEndTime - Date.now());
            if (countdown) {
                const m = Math.floor(remaining / 60000);
                const s = Math.floor((remaining % 60000) / 1000);
                countdown.textContent = m + ':' + String(s).padStart(2, '0');
            }
            if (remaining <= 0) {
                clearInterval(sessionTimer);
                sessionTimer = null;
                showToast('Session expired. Logging out...', true);
                setTimeout(() => $('#logoutBtn').click(), 1200);
            }
        }, 1000);

        // Reset timer on user activity
        ['click', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
            document.addEventListener(evt, resetSessionTimer, { passive: true });
        });
    }

    function stopSessionMonitor() {
        if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; }
    }

    function initLanding() {
        const landing = $('#landingPage');
        const mainApp = $('#mainApp');
        const loginAdmin = $('#loginAdmin');
        const adminPinBox = $('#adminPinBox');
        const adminPinInput = $('#adminPin');
        const pinSubmit = $('#pinSubmit');
        const pinCancel = $('#pinCancel');
        const pinError = $('#pinError');
        const pinLockout = $('#pinLockout');
        const lockoutTimerEl = $('#lockoutTimer');
        let lockoutInterval = null;

        function showLockoutTimer() {
            pinError.style.display = 'none';
            pinLockout.style.display = 'block';
            pinSubmit.disabled = true;
            adminPinInput.disabled = true;
            if (lockoutInterval) clearInterval(lockoutInterval);
            lockoutInterval = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
                lockoutTimerEl.textContent = remaining;
                if (remaining <= 0) {
                    clearInterval(lockoutInterval);
                    lockoutInterval = null;
                    clearLockout();
                    pinLockout.style.display = 'none';
                    pinSubmit.disabled = false;
                    adminPinInput.disabled = false;
                    adminPinInput.focus();
                }
            }, 500);
        }

        async function enterApp(role) {
            currentRole = role;
            landing.classList.add('d-none');
            mainApp.classList.remove('d-none');
            applyRole();
            await refreshAll();
            if (role === 'admin') startSessionMonitor();
        }

        loginAdmin.addEventListener('click', () => {
            adminPinBox.style.display = 'block';
            loginAdmin.style.display = 'none';
            adminPinInput.value = '';
            pinError.style.display = 'none';
            pinLockout.style.display = 'none';
            // Check existing lockout
            if (isLockedOut()) {
                showLockoutTimer();
            } else {
                adminPinInput.focus();
            }
        });

        pinSubmit.addEventListener('click', async () => {
            if (isLockedOut()) { showLockoutTimer(); return; }
            const pinCheck = await api('/auth/verify', { method: 'POST', body: { pin: adminPinInput.value } });
            if (pinCheck.valid) {
                clearLockout();
                enterApp('admin');
            } else {
                recordFailedAttempt();
                if (isLockedOut()) {
                    showLockoutTimer();
                } else {
                    pinError.style.display = 'block';
                    pinError.innerHTML = '<i class="bi bi-exclamation-triangle me-1"></i>Incorrect PIN (' + (MAX_PIN_ATTEMPTS - failedAttempts) + ' attempts left)';
                }
                adminPinInput.value = '';
                adminPinInput.focus();
            }
        });

        adminPinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') pinSubmit.click();
        });

        pinCancel.addEventListener('click', () => {
            adminPinBox.style.display = 'none';
            loginAdmin.style.display = '';
            pinError.style.display = 'none';
        });

        $('#logoutBtn').addEventListener('click', () => {
            currentRole = null;
            stopSessionMonitor();
            mainApp.classList.add('d-none');
            landing.classList.remove('d-none');
            adminPinBox.style.display = 'none';
            loginAdmin.style.display = '';
            history.replaceState(null, '', location.pathname);
        });
    }

    // ---- Trends Chart ----
    let trendChartInstance = null;

    function renderTrend() {
        const canvas = $('#trendChart');
        if (!canvas) return;

        const periodSel = $('#trendPeriod');
        const period = periodSel ? periodSel.value : '30';

        // Build a map of date -> { sales, purchaseCost, expenses }
        const dateMap = {};
        sales.forEach(s => {
            if (!dateMap[s.date]) dateMap[s.date] = { sales: 0, purchaseCost: 0, expenses: 0 };
            dateMap[s.date].sales += s.amount || 0;
            dateMap[s.date].purchaseCost += (s.kilos || 0) * (s.costPerKilo || 0);
        });
        expenses.forEach(e => {
            if (!dateMap[e.date]) dateMap[e.date] = { sales: 0, purchaseCost: 0, expenses: 0 };
            dateMap[e.date].expenses += e.amount || 0;
        });

        let dates = Object.keys(dateMap).sort();
        if (period !== 'all') {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - parseInt(period));
            const cutoffStr = cutoff.toISOString().split('T')[0];
            dates = dates.filter(d => d >= cutoffStr);
        }

        const salesData = dates.map(d => dateMap[d].sales);
        const profitData = dates.map(d => dateMap[d].sales - dateMap[d].purchaseCost - dateMap[d].expenses);
        const expensesData = dates.map(d => dateMap[d].expenses + dateMap[d].purchaseCost);

        // Stats
        const avgSales = salesData.length ? salesData.reduce((a, b) => a + b, 0) / salesData.length : 0;
        const maxProfit = profitData.length ? Math.max(...profitData) : 0;
        const bestIdx = profitData.indexOf(maxProfit);
        $('#trendAvgSales').textContent = formatCurrency(Math.round(avgSales));
        $('#trendBestDay').textContent = bestIdx >= 0 ? dates[bestIdx] : '—';
        $('#trendBestProfit').textContent = formatCurrency(maxProfit);

        // Chart
        if (trendChartInstance) trendChartInstance.destroy();
        trendChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: 'Sales',
                        data: salesData,
                        borderColor: '#d4a017',
                        backgroundColor: 'rgba(212,160,23,0.1)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 3,
                    },
                    {
                        label: 'Profit',
                        data: profitData,
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40,167,69,0.08)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 3,
                    },
                    {
                        label: 'Costs & Expenses',
                        data: expensesData,
                        borderColor: '#dc3545',
                        backgroundColor: 'rgba(220,53,69,0.07)',
                        tension: 0.3,
                        fill: false,
                        pointRadius: 3,
                    },
                ],
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#ccc' } },
                    tooltip: {
                        callbacks: {
                            label: ctx => ' ' + ctx.dataset.label + ': ' + Number(ctx.raw).toLocaleString() + ' VT',
                        },
                    },
                },
                scales: {
                    x: { ticks: { color: '#aaa', maxTicksLimit: 10 }, grid: { color: '#333' } },
                    y: { ticks: { color: '#aaa', callback: v => Number(v).toLocaleString() + ' VT' }, grid: { color: '#333' } },
                },
            },
        });
        renderWeekdayChart();
    }

    let weekdayChartInstance = null;

    function renderWeekdayChart() {
        const canvas = $('#weekdayChart');
        if (!canvas) return;

        const DAYS_ORDERED = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        // dow order: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=0
        const DOW_INDEX = [1, 2, 3, 4, 5, 6, 0];

        // buckets[0..6] -> index matches DOW_INDEX order (Mon first)
        const buckets = Array.from({ length: 7 }, () => ({ sales: 0, purchaseCost: 0, expenses: 0 }));

        sales.forEach(s => {
            const d = new Date(s.date + 'T00:00:00');
            const dow = d.getDay(); // 0=Sun .. 6=Sat
            const idx = DOW_INDEX.indexOf(dow);
            if (idx === -1) return;
            buckets[idx].sales += s.amount || 0;
            buckets[idx].purchaseCost += (s.kilos || 0) * (s.costPerKilo || 0);
        });

        expenses.forEach(e => {
            const d = new Date(e.date + 'T00:00:00');
            const dow = d.getDay();
            const idx = DOW_INDEX.indexOf(dow);
            if (idx === -1) return;
            buckets[idx].expenses += e.amount || 0;
        });

        const salesData = buckets.map(b => b.sales);
        const profitData = buckets.map(b => b.sales - b.purchaseCost - b.expenses);
        const costsData = buckets.map(b => b.expenses + b.purchaseCost);

        // Best weekday stats
        const maxSales = salesData.length ? Math.max(...salesData) : 0;
        const bestIdx = salesData.indexOf(maxSales);
        const bestProfit = profitData[bestIdx] || 0;
        $('#weekdayBestLabel').textContent = bestIdx >= 0 ? DAYS_ORDERED[bestIdx] : '—';
        $('#weekdayBestSales').textContent = formatCurrency(maxSales);
        $('#weekdayBestProfit').textContent = formatCurrency(bestProfit);

        if (weekdayChartInstance) weekdayChartInstance.destroy();
        weekdayChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: DAYS_ORDERED,
                datasets: [
                    {
                        label: 'Sales',
                        data: salesData,
                        backgroundColor: 'rgba(212,160,23,0.80)',
                        borderColor: '#d4a017',
                        borderWidth: 1,
                        borderRadius: 5,
                    },
                    {
                        label: 'Profit',
                        data: profitData,
                        backgroundColor: 'rgba(40,167,69,0.75)',
                        borderColor: '#28a745',
                        borderWidth: 1,
                        borderRadius: 5,
                    },
                    {
                        label: 'Costs & Expenses',
                        data: costsData,
                        backgroundColor: 'rgba(220,53,69,0.65)',
                        borderColor: '#dc3545',
                        borderWidth: 1,
                        borderRadius: 5,
                    },
                ],
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#ccc' } },
                    tooltip: {
                        callbacks: {
                            label: ctx => ' ' + ctx.dataset.label + ': ' + Number(ctx.raw).toLocaleString() + ' VT',
                        },
                    },
                },
                scales: {
                    x: { ticks: { color: '#aaa' }, grid: { color: '#333' } },
                    y: {
                        ticks: { color: '#aaa', callback: v => Number(v).toLocaleString() + ' VT' },
                        grid: { color: '#333' },
                    },
                },
            },
        });
    }

    function initTrend() {
        const sel = $('#trendPeriod');
        if (sel) sel.addEventListener('change', renderTrend);
    }

    // ---- Hash-Based Routing ----
    const TAB_ROUTES = {
        'record-sale': { btn: '#tab-btn-sales', admin: true },
        'record-expense': { btn: '#tab-btn-expenses', admin: true },
        'sales': { btn: '#tab-btn-history', admin: false },
        'expenses': { btn: '#tab-btn-expense-history', admin: false },
        'summary': { btn: '#tab-btn-daily-summary', admin: false },
        'debts': { btn: '#tab-btn-debts', admin: false },
        'trend': { btn: '#tab-btn-trend', admin: false },
        'report': { btn: '#tab-btn-report', admin: false },
        'security': { btn: '#tab-btn-security', admin: true },
    };

    function getRouteFromBtn(btnId) {
        for (const [route, cfg] of Object.entries(TAB_ROUTES)) {
            if (cfg.btn === '#' + btnId) return route;
        }
        return null;
    }

    function navigateToHash(hash) {
        const route = (hash || '').replace('#', '');
        const cfg = TAB_ROUTES[route];
        if (!cfg) return false;
        if (cfg.admin && currentRole !== 'admin') return false;
        const btn = $(cfg.btn);
        if (!btn) return false;
        const bsTab = new bootstrap.Tab(btn);
        bsTab.show();
        return true;
    }

    function syncHashFromTab() {
        // Listen to Bootstrap tab show events and update hash
        const tabContainer = $('#mainTabs');
        if (!tabContainer) return;
        tabContainer.addEventListener('shown.bs.tab', (e) => {
            const btnId = e.target.id;
            const route = getRouteFromBtn(btnId);
            if (route && location.hash !== '#' + route) {
                history.pushState(null, '', '#' + route);
            }
        });
    }

    function initRouter() {
        syncHashFromTab();
        window.addEventListener('popstate', () => {
            if (currentRole) navigateToHash(location.hash);
        });
    }

    // ---- Role-Based Visibility ----
    function applyRole() {
        const isAdmin = currentRole === 'admin';
        const roleLabel = $('#roleLabel');
        roleLabel.textContent = isAdmin ? 'Admin' : 'View Only';
        roleLabel.className = 'badge ' + (isAdmin ? 'bg-gold' : 'bg-secondary-subtle');

        // Show/hide admin-only tab nav items
        $$('.nav-item[data-role="admin"]').forEach(item => {
            item.style.display = isAdmin ? '' : 'none';
        });

        // Show/hide delete buttons and mark-as-paid buttons
        $$('.btn-icon-delete').forEach(btn => {
            btn.style.display = isAdmin ? '' : 'none';
        });
        $$('.btn-mark-paid').forEach(btn => {
            btn.style.display = isAdmin ? '' : 'none';
        });

        // Activate the correct first tab (or from hash)
        const tabList = $('#mainTabs');
        const hashNavigated = location.hash && navigateToHash(location.hash);
        if (!hashNavigated) {
            if (!isAdmin) {
                const firstVisibleLink = tabList.querySelector('.nav-item:not([data-role="admin"]) .nav-link');
                if (firstVisibleLink) {
                    const bsTab = new bootstrap.Tab(firstVisibleLink);
                    bsTab.show();
                }
            } else {
                const adminFirstLink = tabList.querySelector('#tab-btn-sales');
                if (adminFirstLink) {
                    const bsTab = new bootstrap.Tab(adminFirstLink);
                    bsTab.show();
                }
            }
        }
    }

    // ---- Init ----
    function initChangePinForm() {
        const form = $('#changePinForm');
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const current = $('#currentPin').value;
            const newPin = $('#newPin').value;
            const confirm = $('#confirmNewPin').value;

            const pinCheck = await api('/auth/verify', { method: 'POST', body: { pin: current } });
            if (!pinCheck.valid) {
                showToast('Current PIN is incorrect', true); return;
            }
            if (newPin.length < 4) {
                showToast('New PIN must be at least 4 digits', true); return;
            }
            if (!/^\d+$/.test(newPin)) {
                showToast('PIN must contain only numbers', true); return;
            }
            if (newPin !== confirm) {
                showToast('New PINs do not match', true); return;
            }
            if (newPin === current) {
                showToast('New PIN must be different from current', true); return;
            }

            await api('/auth/pin', { method: 'PUT', body: { currentPin: current, newPin } });
            form.reset();
            showToast('Admin PIN updated successfully!');
        });
    }

    function initTimeoutSettings() {
        const sel = $('#timeoutSelect');
        const btn = $('#btnSaveTimeout');
        if (!sel || !btn) return;
        getTimeoutMinutes().then(v => { sel.value = String(v); });
        btn.addEventListener('click', async () => {
            await api('/settings/timeout', { method: 'PUT', body: { value: sel.value } });
            await resetSessionTimer();
            showToast('Timeout set to ' + (sel.value === '0' ? 'Never' : sel.value + ' minutes'));
        });
    }

    async function init() {
        bsToast = new bootstrap.Toast($('#toast'), { delay: 2500 });
        try { await loadAllData(); } catch (e) { console.error('Failed to load data:', e); }
        initLanding();
        initDeleteModal();
        initSaleForm();
        initExpenseForm();
        initFilter();
        initDebtForm();
        initReport();
        initTrend();
        initChangePinForm();
        initTimeoutSettings();
        initRouter();
        refreshAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
