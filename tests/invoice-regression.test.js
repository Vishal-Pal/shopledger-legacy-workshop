var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');

test('invoice total and GST breakdown match the billed checkout with capped SAVE10', function () {
  var items = [{ id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 2 }];
  var billed = pricing.computeTotals(items, 'SAVE10');
  var figures = invoice.computeInvoiceFigures(Object.assign({ items: items, coupon: 'SAVE10' }, billed));
  assert.deepEqual({ total: figures.total, discount: figures.discount, tax: figures.tax,
    cgst: figures.cgst, sgst: figures.sgst },
  { total: 1942.5, discount: 150, tax: 92.5, cgst: 46.25, sgst: 46.25 });
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 92.5);
});
