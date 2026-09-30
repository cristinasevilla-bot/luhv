#!/usr/bin/env node
// Tests for the payment → access rules in square-products.js.
//   node scripts/test-plans.js
'use strict';
const assert = require('assert');
const { SQUARE_PRODUCTS: P, addPeriod, nextPlan } = require('../square-products');

const day = (d) => d.toISOString().slice(0, 10);
const now = new Date('2026-03-01T14:00:00Z');
const tests = {
  'monthly plans follow the calendar (Mar 1 → Apr 1)': () =>
    assert.strictEqual(day(addPeriod(now, P[1999])), '2026-04-01'),
  'Jan 31 + 1 month is the end of February': () =>
    assert.strictEqual(day(addPeriod(new Date('2026-01-31T10:00:00Z'), P[999])), '2026-02-28'),
  'annual from Feb 29 lands on Feb 28': () =>
    assert.strictEqual(day(addPeriod(new Date('2028-02-29T10:00:00Z'), P[20000])), '2029-02-28'),
  'trial is 7 days': () => assert.strictEqual(day(addPeriod(now, P[200])), '2026-03-08'),
  'new customer gets the product from now': () => {
    const r = nextPlan(null, P[1999], now);
    assert.strictEqual(r.tier, 'mvp'); assert.strictEqual(day(r.end), '2026-04-01');
  },
  'renewal extends from the old end, not from now': () => {
    const r = nextPlan({ tier: 'mvp', billing_period_end: '2026-04-01T14:00:00Z', is_trial: false }, P[1999], new Date('2026-04-01T13:59:00Z'));
    assert.strictEqual(day(r.end), '2026-05-01');
  },
  'paying early keeps the days already paid for': () => {
    const r = nextPlan({ tier: 'starter', billing_period_end: '2026-03-21T14:00:00Z', is_trial: false }, P[9999], now);
    assert.strictEqual(day(r.end), '2027-03-21');
  },
  'a trial bought during a paid plan changes nothing': () =>
    assert.strictEqual(nextPlan({ tier: 'mvp', billing_period_end: '2026-12-01T00:00:00Z', is_trial: false }, P[200], now), null),
  'a Starter renewal never demotes a live MVP plan': () => {
    const r = nextPlan({ tier: 'mvp', billing_period_end: '2027-01-01T00:00:00Z', is_trial: false }, P[999], now);
    assert.strictEqual(r.tier, 'mvp'); assert.strictEqual(day(r.end), '2027-01-01');
  },
  'upgrade Starter → MVP starts now': () => {
    const r = nextPlan({ tier: 'starter', billing_period_end: '2026-03-10T00:00:00Z', is_trial: false }, P[1999], now);
    assert.strictEqual(r.tier, 'mvp'); assert.strictEqual(day(r.end), '2026-04-01'); assert.strictEqual(r.is_trial, false);
  },
  'trial → paid clears the trial flag': () => {
    const r = nextPlan({ tier: 'mvp', billing_period_end: '2026-03-05T00:00:00Z', is_trial: true }, P[1999], now);
    assert.strictEqual(r.is_trial, false); assert.strictEqual(day(r.end), '2026-04-01');
  },
  'expired customer buying again starts fresh': () => {
    const r = nextPlan({ tier: 'basic', billing_period_end: '2026-01-01T00:00:00Z', is_trial: false }, P[999], now);
    assert.strictEqual(r.tier, 'starter'); assert.strictEqual(day(r.end), '2026-04-01');
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('✓', name); } catch (e) { failed++; console.error('✗', name, '—', e.message); }
}
process.exit(failed ? 1 : 0);
