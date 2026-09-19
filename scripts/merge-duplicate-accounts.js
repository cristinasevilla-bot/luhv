#!/usr/bin/env node
//
// merge-duplicate-accounts.js
//
// Repairs the duplicate rows created by the old case-sensitive
// ON CONFLICT (email) in the Square webhook.
//
// users.email is UNIQUE, but a Postgres unique constraint compares exactly:
// 'Ann@x.com' and 'ann@x.com' are two legal rows. The webhook inserted
// lowercase, so it never collided with an older capitalised row and quietly
// created a second account. The customer then had their password on one row
// and their paid plan on the other, and login (WHERE LOWER(email)=...) matched
// both and took whichever the planner returned first. They were locked out of
// something they had paid for.
//
// This script folds each group of rows sharing LOWER(TRIM(email)) into one.
//
//   node scripts/merge-duplicate-accounts.js            # dry run, changes nothing
//   node scripts/merge-duplicate-accounts.js --apply    # commit the merge
//
// The dry run prints exactly what --apply would do. Read it before applying,
// and take a database snapshot first: this deletes rows.

try { require('dotenv').config(); } catch (e) { /* dotenv is optional */ }

const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it or put it in .env, then re-run.');
  process.exit(1);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Plan columns travel together: they all describe one purchase, so they are
// copied from a single source row rather than picked field by field. Mixing
// a tier from one row with an expiry from another invents a plan nobody bought.
const PLAN_COLUMNS = [
  'tier',
  'billing_period_end',
  'token_balance',
  'is_trial',
  'square_customer_id',
  'square_order_id',
  'subscription_status',
  'payment_provider'
];

const log = (...a) => console.log(...a);

function ts(v) {
  return v ? new Date(v).toISOString().slice(0, 10) : '—';
}

// Every table with a foreign key to users(id), discovered rather than
// hardcoded: the live database has tables that schema.sql does not.
async function childTables() {
  const { rows } = await db.query(`
    SELECT con.conrelid::regclass::text AS table_name,
           att.attname                  AS column_name
    FROM pg_constraint con
    JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = k.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'users'::regclass
  `);
  return rows;
}

async function userColumns() {
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`
  );
  return new Set(rows.map(r => r.column_name));
}

async function duplicateGroups() {
  const { rows } = await db.query(`
    SELECT LOWER(TRIM(email)) AS key, COUNT(*)::int AS n
    FROM users
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
    ORDER BY 1
  `);
  return rows;
}

// How much of the user's actual work hangs off each row. The row with the most
// history is the one they have been living in, so it survives and everything
// else is folded into it. Merging the other way round would repoint more rows
// than necessary and risk more unique-constraint collisions.
async function childCounts(children, id) {
  let total = 0;
  const per = {};
  for (const c of children) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${c.table_name} WHERE ${c.column_name} = $1`,
      [id]
    );
    if (rows[0].n) per[c.table_name] = rows[0].n;
    total += rows[0].n;
  }
  return { total, per };
}

function pickSurvivor(rows, counts) {
  return rows.slice().sort((a, b) => {
    const d = counts[b.id].total - counts[a.id].total;
    if (d) return d;
    // Tie: the oldest row is the original account.
    return new Date(a.created_at || 0) - new Date(b.created_at || 0) || a.id - b.id;
  })[0];
}

// The row holding the plan the customer is actually entitled to: the one whose
// access runs longest. An expired row must never win over a live one.
function pickPlanSource(rows) {
  const withPlan = rows.filter(r => r.billing_period_end);
  if (!withPlan.length) return null;
  return withPlan.sort(
    (a, b) => new Date(b.billing_period_end) - new Date(a.billing_period_end)
  )[0];
}

// The credentials they last set. A row with no password_hash cannot log in, so
// it never wins.
function pickCredentialSource(rows) {
  const withPass = rows.filter(r => r.password_hash);
  if (!withPass.length) return null;
  return withPass.sort(
    (a, b) => new Date(b.last_active || b.created_at || 0) - new Date(a.last_active || a.created_at || 0)
  )[0];
}

// The webhook names accounts after the email prefix, so prefer anything the
// person actually typed.
function pickName(rows, key) {
  const prefix = key.split('@')[0].toLowerCase();
  const named = rows
    .map(r => (r.name || '').trim())
    .filter(Boolean)
    .filter(n => n.toLowerCase() !== prefix && n.toLowerCase() !== key);
  return named[0] || (rows.find(r => (r.name || '').trim()) || {}).name || key.split('@')[0];
}

function buildMerged(rows, key, cols) {
  const planSrc = pickPlanSource(rows);
  const credSrc = pickCredentialSource(rows);
  const merged = { email: key };

  if (cols.has('name')) merged.name = pickName(rows, key);
  if (cols.has('password_hash') && credSrc) merged.password_hash = credSrc.password_hash;

  if (planSrc) {
    for (const c of PLAN_COLUMNS) {
      if (cols.has(c)) merged[c] = planSrc[c];
    }
  }

  // Counters: never hand back less than the best row already showed them.
  for (const c of ['streak', 'coins']) {
    if (cols.has(c)) merged[c] = Math.max(...rows.map(r => Number(r[c] || 0)));
  }
  if (cols.has('is_admin')) merged.is_admin = rows.some(r => r.is_admin);
  if (cols.has('created_at')) {
    const oldest = rows.map(r => r.created_at).filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];
    if (oldest) merged.created_at = oldest;
  }
  if (cols.has('last_active')) {
    const newest = rows.map(r => r.last_active).filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0];
    if (newest) merged.last_active = newest;
  }

  return { merged, planSrc, credSrc };
}

