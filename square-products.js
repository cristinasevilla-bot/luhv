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
  200:   { tier: 'mvp',     days: 7,   is_trial: true,  label: '7-day trial ($2)' },
  999:   { tier: 'starter', days: 30,  is_trial: false, label: 'Starter monthly ($9.99)' },
  1999:  { tier: 'mvp',     days: 30,  is_trial: false, label: 'MVP monthly ($19.99)' },
  2999:  { tier: 'mvp',     days: 30,  is_trial: false, label: 'MVP monthly ($29.99)' },
  9900:  { tier: 'starter', days: 365, is_trial: false, label: 'Starter annual ($99)' },
  9999:  { tier: 'starter', days: 365, is_trial: false, label: 'Starter annual ($99.99)' },
  20000: { tier: 'mvp',     days: 365, is_trial: false, label: 'MVP annual ($200)' },
};

module.exports = { SQUARE_PRODUCTS };
