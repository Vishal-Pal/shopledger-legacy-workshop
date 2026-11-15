var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var tax = require('../lib/tax');
var coupons = require('../lib/coupons');
var inventory = require('../lib/inventory');
var orders = require('../lib/orders');
var ledger = require('../lib/ledger');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

// These assertions capture existing behavior, including defects, before refactoring.
// Each test uses fresh in-memory data; none reads or writes data/db.json.
function item() {
  return { id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 2 };
}

test('checkout caps SAVE10 and taxes the discounted value at the HSN rate', function () {
  var totals = pricing.computeTotals([item()], ' save10 ');
  assert.deepEqual([totals.subtotal, totals.discount, totals.taxable,
    totals.tax, totals.cgst, totals.sgst, totals.total],
  [2000, 150, 1850, 92.5, 46.25, 46.25, 1942.5]);
});

test('coupon validation rejects expired, unknown and below-minimum codes', function () {
  assert.equal(coupons.validate('DIWALI20', 2000).valid, false);
  assert.equal(coupons.validate('missing', 2000).valid, false);
  assert.equal(coupons.validate('SAVE10', 499).valid, false);
  assert.equal(coupons.validate('SAVE10', 500).discount, 50);
  assert.equal(coupons.validate('', 0).valid, true);
});

test('tax accepts percentage or decimal overrides, exact HSN matches and fallback', function () {
  assert.equal(tax.getRateForItem({ gstRate: 12 }), 0.12);
  assert.equal(tax.getRateForItem({ gstRate: 0.12 }), 0.12);
  assert.equal(tax.getRateForItem({ hsn: '1006' }), 0.05);
  assert.equal(tax.getRateForItem({ hsn: '100630' }), 0.18);
  assert.deepEqual(tax.splitCgstSgst(0.05), { cgst: 0.03, sgst: 0.02 });
});

test('KNOWN LIMITATION: stock check leaves a buffer of one sellable unit', function () {
  var products = [{ id: 1, name: 'Rice', stock: 10, reserved: 2 }];
  assert.equal(inventory.getSellableStock(products[0]), 8);
  assert.equal(inventory.check(products, [{ id: 1, qty: 7 }]).ok, true);
  assert.equal(inventory.check(products, [{ id: 1, qty: 8 }]).ok, false);
  inventory.reserve(products, [{ id: 1, qty: 2 }]);
  assert.equal(products[0].stock, 8);
  assert.equal(products[0].reserved, 2);
});

test('khata enforces credit limit and records numeric settlements', function () {
  var db = { customers: [{ id: 1, name: 'Shop', openingBalance: 100,
    totalBilled: 0, totalSettled: 0, creditLimit: 200 }], nextSettlementId: 501 };
  assert.equal(ledger.chargeOrderToKhata(db, 1, 100).ok, true);
  assert.equal(ledger.chargeOrderToKhata(db, 1, 1).ok, false);
  var result = ledger.recordSettlement(db, 1, 50, 'cash');
  assert.equal(result.customer.balance, 150);
  assert.equal(result.settlement.id, 501);
  assert.equal(db.settlements.length, 1);
});

test('KNOWN DEFECT: string settlement concatenates with totalSettled before subtraction', function () {
  var db = { customers: [{ id: 1, totalBilled: 100, totalSettled: 20 }],
    nextSettlementId: 1 };
  var result = ledger.recordSettlement(db, 1, '10');
  assert.equal(result.customer.totalSettled, '2010');
  assert.equal(result.customer.balance, -1910);
  assert.equal(result.settlement.amount, 10);
});

test('KNOWN DEFECT: cancellation reverses khata but does not restore normal order stock', function () {
  var db = { products: [{ id: 1, stock: 8, reserved: 2 }],
    customers: [{ id: 1, totalBilled: 100, totalSettled: 0 }],
    orders: [{ id: 1001, paymentMode: 'khata', customerId: 1, total: 100,
      items: [{ id: 1, qty: 2 }], status: 'completed' }] };
  assert.equal(orders.cancel(db, 1001).ok, true);
  assert.equal(db.customers[0].totalBilled, 0);
  assert.deepEqual(db.products[0], { id: 1, stock: 8, reserved: 2 });
  assert.equal(orders.cancel(db, 1001).ok, false);
});

test('invoice uses HSN rates and coupon caps; reconciliation matches checkout', function () {
  var totals = pricing.computeTotals([item()], 'SAVE10');
  var order = Object.assign({ id: 1, items: [item()], coupon: 'SAVE10' }, totals);
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [150, 92.5, 1942.5]);
  var reconciliation = reports.getGstReconciliation({ orders: [order] });
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('dashboard includes pending revenue and excludes cancelled orders from reconciliation', function () {
  var summary = reports.getDashboardSummary({ orders: [
    { status: 'pending', total: 100, tax: 0, discount: 0, subtotal: 100 },
    { status: 'cancelled', total: 200 }
  ] });
  assert.equal(summary.grossRevenue, 100);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(reports.getGstReconciliation({ orders: [{ status: 'cancelled' }] }).totalChecked, 0);
});

test('order search is case insensitive and missing status means completed', function () {
  var db = { orders: [{ id: 1, customer: 'Corner Shop', date: '01/11/2021' },
    { id: 2, customer: 'Other', status: 'cancelled', date: '02/11/2021' }] };
  assert.deepEqual(orders.list(db, { search: 'CORNER', status: 'completed' }).map(function (o) {
    return o.id;
  }), [1]);
});

test('KNOWN DEFECT: date filtering and sorting compare day-first strings across months', function () {
  var db = { orders: [{ id: 1, date: '31/10/2021' }, { id: 2, date: '01/11/2021' }] };
  assert.deepEqual(orders.list(db, {}).map(function (o) { return o.id; }), [1, 2]);
  assert.deepEqual(orders.list(db, { from: '2021-11-01' }).map(function (o) {
    return o.id;
  }), [1, 2]);
});