async function run() {
  const groups = await duplicateGroups();

  if (!groups.length) {
    log('No duplicate accounts. Nothing to merge.');
    if (APPLY) await ensureIndex();
    return;
  }

  const children = await childTables();
  const cols = await userColumns();

  log('');
  log(APPLY ? 'MERGING DUPLICATE ACCOUNTS' : 'DRY RUN — no changes will be written');
  log(`${groups.length} email(s) with more than one row`);
  log('');

  let merged = 0;
  let deletedConflicts = 0;

  for (const g of groups) {
    const { rows } = await db.query(
      `SELECT * FROM users WHERE LOWER(TRIM(email)) = $1 ORDER BY id`,
      [g.key]
    );

    const counts = {};
    for (const r of rows) counts[r.id] = await childCounts(children, r.id);

    const survivor = pickSurvivor(rows, counts);
    const losers = rows.filter(r => r.id !== survivor.id);
    const { merged: fields, planSrc, credSrc } = buildMerged(rows, g.key, cols);

    log(`── ${g.key}`);
    for (const r of rows) {
      const marks = [
        r.id === survivor.id ? 'KEEP' : 'fold',
        r.password_hash ? 'password' : 'no password',
        `tier=${r.tier || 'basic'}`,
        `until=${ts(r.billing_period_end)}`,
        `data=${counts[r.id].total}`
      ];
      log(`   id=${r.id} "${r.email}" ${marks.join('  ')}`);
    }
    log(`   → surviving row: id=${survivor.id}`);
    log(`     email        → ${fields.email}`);
    if (fields.name) log(`     name         → ${fields.name}`);
    log(`     password     → ${credSrc ? `from id=${credSrc.id}` : 'NONE (user must use Forgot password)'}`);
    log(`     plan         → ${planSrc ? `from id=${planSrc.id}: ${planSrc.tier} until ${ts(planSrc.billing_period_end)}` : 'none on any row'}`);

    if (!APPLY) {
      const moving = losers.reduce((n, l) => n + counts[l.id].total, 0);
      log(`     would repoint ${moving} child row(s) and delete ${losers.length} row(s)`);
      log('');
      merged++;
      continue;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Children move BEFORE the losers are deleted. These foreign keys are
      // ON DELETE CASCADE, so deleting first would take the user's habits,
      // goals, journal and coach history with it.
      for (const l of losers) {
        for (const c of children) {
          await client.query('SAVEPOINT mv');
          try {
            await client.query(
              `UPDATE ${c.table_name} SET ${c.column_name} = $1 WHERE ${c.column_name} = $2`,
              [survivor.id, l.id]
            );
            await client.query('RELEASE SAVEPOINT mv');
          } catch (e) {
            if (e.code !== '23505') throw e;
            // A unique constraint (push_subscriptions.user_id,
            // habit_completions habit+user+date) says the surviving row
            // already has this exact record, so the duplicate is redundant.
            await client.query('ROLLBACK TO SAVEPOINT mv');
            const { rowCount } = await client.query(
              `DELETE FROM ${c.table_name} WHERE ${c.column_name} = $1`,
              [l.id]
            );
            await client.query('RELEASE SAVEPOINT mv');
            deletedConflicts += rowCount;
            log(`     note: ${rowCount} redundant ${c.table_name} row(s) dropped (already on surviving row)`);
          }
        }
      }

      const keys = Object.keys(fields);
      await client.query(
        `UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(', ')} WHERE id=$${keys.length + 1}`,
        [...keys.map(k => fields[k]), survivor.id]
      );

      await client.query(
        `DELETE FROM users WHERE id = ANY($1::int[])`,
        [losers.map(l => l.id)]
      );

      await client.query('COMMIT');
      log(`     merged, ${losers.length} row(s) deleted`);
      merged++;
    } catch (e) {
      await client.query('ROLLBACK');
      log(`     FAILED, rolled back: ${e.message}`);
    } finally {
      client.release();
    }
    log('');
  }

  log('');
  log(APPLY
    ? `Done. ${merged} account(s) merged.${deletedConflicts ? ` ${deletedConflicts} redundant child row(s) dropped.` : ''}`
    : `Dry run complete. ${merged} account(s) would be merged. Re-run with --apply to commit.`);

  if (APPLY) await ensureIndex();
}

// The index is what stops this happening again: once LOWER(email) is unique,
// the webhook's ON CONFLICT (email) can no longer create a second row.
async function ensureIndex() {
  try {
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))');
    log('users_email_lower_idx is in place — duplicates can no longer be created.');
  } catch (e) {
    log(`Could not create users_email_lower_idx: ${e.message}`);
    log('Duplicates probably still exist. Re-run the dry run.');
  }
}

run()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => db.end());
