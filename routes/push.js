// ============================================================
// MELTOS push notifications — subscriptions + scheduled nudges
// ============================================================
// Mounted by server.js at /push. It used to be a standalone router that was
// never mounted, talked to Supabase with its own service key, and took the
// userId from the request body without any auth (anyone could subscribe or
// unsubscribe anyone). The nudges were fired by cron.js, which nothing ran.
//
// Now: the signed-in user is the only user a request can touch, data comes from
// the app's own Postgres pool, and the schedule runs inside the API process on
// US Eastern time.
//
// Needs on Render: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_MAILTO
// (mailto:you@example.com). VAPID_PUBLIC_KEY must match the key in index.html.

const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const engine = require('./nudge-engine');

const TZ = 'America/New_York';

// Local-time schedule (New York). The streak "danger" nudge goes out at 9pm,
// three hours before the day — and the streak — ends at midnight.
const SCHEDULE = [
  { cron: '0 8 * * *',  nudgeType: 'morning' },
  { cron: '0 13 * * *', nudgeType: 'midday' },
  { cron: '0 20 * * *', nudgeType: 'evening' },
  { cron: '0 21 * * *', nudgeType: 'danger' },
];

// Express 4 doesn't catch rejected promises, and server.js's wrapper only
// covers app.get/post/..., not routers — so wrap these handlers here.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createPush({ db, auth, hasActivePaidAccess, ymdET }) {
  const router = express.Router();

  const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_MAILTO);
  if (configured) {
    webpush.setVapidDetails(process.env.VAPID_MAILTO, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  } else {
    // setVapidDetails throws on missing keys; doing it unguarded would take the
    // whole API down on boot.
    console.warn('⚠️ Push notifications disabled: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_MAILTO');
  }

  // One row per browser/device, so a user can get nudges on phone and laptop.
  async function migrate() {
    await db.query(`CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      keys       JSONB NOT NULL,
      peak_hour  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_web_push_user ON web_push_subscriptions(user_id)');
  }

  router.post('/subscribe', auth, wrap(async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'Push notifications are not configured' });
    const sub = req.body && req.body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'Missing subscription' });
    await db.query(
      `INSERT INTO web_push_subscriptions (endpoint, user_id, keys, peak_hour)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys,
             peak_hour = EXCLUDED.peak_hour, updated_at = NOW()`,
      [sub.endpoint, req.user.id, JSON.stringify(sub.keys), String(req.body.peakHour || '').slice(0, 60) || null]
    );
    res.json({ success: true });
  }));

  router.post('/unsubscribe', auth, wrap(async (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (endpoint) {
      await db.query('DELETE FROM web_push_subscriptions WHERE user_id=$1 AND endpoint=$2', [req.user.id, endpoint]);
    } else {
      await db.query('DELETE FROM web_push_subscriptions WHERE user_id=$1', [req.user.id]);
    }
    res.json({ success: true });
  }));

  // Manual trigger (e.g. to test from a terminal). Guarded by CRON_SECRET.
  router.post('/send-nudge', wrap(async (req, res) => {
    if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const nudgeType = req.body && req.body.nudgeType;
    if (!nudgeType) return res.status(400).json({ error: 'nudgeType required' });
    res.json(await sendNudgesForType(nudgeType));
  }));

  async function sendNudgesForType(nudgeType) {
    const results = { nudgeType, sent: 0, failed: 0, skipped: 0 };
    if (!configured) return results;

    const today = ymdET(new Date());
    const weekAgo = ymdET(new Date(Date.now() - 7 * 86400000));

    const { rows: subs } = await db.query(
      `SELECT s.endpoint, s.keys, s.user_id, u.name, u.streak, u.tier, u.billing_period_end, u.onboarding_data
         FROM web_push_subscriptions s JOIN users u ON u.id = s.user_id`
    );

    for (const sub of subs) {
      try {
        // Only paying customers get nudged.
        if (!hasActivePaidAccess(sub)) { results.skipped++; continue; }

        const [habitsR, goalsR, todayR, weekR] = await Promise.all([
          db.query('SELECT id, name, icon, target_type, daily_target FROM habits WHERE user_id=$1', [sub.user_id]),
          db.query("SELECT title, progress, status, deadline, category FROM goals WHERE user_id=$1 AND status='active'", [sub.user_id]),
          db.query('SELECT habit_id, value FROM habit_completions WHERE user_id=$1 AND date=$2', [sub.user_id, today]),
          db.query('SELECT habit_id, value, date FROM habit_completions WHERE user_id=$1 AND date>=$2', [sub.user_id, weekAgo]),
        ]);

        // A count habit is done when it reaches its daily target, not at 1.
        const valueToday = {};
        todayR.rows.forEach((l) => { valueToday[l.habit_id] = Number(l.value || 0); });
        const habits = habitsR.rows.map((h) => Object.assign({}, h, {
          done: (valueToday[h.id] || 0) >= (h.target_type === 'count' ? (h.daily_target || 1) : 1)
        }));
        const weeklyHabits = buildWeeklyRates(habitsR.rows, weekR.rows);

        const doneCount = habits.filter((h) => h.done).length;
        const pct = habits.length ? Math.round(doneCount / habits.length * 100) : 0;
        if (nudgeType === 'danger' && pct > 0) { results.skipped++; continue; }
        if (nudgeType === 'midday' && pct >= 50) { results.skipped++; continue; }

        const payload = engine.buildNudge(
          nudgeType,
          { name: sub.name, streak: sub.streak },
          sub.onboarding_data || {},
          habits,
          goalsR.rows,
          weeklyHabits
        );
        if (!payload) { results.skipped++; continue; }
        payload.url = '/';

        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload));
        results.sent++;
      } catch (err) {
        // 404/410: the browser dropped this subscription — forget it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.query('DELETE FROM web_push_subscriptions WHERE endpoint=$1', [sub.endpoint]).catch(() => {});
        }
        results.failed++;
        console.error('[MELTOS] Push failed user ' + sub.user_id + ': ' + err.message);
      }
    }

    console.log('[MELTOS] Nudge done: ' + JSON.stringify(results));
    return results;
  }

  function startSchedule() {
    for (const s of SCHEDULE) {
      cron.schedule(s.cron, () => {
        sendNudgesForType(s.nudgeType).catch((e) => console.error('[MELTOS] Nudge run failed:', e.message));
      }, { timezone: TZ });
    }
    console.log('[MELTOS] Nudge schedule active (New York time): 08:00 morning, 13:00 midday, 20:00 evening, 21:00 streak danger');
  }

  return { router, migrate, startSchedule, sendNudgesForType };
}

function buildWeeklyRates(habits, weekLogs) {
  return habits.map((habit) => {
    const target = habit.target_type === 'count' ? (habit.daily_target || 1) : 1;
    const completed = weekLogs.filter((l) => l.habit_id === habit.id && Number(l.value || 0) >= target).length;
    return Object.assign({}, habit, { completedDays: completed, totalDays: 7, rate: Math.round((completed / 7) * 100) });
  });
}

module.exports = createPush;
