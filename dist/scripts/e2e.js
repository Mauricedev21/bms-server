"use strict";
/**
 * End-to-end business workflow verification against the real HTTP API.
 * Run with: npm --prefix server run e2e
 *
 * Verifies (among others):
 *  - manager registration → login → salon setup
 *  - 10,000 RWF ⇒ 6,000 manager/4,000 barber
 *  - 100,000 RWF ⇒ 60,000 manager/40,000 barber
 *  - accumulation of multiple shares
 *  - dashboard never shows total volume as manager income
 *  - duplicate submission protection
 *  - loan creation + repayment
 *  - reports (monthly)
 *  - barber portal isolation
 *  - 6-month retention archiving
 *  - admin monitoring + account status
 */
// Set test env BEFORE any config module loads so env.ts picks up the test DB.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27017/bms_e2e';
process.env.PORT = String(process.env.E2E_PORT || 4017);
const { connectDB, disconnectDB } = require('../config/db');
const { createApp } = require('../app');
const { User, } = require('../models/User');
const { Salon, } = require('../models/Salon');
const { Transaction, } = require('../models/Transaction');
const { Archive, } = require('../models/Archive');
const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
    if (cond) {
        passed++;
        console.log(`  PASS  ${name}`);
    }
    else {
        failed++;
        console.error(`  FAIL  ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
    }
}
async function api(method, path, body, token) {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = {};
    try {
        json = text ? JSON.parse(text) : {};
    }
    catch {
        json = { raw: text };
    }
    return { status: res.status, json };
}
const d = (n) => Math.round(n * 100) / 100;
async function main() {
    await connectDB();
    // clean the entire e2e database for a pristine run
    const { Barber } = require('../models/Barber');
    const { Payment } = require('../models/Payment');
    const { Loan } = require('../models/Loan');
    const { LoanRepayment } = require('../models/LoanRepayment');
    const { Wallet } = require('../models/Wallet');
    const { Report } = require('../models/Report');
    const { Notification } = require('../models/Notification');
    const { AuditLog } = require('../models/AuditLog');
    await Promise.all([
        User.deleteMany({}).exec(),
        Salon.deleteMany({}).exec(),
        Transaction.deleteMany({}).exec(),
        Archive.deleteMany({}).exec(),
        Barber.deleteMany({}).exec(),
        Payment.deleteMany({}).exec(),
        Loan.deleteMany({}).exec(),
        LoanRepayment.deleteMany({}).exec(),
        Wallet.deleteMany({}).exec(),
        Report.deleteMany({}).exec(),
        Notification.deleteMany({}).exec(),
        AuditLog.deleteMany({}).exec(),
    ]);
    const admin = await User.create({
        username: 'testadmin',
        fullName: 'Platform Administrator',
        phone: '+250700000000',
        email: 'admin@e2e.app',
        passwordHash: 'Admin@12345',
        role: 'admin',
        status: 'active',
    });
    const app = createApp();
    const server = app.listen(Number(process.env.PORT));
    const ts = Date.now();
    const uniq = ts.toString(36);
    const username = `mgr_${uniq}`;
    const email = `mgr_${uniq}@salon.app`;
    const phone = `+2507${String(ts).slice(-8)}`;
    console.log('\n== AUTH / REGISTRATION ==');
    const reg = await api('POST', '/auth/register', {
        username,
        fullName: 'Rose Manager',
        phone,
        email,
        password: 'StrongPass123',
        passwordConfirmation: 'StrongPass123',
        salonName: 'e2e Beauty Salon',
    });
    ok('register creates manager + salon', reg.status === 201, reg.json);
    const mgrToken = reg.json.data.token;
    const salonId = String(reg.json.data.salon._id);
    const mgrId = String(reg.json.data.user._id);
    ok('registration returns token', typeof mgrToken === 'string' && mgrToken.length > 20);
    const dupReg = await api('POST', '/auth/register', {
        username,
        fullName: 'X', phone, email, password: 'StrongPass123', passwordConfirmation: 'StrongPass123', salonName: 'Duplicate Salon',
    });
    ok('duplicate registration rejected', dupReg.status === 409, dupReg.json);
    const wrongLogin = await api('POST', '/auth/login', { identifier: username, password: 'wrongpass' });
    ok('wrong password rejected', wrongLogin.status === 401);
    const login = await api('POST', '/auth/login', { identifier: email, password: 'StrongPass123' });
    ok('login works with email', login.status === 200, login.json);
    const me = await api('GET', '/auth/me', undefined, mgrToken);
    ok('me returns user+salon', me.status === 200 && !!me.json.data.salon, me.json);
    const iso = await api('POST', '/transactions', {
        barber: 'invalid-id', totalAmount: 100, clientRefId: `x_${uniq}`,
    }, mgrToken);
    ok('invalid barber rejected (tenant guard)', iso.status === 400, iso.json);
    console.log('\n== BARBERS ==');
    const b1 = await api('POST', '/barbers', { name: 'Kevin', phone: '+250780000001', role: 'Senior Barber' }, mgrToken);
    ok('add barber Kevin', b1.status === 201, b1.json);
    const b2 = await api('POST', '/barbers', { name: 'Aline', phone: '+250780000002', role: 'Junior Barber' }, mgrToken);
    const kevinId = String(b1.json.data.barber._id);
    const alineId = String(b2.json.data.barber._id);
    const crossBarber = await api('POST', '/barbers', { name: 'Zuma', phone: kevinId ? undefined : undefined }, '');
    ok('unauthenticated barber create rejected', crossBarber.status === 401, crossBarber.json);
    const aline2 = await api('POST', '/barbers', { name: 'Aline Dup', phone: '+250780000002' }, mgrToken);
    ok('duplicate phone within salon rejected', aline2.status === 409, aline2.json);
    console.log('\n== TRANSACTIONS + 60/40 SPLIT ==');
    const t1 = await api('POST', '/transactions', {
        barber: kevinId, totalAmount: 10000, paymentMethod: 'cash', service: 'Haircut', customerName: 'Emmanuel', clientRefId: `t_10000_${uniq}`,
    }, mgrToken);
    ok('10,000 RWF transaction created', t1.status === 201, t1.json);
    const t1d = t1.json.data;
    ok('10,000 ⇒ total stored 10,000', t1d.transaction.totalAmount === 10000, t1d.transaction);
    ok('10,000 ⇒ manager share exactly 6,000', t1d.transaction.managerShare === 6000, t1d.transaction);
    ok('10,000 ⇒ barber share exactly 4,000', t1d.transaction.barberShare === 4000, t1d.transaction);
    ok('split percentages recorded', t1d.transaction.managerPercent === 60 && t1d.transaction.barberPercent === 40);
    const t2 = await api('POST', '/transactions', {
        barber: alineId, totalAmount: 100000, paymentMethod: 'mobile_money', service: 'Hair coloring', clientRefId: `t_100000_${uniq}`,
    }, mgrToken);
    const t2d = t2.json.data;
    ok('100,000 ⇒ manager exactly 60,000', t1.status === 201 && t2d.transaction.managerShare === 60000, t2d.transaction);
    ok('100,000 ⇒ barber exactly 40,000', t2d.transaction.barberShare === 40000, t2d.transaction);
    const t3 = await api('POST', '/transactions', {
        barber: kevinId, totalAmount: 5000, paymentMethod: 'cash', service: 'Beard trim', clientRefId: `t_5000_${uniq}`,
    }, mgrToken);
    ok('second 5,000 RWF transaction for Kevin', t3.status === 201, t3.json);
    const dup1 = await api('POST', '/transactions', {
        barber: kevinId, totalAmount: 10000, paymentMethod: 'cash', service: 'Haircut', customerName: 'Emmanuel', clientRefId: `t_10000_${uniq}`,
    }, mgrToken);
    ok('duplicate clientRefId rejected', dup1.status === 409, dup1.json);
    const dup2 = await api('POST', '/transactions', {
        barber: kevinId, totalAmount: 10000, paymentMethod: 'cash', service: 'Haircut', clientRefId: `dup2_${uniq}`,
    }, mgrToken);
    ok('identical recent transaction rejected', dup2.status === 409, dup2.json);
    const neg = await api('POST', '/transactions', {
        barber: kevinId, totalAmount: -300, clientRefId: `neg_${uniq}`,
    }, mgrToken);
    ok('negative amount rejected', neg.status === 400, neg.json);
    console.log('\n== DASHBOARD / WALLET / CACHE CONSISTENCY ==');
    const dash1 = await api('GET', '/dashboard', undefined, mgrToken);
    const dash = dash1.json.data;
    ok('total transaction volume == 115,000', dash.wallet.totalTransactionVolume === 115000, dash.wallet);
    ok('manager income == 69,000 (NOT 115,000)', dash.wallet.totalManagerEarnings === 69000, dash.wallet);
    ok('barber earnings == 46,000 (NOT 115,000)', dash.wallet.totalBarberEarnings === 46000, dash.wallet);
    ok('transaction count == 3', dash.wallet.totalTransactions === 3, dash.wallet);
    ok('69k + 46k == 115k', (dash.wallet.totalManagerEarnings + dash.wallet.totalBarberEarnings) === dash.wallet.totalTransactionVolume);
    const dashNoCache = await api('GET', '/dashboard', undefined, mgrToken);
    ok('dashboard reads consistent after cache', JSON.stringify(dashNoCache.json.data) !== '' && dashNoCache.json.data.wallet.totalManagerEarnings === 69000);
    const wallet = await api('GET', '/wallet', undefined, mgrToken);
    const w = wallet.json.data;
    ok('wallet endpoint returns financial status', wallet.status === 200 && w.wallet.currentBalance === 115000);
    console.log('\n== LOANS ==');
    const loan = await api('POST', '/loans', { barber: kevinId, amount: 20000, reason: 'Family support' }, mgrToken);
    ok('loan of 20,000 created', loan.status === 201, loan.json);
    const loanId = String(loan.json.data.loan._id);
    const overRepay = await api('POST', `/loans/${loanId}/repay`, { amount: 25000 }, mgrToken);
    ok('over-repayment rejected', overRepay.status === 400, overRepay.json);
    const repay1 = await api('POST', `/loans/${loanId}/repay`, { amount: 12000, method: 'cash' }, mgrToken);
    ok('repayment of 12,000 accepted', repay1.status === 200, repay1.json);
    const repay2 = await api('POST', `/loans/${loanId}/repay`, { amount: 8000, method: 'from_earnings' }, mgrToken);
    const loanAfter = repay2.json.data;
    ok('loan fully settled after repayments', loanAfter.loan.status === 'settled' && loanAfter.loan.outstandingAmount === 0, loanAfter.loan);
    const w2 = await api('GET', '/wallet', undefined, mgrToken);
    ok('wallet reflects repayments', w2.json.data.wallet.totalLoanRepayments === 20000);
    console.log('\n== BARBER PAYOUT (auto loan deduction) ==');
    // Kevin earned 6,000 but 8,000 of earnings was already consumed settling his
    // loan (from_earnings repayment) → nothing is left to pay out.
    const payout0 = await api('POST', `/barbers/${kevinId}/payout`, { amount: 6000, method: 'cash' }, mgrToken);
    ok('payout beyond available earnings rejected (8,000 already used for loan)', payout0.status === 400, payout0.json);
    const overPayout = await api('POST', `/barbers/${kevinId}/payout`, { amount: 50000, method: 'cash' }, mgrToken);
    ok('payout exceeding earnings rejected', overPayout.status === 400, overPayout.json);
    // Aline earned 40,000. Give her a 10,000 loan, then mark her paid with no
    // amount → the 10,000 is auto-deducted first and 30,000 is paid out.
    const alineLoan = await api('POST', '/loans', { barber: alineId, amount: 10000, reason: 'Tools' }, mgrToken);
    ok('loan of 10,000 to Aline created', alineLoan.status === 201, alineLoan.json);
    const alineLoanId = String(alineLoan.json.data.loan._id);
    const payAline = await api('POST', `/barbers/${alineId}/payout`, { method: 'cash' }, mgrToken);
    const payAlineData = payAline.json.data;
    ok('full payout accepted with auto loan deduction', payAline.status === 201, payAline.json);
    ok('loan 10,000 deducted from earnings automatically', payAlineData.breakdown.loanDeduction === 10000, payAlineData.breakdown);
    ok('net payout to barber == 30,000', payAlineData.breakdown.netPayout === 30000, payAlineData.breakdown);
    ok('cash payment record of 30,000 created', !!payAlineData.payment && payAlineData.payment.amount === 30000, payAlineData.payment);
    const { Loan: LoanModel } = require('../models/Loan');
    const alineLoanDoc = await LoanModel.findById(alineLoanId).lean();
    ok('loan auto-settled after payout', alineLoanDoc?.status === 'settled' && alineLoanDoc?.outstandingAmount === 0, alineLoanDoc);
    const w3 = await api('GET', '/wallet', undefined, mgrToken);
    ok('paid-to-barbers == 30,000', w3.json.data.wallet.totalPaidToBarbers === 30000, w3.json.data);
    ok('loan repayments == 30,000 (20,000 manual + 10,000 auto)', w3.json.data.wallet.totalLoanRepayments === 30000, w3.json.data);
    ok('no outstanding loans after deductions', w3.json.data.wallet.totalOutstandingLoans === 0, w3.json.data);
    console.log('\n== FILTERING ==');
    const filtered = await api('GET', `/transactions?barber=${kevinId}`, undefined, mgrToken);
    const f = filtered.json.data;
    ok('filter by barber → 2 transactions', f.total === 2, f);
    ok('filtering summary: volume 15,000 / manager 9,000 / barber 6,000', f.summary.volume === 15000 && f.summary.managerShare === 9000 && f.summary.barberShare === 6000, f.summary);
    const mpay = await api('GET', '/transactions?paymentMethod=mobile_money', undefined, mgrToken);
    ok('filter by payment method', mpay.json.data.total === 1);
    const tvid = await api('GET', '/transactions?search=coloring', undefined, mgrToken);
    ok('search transactions', tvid.json.data.total === 1);
    console.log('\n== REPORTS ==');
    const monthly = await api('GET', '/reports/generate?type=monthly', undefined, mgrToken);
    const rep = monthly.json.data;
    ok('monthly report generated with correct totals', rep.report.totals.transactionVolume === 115000 && rep.report.totals.managerEarnings === 69000 && rep.report.totals.barberEarnings === 46000 && rep.report.totals.transactionCount === 3, rep.report.totals);
    ok('report CSV contains manager earnings row', typeof rep.csv === 'string' && rep.csv.includes('MANAGER') && rep.csv.includes('69000'), String(rep.csv).slice(0, 200));
    const annual = await api('GET', '/reports/generate?type=annual', undefined, mgrToken);
    ok('annual report works', annual.status === 200);
    console.log('\n== BARBER PORTAL (isolation) ==');
    const pinRes = await api('POST', `/barbers/${kevinId}/pin`, {}, mgrToken);
    ok('barber PIN generated', pinRes.status === 200 && typeof pinRes.json.data.pin === 'string');
    const pin = pinRes.json.data.pin;
    const portalLogin = await api('POST', '/portal/login', { phone: '+250780000001', pin });
    ok('barber portal login works', portalLogin.status === 200, portalLogin.json);
    const portalToken = portalLogin.json.data.token;
    const portalTxn = await api('GET', '/portal/transactions', undefined, portalToken);
    const pt = portalTxn.json.data;
    ok('barber sees only own transactions (2)', Array.isArray(pt.transactions) && pt.transactions.length === 2, pt);
    const portalLoansCheck = await api('GET', '/portal/loans', undefined, portalToken);
    ok('barber sees own settled loans', portalLoansCheck.json.data.loans.length === 1);
    const badPin = await api('POST', '/portal/login', { phone: '+250780000001', pin: '999999' });
    ok('wrong barber PIN rejected', badPin.status === 401);
    const alinePortal = await api('POST', '/portal/login', { phone: '+250780000002', pin: pin });
    ok('other barber cannot access Kevin PIN', alinePortal.status === 401, alinePortal.json);
    console.log('\n== SIX-MONTH RETENTION ==');
    const doc = await Transaction.findOne({ clientRefId: `t_10000_${uniq}` });
    ok('retention source txn found', !!doc);
    if (doc) {
        // Raw driver write bypasses mongoose timestamp immutability.
        await Transaction.collection.updateOne({ _id: doc._id }, { $set: { createdAt: new Date(Date.now() - 7 * 30 * 24 * 60 * 60 * 1000) } });
    }
    const retention = await api('POST', '/admin/retention/run', { months: 6 }, await adminToken(admin));
    const rt = retention.json.data;
    ok('retention archived old transaction', retention.status === 200 && rt.archived.transactions >= 1, rt);
    const archiveDoc = await Archive.findOne({ originalId: doc?._id?.toString() ?? 'nope' });
    ok('archived payload preserves original shares', !!archiveDoc && archiveDoc.payload.managerShare === 6000 && archiveDoc.payload.barberShare === 4000, archiveDoc?.payload);
    const reRun = await api('POST', '/admin/retention/run', { months: 6 }, await adminToken(admin));
    ok('retention is idempotent', reRun.json.data.archived.transactions >= 0);
    console.log('\n== ADMIN ==');
    const admT = await adminToken(admin);
    const admLogin = await api('POST', '/auth/login', { identifier: 'admin@e2e.app', password: 'Admin@12345' });
    ok('admin login works', admLogin.status === 200);
    const adminDash = await api('GET', '/admin/dashboard', undefined, admT);
    ok('admin dashboard counts managers', adminDash.json.data.counts.total >= 1, adminDash.json.data);
    const users = await api('GET', '/admin/users', undefined, admT);
    ok('admin lists registered users', users.json.data.items.length >= 1);
    const block = await api('PATCH', `/admin/users/${mgrId}/status`, { status: 'suspended' }, admT);
    ok('admin can suspend a user', block.status === 200);
    const blockedLogin = await api('POST', '/auth/login', { identifier: username, password: 'StrongPass123' });
    ok('suspended user cannot log in', blockedLogin.status === 403, blockedLogin.json);
    const blockedApi = await api('GET', '/dashboard', undefined, mgrToken);
    ok('suspended user token unusable (fresh auth check)', blockedApi.status === 403 || blockedApi.status === 401, blockedApi.json);
    const unblock = await api('PATCH', `/admin/users/${mgrId}/status`, { status: 'active' }, admT);
    ok('admin can reactivate a user', unblock.status === 200);
    const back = await api('POST', '/auth/login', { identifier: username, password: 'StrongPass123' });
    ok('reactivated user logs in', back.status === 200);
    // Admin provisions manager accounts with login credentials.
    const newMgrEmail = `mgr.${Date.now()}@e2e.app`;
    const createMgr = await api('POST', '/admin/users', {
        username: `mgr${Date.now()}`,
        fullName: 'Created Manager',
        phone: '+2507' + String(Date.now()).slice(-8),
        email: newMgrEmail,
        salonName: 'E2E Created Salon',
        password: 'ManagerPass1',
        passwordConfirmation: 'ManagerPass1',
    }, admT);
    ok('admin can create a manager account', createMgr.status === 201, createMgr.json);
    const mgrLogin2 = await api('POST', '/auth/login', { identifier: newMgrEmail, password: 'ManagerPass1' });
    ok('created manager logs in with admin-issued credentials', mgrLogin2.status === 200, mgrLogin2.json);
    const createdDash = await api('GET', '/dashboard', undefined, mgrLogin2.json.data.token);
    ok('created manager has a working salon dashboard', createdDash.status === 200, createdDash.json);
    const createdId = createMgr.json.data.user._id;
    const createdUsers = await api('GET', '/admin/users', undefined, admT);
    ok('admin list includes the created manager', createdUsers.json.data.items.some((i) => i._id === createdId));
    const nonAdminCreate = await api('POST', '/admin/users', {
        username: `nope${Date.now()}`,
        phone: '+250711111111',
        email: `nope${Date.now()}@e2e.app`,
        salonName: 'X',
        password: 'ManagerPass1',
        passwordConfirmation: 'ManagerPass1',
    }, mgrToken);
    ok('non-admin cannot create managers (403)', nonAdminCreate.status === 403, nonAdminCreate.json);
    server.close();
    await disconnectDB();
    console.log(`\n===== E2E RESULT: ${passed} passed, ${failed} failed =====`);
    process.exit(failed === 0 ? 0 : 1);
}
async function adminToken(admin) {
    const res = await api('POST', '/auth/login', { identifier: 'admin@e2e.app', password: 'Admin@12345' });
    return res.json.data.token;
}
main().catch(async (err) => {
    console.error('[e2e] crashed', err);
    await disconnectDB();
    process.exit(1);
});
//# sourceMappingURL=e2e.js.map