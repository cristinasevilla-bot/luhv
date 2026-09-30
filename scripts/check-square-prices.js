#!/usr/bin/env node
//
// check-square-prices.js
//
// Opens every Square checkout link used in landing.html and index.html, reads
// what Square will actually charge, and checks that amount exists in
// SQUARE_PRODUCTS. The webhook picks the plan by amount alone, so a link whose
// price is missing from the catalogue takes the customer's money and grants
// nothing ("pagué pero no tengo acceso").
//
//   node scripts/check-square-prices.js
//
// Exits 1 on any mismatch. Needs network access (Node 18+ for fetch).

'use strict';

const fs = require('fs');
const path = require('path');
const { SQUARE_PRODUCTS } = require('../square-products');

const ROOT = path.join(__dirname, '..');
const FILES = ['landing.html', 'index.html'];

const links = new Set();
for (const f of FILES) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of html.matchAll(/https:\/\/square\.link\/u\/[A-Za-z0-9]+/g)) links.add(m[0]);
}

(async () => {
  let failed = false;
  for (const url of links) {
    let amount = null, name = '?';
    try {
      const html = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
      amount = Number((html.match(/"amount":(\d+)/) || [])[1]) || null;
      name = (html.match(/"name":"(?!Email)([^"]+)"/) || [])[1] || '?';
    } catch (e) {
      console.error(`✗ ${url} — could not load: ${e.message}`);
      failed = true;
      continue;
    }
    const product = SQUARE_PRODUCTS[amount];
    if (!product) {
      console.error(`✗ ${url} "${name}" charges ${amount} — NOT in SQUARE_PRODUCTS, buyers get no access`);
      failed = true;
    } else {
      console.log(`✓ ${url} "${name}" charges ${amount} → ${product.label}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
