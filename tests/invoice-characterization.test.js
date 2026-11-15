var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var orders = require('../lib/orders');
var reports = require('../lib/reports');

function item(overrides) {
  return Object.assign({ id: 1, name: 'Rice', sku: 'RICE', hsn: '1006',
    price: 100, qty: 1 }, overrides);
}

function billedOrder(items, coupon) {
  var totals = pricing.computeTotals(items, coupon);
  var db = { nextOrderId: 1, orders: [] };
  return orders.add(db, Object.assign({ items: items, coupon: coupon,
    date: '15/11/2026' }, totals));
}

function amounts(figures) {
  return [figures.subtotal, figures.discount, figures.tax,
    figures.cgst, figures.sgst, figures.total];
}

test('CURRENT BEHAVIOUR: invoice follows checkout HSN slabs and mixed GST rates', function () {
  var order = billedOrder([item(), item({ id: 2, hsn: '0405' }),
    item({ id: 3, hsn: '0902' })], '');
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual(amounts(figures), [300, 0, 35, 17.5, 17.5, 335]);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.hsn, row.gstPercent, row.lineTax];
  }), [['1006', 5, 5], ['0405', 12, 12], ['0902', 18, 18]]);
  assert.equal(reports.getGstReconciliation({ orders: [order] }).mismatchCount, 0);
});

test('CURRENT BEHAVIOUR: invoice uses the capped SAVE10 discount and post-discount HSN GST', function () {
  var order = billedOrder([item({ price: 1000, qty: 2 })], 'SAVE10');
  var figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([order.subtotal, order.discount, order.tax, order.total],
    [2000, 150, 92.5, 1942.5]);
  assert.deepEqual(amounts(figures), [2000, 150, 92.5, 46.25, 46.25, 1942.5]);
  assert.deepEqual(figures.rows[0], { name: 'Rice', sku: 'RICE', hsn: '1006',
    qty: 2, price: 1000, gstPercent: 5, line: 2000, lineTax: 92.5 });
  assert.equal(reports.getGstReconciliation({ orders: [order] }).mismatchCount, 0);
});

test('CURRENT BEHAVIOUR: invoice coupon breakdown follows checkout for percentage and flat discounts', function () {
  var percentOrder = billedOrder([item({ hsn: '0902' })], 'WELCOME');
  assert.deepEqual(amounts(invoice.computeInvoiceFigures(percentOrder)),
    [100, 5, 17.1, 8.55, 8.55, 112.1]);
  var flatOrder = billedOrder([item({ hsn: '0902', price: 500 })], 'FLAT50');
  assert.deepEqual(amounts(invoice.computeInvoiceFigures(flatOrder)),
    [500, 50, 81, 40.5, 40.5, 531]);
});

test('CURRENT BEHAVIOUR: invoice uses checkout GST override parsing and zero rates', function () {
  [[12, 12, 12], [0.12, 12, 12], [0, 0, 0]].forEach(function (example) {
    var items = [item({ gstRate: example[0] })];
    assert.equal(pricing.computeTotals(items, '').tax, example[1]);
    var figures = invoice.computeInvoiceFigures({ items: items });
    assert.equal(figures.tax, example[1]);
    assert.equal(figures.rows[0].gstPercent, example[2]);
  });
});

test('CURRENT BEHAVIOUR: invoice and checkout sum rounded per-line GST', function () {
  var items = [item({ price: 0.03, gstRate: 18 }),
    item({ id: 2, price: 0.03, gstRate: 18 })];
  var checkout = pricing.computeTotals(items, '');
  var figures = invoice.computeInvoiceFigures({ items: items });
  assert.deepEqual(amounts(checkout), [0.06, 0, 0.02, 0.01, 0.01, 0.08]);
  assert.deepEqual(amounts(figures), amounts(checkout));
});

test('CURRENT BEHAVIOUR: invoice recalculates totals from item inputs and compares them to ledger total', function () {
  var order = billedOrder([item()], '');
  var before = JSON.stringify(order);
  var html = invoice.render(order);
  assert.match(html, /Invoice Total<\/td><td class="r">₹105\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
  assert.equal(JSON.stringify(order), before);
  var altered = Object.assign({}, order, { subtotal: 999, discount: 999, tax: 999, total: 999 });
  assert.deepEqual(invoice.computeInvoiceFigures(altered), invoice.computeInvoiceFigures(order));
});




