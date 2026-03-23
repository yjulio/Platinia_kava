// ===== Kava Sales Book - Application Logic =====

(function () {
    'use strict';

    // ---- Data Layer ----
    const STORAGE_KEYS = { sales: 'kava_sales', expenses: 'kava_expenses', debts: 'kava_debts', members: 'kava_members', adminPin: 'kava_admin_pin', timeout: 'kava_timeout_minutes', lockout: 'kava_lockout' };
    const DEFAULT_PIN = '1234';
    const MAX_PIN_ATTEMPTS = 5;
    const LOCKOUT_SECONDS = 60;

    function loadData(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; }
        catch { return []; }
    }
    function saveData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    let sales = loadData(STORAGE_KEYS.sales);
    let expenses = loadData(STORAGE_KEYS.expenses);
    let debts = loadData(STORAGE_KEYS.debts);
    let members = loadData(STORAGE_KEYS.members);
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

        saleForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const kilos = parseFloat(saleKilos.value);
            const costPerKilo = parseFloat(saleCostPerKilo.value);
            const amount = parseFloat(saleAmount.value);
            if (!kilos || kilos <= 0) { showToast('Please enter valid kilos', true); return; }
            if (!costPerKilo || costPerKilo <= 0) { showToast('Please enter cost per kilo', true); return; }
            if (!amount || amount <= 0) { showToast('Please enter a valid amount earned', true); return; }

            sales.push({
                id: generateId(),
                date: saleDate.value,
                kilos,
                costPerKilo,
                amount,
                notes: saleNotes.value.trim(),
            });
            saveData(STORAGE_KEYS.sales, sales);
            saleForm.reset();
            saleDate.value = todayISO();
            salePurchaseCost.textContent = '0 VT';
            saleNightProfit.textContent = '0 VT';
            saleNightProfit.className = 'fs-5 fw-bold text-success';
            showToast('Nightly sales recorded!');
            refreshAll();
        });
    }

    // ---- Expense Form ----
    function initExpenseForm() {
        const expenseDate = $('#expenseDate');
        const expenseForm = $('#expenseForm');
        expenseDate.value = todayISO();

        expenseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const amount = parseFloat($('#expenseAmount').value);
            const description = $('#expenseDescription').value.trim();
            if (!description) { showToast('Please enter a description', true); return; }
            if (!amount || amount < 0) { showToast('Please enter a valid amount', true); return; }

            expenses.push({
                id: generateId(),
                date: expenseDate.value,
                category: $('#expenseCategory').value,
                description,
                amount,
                notes: $('#expenseNotes').value.trim(),
            });
            saveData(STORAGE_KEYS.expenses, expenses);
            expenseForm.reset();
            expenseDate.value = todayISO();
            showToast('Expense recorded!');
            refreshAll();
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

        $('#confirmDelete').addEventListener('click', () => {
            // Verify PIN before deleting
            if (deletePinInput.value !== getAdminPin()) {
                deletePinError.style.display = 'block';
                deletePinInput.value = '';
                deletePinInput.focus();
                return;
            }

            if (pendingDeleteType === 'sale') {
                sales = sales.filter(s => s.id !== pendingDeleteId);
                saveData(STORAGE_KEYS.sales, sales);
                showToast('Sale deleted');
            } else if (pendingDeleteType === 'expense') {
                expenses = expenses.filter(e => e.id !== pendingDeleteId);
                saveData(STORAGE_KEYS.expenses, expenses);
                showToast('Expense deleted');
            } else if (pendingDeleteType === 'debt') {
                debts = debts.filter(d => d.id !== pendingDeleteId);
                saveData(STORAGE_KEYS.debts, debts);
                showToast('Debt deleted');
            } else if (pendingDeleteType === 'member') {
                members = members.filter(m => m.id !== pendingDeleteId);
                saveData(STORAGE_KEYS.members, members);
                showToast('Member removed');
            }
            deleteModal.hide();
            pendingDeleteType = null;
            pendingDeleteId = null;
            refreshAll();
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
                    <img src="logo.png" alt="Logo" class="report-logo">
                    <h2>Indigenous Trade Limited</h2>
                    <h3>Manples Kava Coop</h3>
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
                    <p><em>Indigenous Trade Limited &mdash; Together Yumi Build</em></p>
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
<html><head><title>Committee Report - Indigenous Trade Limited</title>
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

    // ---- Debt Form ----
    function initDebtForm() {
        const debtDate = $('#debtDate');
        const debtForm = $('#debtForm');
        const debtMemberSel = $('#debtMember');
        const debtMemberOther = $('#debtMemberOther');
        debtDate.value = todayISO();

        // Toggle "Other" text input when selected
        debtMemberSel.addEventListener('change', () => {
            if (debtMemberSel.value === '__other__') {
                debtMemberOther.classList.remove('d-none');
                debtMemberOther.required = true;
                debtMemberOther.focus();
            } else {
                debtMemberOther.classList.add('d-none');
                debtMemberOther.required = false;
                debtMemberOther.value = '';
            }
        });

        debtForm.addEventListener('submit', (e) => {
            e.preventDefault();
            let member = debtMemberSel.value === '__other__' ? debtMemberOther.value.trim() : debtMemberSel.value;
            const amount = parseFloat($('#debtAmount').value);
            const notes = $('#debtNotes').value.trim();
            if (!member) { showToast('Select or enter a member name', true); return; }
            if (!amount || amount <= 0) { showToast('Enter a valid amount', true); return; }

            debts.push({
                id: generateId(),
                date: debtDate.value,
                member,
                amount,
                notes,
                paid: false,
                paidDate: null,
            });
            saveData(STORAGE_KEYS.debts, debts);
            debtForm.reset();
            debtDate.value = todayISO();
            debtMemberOther.classList.add('d-none');
            debtMemberOther.required = false;
            populateDebtMemberDropdown();
            showToast('Debt recorded for ' + member);
            refreshAll();
        });
    }

    // ---- Populate Debt Member Dropdown ----
    function populateDebtMemberDropdown() {
        const sel = $('#debtMember');
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">-- Select Member --</option>';
        const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
        sorted.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.textContent = (m.memberId ? m.memberId + ' — ' : '') + m.name + (m.role && m.role !== 'Member' ? ' (' + m.role + ')' : '');
            sel.appendChild(opt);
        });
        const otherOpt = document.createElement('option');
        otherOpt.value = '__other__';
        otherOpt.textContent = '+ Other (type name)';
        sel.appendChild(otherOpt);
        if (currentVal) sel.value = currentVal;
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
                markBtn.addEventListener('click', () => {
                    const debt = debts.find(x => x.id === d.id);
                    if (debt) {
                        debt.paid = true;
                        debt.paidDate = todayISO();
                        saveData(STORAGE_KEYS.debts, debts);
                        showToast(debt.member + '\'s debt marked as paid!');
                        refreshAll();
                    }
                });
            }
            tr.querySelector('.btn-icon-delete').addEventListener('click', () => requestDelete('debt', d.id));
            tbody.appendChild(tr);
        });
    }

    // ---- Member Form ----
    let editingMemberId = null;

    function initMemberForm() {
        const memberForm = $('#memberForm');
        const memberJoined = $('#memberJoined');
        const memberIdInput = $('#memberIdInput');
        const memberFeeStatus = $('#memberFeeStatus');
        const memberFeePaidWrap = $('#memberFeePaidAmountWrap');
        memberJoined.value = todayISO();

        // Show/hide partial paid amount field
        memberFeeStatus.addEventListener('change', () => {
            memberFeePaidWrap.style.display = memberFeeStatus.value === 'Partial' ? '' : 'none';
        });

        memberForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const memberId = memberIdInput.value.trim();
            const name = $('#memberName').value.trim();
            const phone = $('#memberPhone').value.trim();
            const role = $('#memberRole').value;
            const fee = parseFloat($('#memberFee').value) || 0;
            const feeStatus = memberFeeStatus.value;
            const feePaidAmount = feeStatus === 'Partial' ? (parseFloat($('#memberFeePaidAmount').value) || 0) : (feeStatus === 'Paid' ? fee : 0);
            const notes = $('#memberNotes').value.trim();
            if (!memberId) { showToast('Enter a member ID', true); return; }
            if (!name) { showToast('Enter member name', true); return; }

            // Check for duplicate ID (only when adding or changing ID)
            if (!editingMemberId || members.find(m => m.id === editingMemberId)?.memberId !== memberId) {
                if (members.some(m => m.memberId === memberId && m.id !== editingMemberId)) {
                    showToast('Member ID "' + memberId + '" already exists!', true);
                    return;
                }
            }

            if (editingMemberId) {
                const member = members.find(m => m.id === editingMemberId);
                if (member) {
                    member.memberId = memberId;
                    member.name = name;
                    member.phone = phone;
                    member.role = role;
                    member.joined = memberJoined.value;
                    member.fee = fee;
                    member.feeStatus = feeStatus;
                    member.feePaidAmount = feePaidAmount;
                    member.notes = notes;
                }
                editingMemberId = null;
                memberIdInput.readOnly = false;
                $('#memberSubmitBtn').innerHTML = '<i class="bi bi-check-lg me-1"></i>Add Member';
                showToast('Member updated');
            } else {
                members.push({
                    id: generateId(),
                    memberId,
                    name,
                    phone,
                    role,
                    joined: memberJoined.value,
                    fee,
                    feeStatus,
                    feePaidAmount,
                    notes,
                });
                showToast('Member added: ' + name);
            }
            saveData(STORAGE_KEYS.members, members);
            memberForm.reset();
            memberJoined.value = todayISO();
            memberFeePaidWrap.style.display = 'none';
            refreshAll();
        });

        // Search
        $('#memberSearch').addEventListener('input', () => renderMembersTable());
    }

    function editMember(id) {
        const m = members.find(x => x.id === id);
        if (!m) return;
        editingMemberId = id;
        $('#memberIdInput').value = m.memberId || '';
        $('#memberName').value = m.name;
        $('#memberPhone').value = m.phone || '';
        $('#memberRole').value = m.role || 'Member';
        $('#memberJoined').value = m.joined || '';
        $('#memberFee').value = m.fee || '';
        $('#memberFeeStatus').value = m.feeStatus || 'Unpaid';
        $('#memberFeePaidAmountWrap').style.display = (m.feeStatus === 'Partial') ? '' : 'none';
        $('#memberFeePaidAmount').value = m.feePaidAmount || '';
        $('#memberNotes').value = m.notes || '';
        $('#memberSubmitBtn').innerHTML = '<i class="bi bi-pencil me-1"></i>Update Member';
        // Scroll to form
        $('#tab-members').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ---- Render Members Table ----
    function renderMembersTable() {
        const searchVal = ($('#memberSearch')?.value || '').toLowerCase();
        const filtered = members
            .filter(m => !searchVal || m.name.toLowerCase().includes(searchVal) || (m.role || '').toLowerCase().includes(searchVal) || (m.phone || '').includes(searchVal) || (m.memberId || '').toLowerCase().includes(searchVal))
            .sort((a, b) => a.name.localeCompare(b.name));

        const tbody = $('#membersTableBody');
        const noMsg = $('#noMembersMsg');
        if (!tbody) return;
        noMsg.style.display = filtered.length ? 'none' : 'block';
        tbody.innerHTML = '';
        $('#memberCount').textContent = members.length;

        // Fee summary
        const totalFees = members.reduce((sum, m) => sum + (m.fee || 0), 0);
        const collected = members.reduce((sum, m) => {
            if (m.feeStatus === 'Paid') return sum + (m.fee || 0);
            if (m.feeStatus === 'Partial') return sum + (m.feePaidAmount || 0);
            return sum;
        }, 0);
        $('#feesCollected').textContent = formatCurrency(collected);
        $('#feesOutstanding').textContent = formatCurrency(totalFees - collected);

        const roleBadgeColors = {
            'Chairman': 'bg-gold text-dark',
            'Treasurer': 'bg-info text-dark',
            'Secretary': 'bg-primary',
            'Committee': 'bg-warning text-dark',
            'Staff': 'bg-secondary',
            'Member': 'bg-secondary bg-opacity-50',
        };

        filtered.forEach(m => {
            const tr = document.createElement('tr');
            const badgeClass = roleBadgeColors[m.role] || 'bg-secondary bg-opacity-50';

            const feeStatusBadge = {
                'Paid': '<span class="badge bg-success">Paid</span>',
                'Partial': '<span class="badge bg-info text-dark">Partial (' + formatCurrency(m.feePaidAmount || 0) + ')</span>',
                'Exempt': '<span class="badge bg-secondary">Exempt</span>',
                'Unpaid': '<span class="badge bg-warning text-dark">Unpaid</span>',
            };

            tr.innerHTML = `
                <td><span class="badge bg-dark border border-gold-subtle text-gold fw-bold">${escapeHtml(m.memberId || '—')}</span></td>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td class="text-muted">${escapeHtml(m.phone || '—')}</td>
                <td><span class="badge ${badgeClass}">${escapeHtml(m.role || 'Member')}</span></td>
                <td class="text-muted">${escapeHtml(m.joined || '—')}</td>
                <td class="fw-bold">${m.fee ? formatCurrency(m.fee) : '—'}</td>
                <td>${feeStatusBadge[m.feeStatus] || feeStatusBadge['Unpaid']}</td>
                <td class="text-muted">${escapeHtml(m.notes || '—')}</td>
                <td class="text-center text-nowrap">
                    <button class="btn btn-sm btn-outline-gold btn-edit-member me-1" title="Edit"><i class="bi bi-pencil"></i></button>
                    <button class="btn-icon-delete" title="Delete"><i class="bi bi-trash"></i></button>
                </td>
            `;
            tr.querySelector('.btn-edit-member').addEventListener('click', () => editMember(m.id));
            tr.querySelector('.btn-icon-delete').addEventListener('click', () => requestDelete('member', m.id));
            tbody.appendChild(tr);
        });
    }

    // ---- Render Read-Only Members Directory ----
    function renderViewMembersTable() {
        const searchVal = ($('#viewMemberSearch')?.value || '').toLowerCase();
        const filtered = members
            .filter(m => !searchVal || m.name.toLowerCase().includes(searchVal) || (m.role || '').toLowerCase().includes(searchVal) || (m.phone || '').includes(searchVal) || (m.memberId || '').toLowerCase().includes(searchVal))
            .sort((a, b) => a.name.localeCompare(b.name));

        const tbody = $('#viewMembersTableBody');
        const noMsg = $('#noViewMembersMsg');
        if (!tbody) return;
        noMsg.style.display = filtered.length ? 'none' : 'block';
        tbody.innerHTML = '';
        $('#viewMemberCount').textContent = members.length;

        const totalFees = members.reduce((sum, m) => sum + (m.fee || 0), 0);
        const collected = members.reduce((sum, m) => {
            if (m.feeStatus === 'Paid') return sum + (m.fee || 0);
            if (m.feeStatus === 'Partial') return sum + (m.feePaidAmount || 0);
            return sum;
        }, 0);
        $('#viewFeesCollected').textContent = formatCurrency(collected);
        $('#viewFeesOutstanding').textContent = formatCurrency(totalFees - collected);

        const roleBadgeColors = {
            'Chairman': 'bg-gold text-dark',
            'Treasurer': 'bg-info text-dark',
            'Secretary': 'bg-primary',
            'Committee': 'bg-warning text-dark',
            'Staff': 'bg-secondary',
            'Member': 'bg-secondary bg-opacity-50',
        };

        const feeStatusBadges = {
            'Paid': '<span class="badge bg-success">Paid</span>',
            'Partial': '',
            'Exempt': '<span class="badge bg-secondary">Exempt</span>',
            'Unpaid': '<span class="badge bg-warning text-dark">Unpaid</span>',
        };

        filtered.forEach(m => {
            const tr = document.createElement('tr');
            const badgeClass = roleBadgeColors[m.role] || 'bg-secondary bg-opacity-50';
            const feeBadge = m.feeStatus === 'Partial'
                ? '<span class="badge bg-info text-dark">Partial (' + formatCurrency(m.feePaidAmount || 0) + ')</span>'
                : (feeStatusBadges[m.feeStatus] || feeStatusBadges['Unpaid']);
            tr.innerHTML = `
                <td><span class="badge bg-dark border border-gold-subtle text-gold fw-bold">${escapeHtml(m.memberId || '—')}</span></td>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td class="text-muted">${escapeHtml(m.phone || '—')}</td>
                <td><span class="badge ${badgeClass}">${escapeHtml(m.role || 'Member')}</span></td>
                <td class="text-muted">${escapeHtml(m.joined || '—')}</td>
                <td class="fw-bold">${m.fee ? formatCurrency(m.fee) : '—'}</td>
                <td>${feeBadge}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ---- Refresh Everything ----
    function refreshAll() {
        updateDashboard();
        renderSalesTable();
        renderExpensesTable();
        renderDailySummary();
        renderDebtsTable();
        renderMembersTable();
        renderViewMembersTable();
        populateDebtMemberDropdown();
        if (currentRole) {
            const isAdmin = currentRole === 'admin';
            $$('.btn-icon-delete').forEach(btn => {
                btn.style.display = isAdmin ? '' : 'none';
            });
        }
    }

    // ---- Landing Page & Auth ----
    function getAdminPin() {
        return localStorage.getItem(STORAGE_KEYS.adminPin) || DEFAULT_PIN;
    }

    function getTimeoutMinutes() {
        const val = localStorage.getItem(STORAGE_KEYS.timeout);
        return val !== null ? parseInt(val) : 15;
    }

    function isLockedOut() {
        const saved = localStorage.getItem(STORAGE_KEYS.lockout);
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
        localStorage.setItem(STORAGE_KEYS.lockout, JSON.stringify({ attempts: failedAttempts, until: lockoutUntil }));
    }

    function clearLockout() {
        failedAttempts = 0;
        lockoutUntil = 0;
        localStorage.removeItem(STORAGE_KEYS.lockout);
    }

    // ---- Session Timeout ----
    function resetSessionTimer() {
        const minutes = getTimeoutMinutes();
        if (!minutes || !currentRole) return;
        sessionEndTime = Date.now() + minutes * 60 * 1000;
    }

    function startSessionMonitor() {
        resetSessionTimer();
        if (sessionTimer) clearInterval(sessionTimer);
        sessionTimer = setInterval(() => {
            const minutes = getTimeoutMinutes();
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
        const loginUser = $('#loginUser');
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

        function enterApp(role) {
            currentRole = role;
            landing.classList.add('d-none');
            mainApp.classList.remove('d-none');
            applyRole();
            refreshAll();
            if (role === 'admin') startSessionMonitor();
        }

        loginAdmin.addEventListener('click', () => {
            adminPinBox.style.display = 'block';
            loginAdmin.style.display = 'none';
            loginUser.style.display = 'none';
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

        loginUser.addEventListener('click', () => enterApp('user'));

        pinSubmit.addEventListener('click', () => {
            if (isLockedOut()) { showLockoutTimer(); return; }
            if (adminPinInput.value === getAdminPin()) {
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
            loginUser.style.display = '';
            pinError.style.display = 'none';
        });

        $('#logoutBtn').addEventListener('click', () => {
            currentRole = null;
            stopSessionMonitor();
            mainApp.classList.add('d-none');
            landing.classList.remove('d-none');
            adminPinBox.style.display = 'none';
            loginAdmin.style.display = '';
            loginUser.style.display = '';
            history.replaceState(null, '', location.pathname);
        });
    }

    // ---- Hash-Based Routing ----
    const TAB_ROUTES = {
        'record-sale':     { btn: '#tab-btn-sales',           admin: true },
        'record-expense':  { btn: '#tab-btn-expenses',        admin: true },
        'sales':           { btn: '#tab-btn-history',          admin: false },
        'expenses':        { btn: '#tab-btn-expense-history',  admin: false },
        'summary':         { btn: '#tab-btn-daily-summary',    admin: false },
        'debts':           { btn: '#tab-btn-debts',            admin: false },
        'members':         { btn: '#tab-btn-view-members',     admin: false },
        'manage-members':  { btn: '#tab-btn-members',          admin: true },
        'report':          { btn: '#tab-btn-report',           admin: false },
        'security':        { btn: '#tab-btn-security',         admin: true },
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
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const current = $('#currentPin').value;
            const newPin = $('#newPin').value;
            const confirm = $('#confirmNewPin').value;

            if (current !== getAdminPin()) {
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

            localStorage.setItem(STORAGE_KEYS.adminPin, newPin);
            form.reset();
            showToast('Admin PIN updated successfully!');
        });
    }

    function initTimeoutSettings() {
        const sel = $('#timeoutSelect');
        const btn = $('#btnSaveTimeout');
        if (!sel || !btn) return;
        sel.value = String(getTimeoutMinutes());
        btn.addEventListener('click', () => {
            localStorage.setItem(STORAGE_KEYS.timeout, sel.value);
            resetSessionTimer();
            showToast('Timeout set to ' + (sel.value === '0' ? 'Never' : sel.value + ' minutes'));
        });
    }

    function init() {
        bsToast = new bootstrap.Toast($('#toast'), { delay: 2500 });
        initLanding();
        initDeleteModal();
        initSaleForm();
        initExpenseForm();
        initFilter();
        initDebtForm();
        initMemberForm();
        initReport();
        initChangePinForm();
        initTimeoutSettings();
        initRouter();
        // View Members search
        const viewSearch = $('#viewMemberSearch');
        if (viewSearch) viewSearch.addEventListener('input', () => renderViewMembersTable());
        refreshAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
