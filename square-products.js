// ── SQUARE PRODUCT CATALOGUE ─────────────────────────────────────────────────
// Keyed by charge amount in the smallest currency unit.
//
// The amount is the only reliable signal for which product was bought: Square's
// payment.* events carry the payment object alone, never the order, so
// line_items[0].name — which the previous plan detection relied on — is always
// undefined. That left every purchase falling through to a starter/30d default,
// so MVP buyers silently lost coach access and annual buyers lost 11 months.
//
// Keep in sync with what the Square checkout links ACTUALLY charge — not with
// the prices written on the page. Run `node scripts/check-square-prices.js`
// (CI runs it too). An amount that is not listed here is NOT guessed at — see
// the webhook handler.
//
// The live links charge $19.99 for MVP monthly and $99.99 for Starter annual,
// while this table only knew $29.99 and $99. Those buyers paid and were granted
// nothing. The old amounts stay listed in case the links are changed back.
const SQUARE_PRODUCTS = {
  200:   { tier: 'mvp',     days: 7,     is_trial: true,  label: '7-day trial ($2)' },
  999:   { tier: 'starter', months: 1,   is_trial: false, label: 'Starter monthly ($9.99)' },
  1999:  { tier: 'mvp',     months: 1,   is_trial: false, label: 'MVP monthly ($19.99)' },
  2999:  { tier: 'mvp',     months: 1,   is_trial: false, label: 'MVP monthly ($29.99)' },
  9900:  { tier: 'starter', months: 12,  is_trial: false, label: 'Starter annual ($99)' },
  9999:  { tier: 'starter', months: 12,  is_trial: false, label: 'Starter annual ($99.99)' },
  20000: { tier: 'mvp',     months: 12,  is_trial: false, label: 'MVP annual ($200)' },
};

// Paid plans are measured in calendar months because that is how Square bills
// subscriptions: a plan bought on Mar 1 renews on Apr 1. A flat 30 days ended
// access on Mar 31, a day before the renewal charge, so every 31-day month
// locked paying customers out and told them their plan had expired.
function addPeriod(from, product) {
  const d = new Date(from.getTime());
  if (product.months) {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + product.months);
    // Jan 31 + 1 month must be Feb 28/29, not Mar 3.
    if (d.getUTCDate() !== day) d.setUTCDate(0);
  } else {
    d.setUTCDate(d.getUTCDate() + product.days);
  }
  return d;
}

const TIER_RANK = { starter: 1, mvp: 2, pro: 2 };

// What a payment does to an account. Every payment used to overwrite the plan
// with "this product, starting now", so:
//   - renewing or paying early threw away the days already paid for,
//   - a $2 trial bought by an annual customer cut them to 7 days,
//   - a leftover Starter renewal demoted a customer who had upgraded to MVP.
// A payment now only ever adds access; it never shortens or downgrades.
//
// `existing` is the users row (or null). Returns { tier, end, is_trial, note },
// or null when the payment should not change the account at all.
function nextPlan(existing, product, now) {
  const existingEnd = existing && existing.billing_period_end ? new Date(existing.billing_period_end) : null;
  const active = !!existingEnd && existingEnd > now && !!TIER_RANK[existing.tier];

  if (!active) {
    return { tier: product.tier, end: addPeriod(now, product), is_trial: product.is_trial, note: 'new' };
  }

  // A trial on top of a live plan buys nothing and must not replace it.
  if (product.is_trial) return null;

  const have = TIER_RANK[existing.tier];
  const want = TIER_RANK[product.tier];

  // Renewal of the same plan: the new period starts where the old one ends.
  if (want === have && !existing.is_trial) {
    return { tier: existing.tier, end: addPeriod(existingEnd, product), is_trial: false, note: 'renewal' };
  }

  // Upgrade, or first paid plan after a trial: the new plan starts now, and
  // never ends earlier than what they already had.
  if (want > have || existing.is_trial) {
    const end = addPeriod(now, product);
    return { tier: product.tier, end: end > existingEnd ? end : existingEnd, is_trial: false, note: 'upgrade' };
  }

  // A lower plan while a higher one is live (usually an old Starter
  // subscription still renewing after an upgrade to MVP). Keep the higher
  // tier; extend only if this payment reaches further.
  const end = addPeriod(now, product);
  return { tier: existing.tier, end: end > existingEnd ? end : existingEnd, is_trial: false, note: 'overlap' };
}

module.exports = { SQUARE_PRODUCTS, addPeriod, nextPlan };
