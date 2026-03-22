// ===== Kava Sales Book - Application Logic =====

(function () {
    'use strict';

    // ---- Data Layer ----
    const STORAGE_KEYS = { sales: 'kava_sales', expenses: 'kava_expenses', adminPin: 'kava_admin_pin' };
    const DEFAULT_PIN = '1234';

    function loadData(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; }
        catch { return []; }
    }
    function saveData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    let sales = loadData(STORAGE_KEYS.sales);
    let expenses = loadData(STORAGE_KEYS.expenses);
    let activeFilter = null;
    let currentRole = null;

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

        $('#confirmDelete').addEventListener('click', () => {
            if (pendingDeleteType === 'sale') {
                sales = sales.filter(s => s.id !== pendingDeleteId);
                saveData(STORAGE_KEYS.sales, sales);
                showToast('Sale deleted');
            } else if (pendingDeleteType === 'expense') {
                expenses = expenses.filter(e => e.id !== pendingDeleteId);
                saveData(STORAGE_KEYS.expenses, expenses);
                showToast('Expense deleted');
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

    // ---- Refresh Everything ----
    function refreshAll() {
        updateDashboard();
        renderSalesTable();
        renderExpensesTable();
        renderDailySummary();
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

        function enterApp(role) {
            currentRole = role;
            landing.classList.add('d-none');
            mainApp.classList.remove('d-none');
            applyRole();
            refreshAll();
        }

        loginAdmin.addEventListener('click', () => {
            adminPinBox.style.display = 'block';
            loginAdmin.style.display = 'none';
            loginUser.style.display = 'none';
            adminPinInput.value = '';
            pinError.style.display = 'none';
            adminPinInput.focus();
        });

        loginUser.addEventListener('click', () => enterApp('user'));

        pinSubmit.addEventListener('click', () => {
            if (adminPinInput.value === getAdminPin()) {
                enterApp('admin');
            } else {
                pinError.style.display = 'block';
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
            mainApp.classList.add('d-none');
            landing.classList.remove('d-none');
            adminPinBox.style.display = 'none';
            loginAdmin.style.display = '';
            loginUser.style.display = '';
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

        // Show/hide delete buttons
        $$('.btn-icon-delete').forEach(btn => {
            btn.style.display = isAdmin ? '' : 'none';
        });

        // Activate the correct first tab
        const tabList = $('#mainTabs');
        if (!isAdmin) {
            // Click the first visible tab (Sales History)
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

    // ---- Init ----
    function init() {
        bsToast = new bootstrap.Toast($('#toast'), { delay: 2500 });
        initLanding();
        initDeleteModal();
        initSaleForm();
        initExpenseForm();
        initFilter();
        initReport();
        refreshAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
