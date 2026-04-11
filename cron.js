// ============================================================
// LUHV+ — Cron Scheduler
// Fires 4 nudge types daily at the right times
// ============================================================
const cron  = require('node-cron');
const fetch = require('node-fetch');

const API    = 'https://luhv.onrender.com';
const SECRET = process.env.CRON_SECRET;

async function fireNudge(nudgeType) {
  console.log(`[Luhv+ Cron] Firing "${nudgeType}" — ${new Date().toISOString()}`);
  try {
    const res = await fetch(`${API}/push/send-nudge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': SECRET,
      },
      body: JSON.stringify({ nudgeType }),
    });
    const result = await res.json();
    console.log(`[Luhv+ Cron] "${nudgeType}" result:`, JSON.stringify(result));
  } catch (err) {
    console.error(`[Luhv+ Cron] "${nudgeType}" error:`, err.message);
  }
}

// 08:00 AM Spain (UTC+2 summer = 06:00 UTC)
cron.schedule('0 6 * * *', () => fireNudge('morning'));

// 01:00 PM Spain (11:00 UTC)
cron.schedule('0 11 * * *', () => fireNudge('midday'));

// 08:00 PM Spain (18:00 UTC) — peak hour nudge
cron.schedule('0 18 * * *', () => fireNudge('evening'));

// 09:00 PM Spain (19:00 UTC) — streak danger rescue
cron.schedule('0 19 * * *', () => fireNudge('danger'));

console.log('[Luhv+ Cron] Scheduler active ✅');
console.log('  08:00 → morning');
console.log('  13:00 → midday');
console.log('  20:00 → evening');
console.log('  21:00 → streak danger');
```

Luego también asegúrate de que tienes en tu repo los otros 2 archivos nuevos que faltan:
```
luhv-plus-backend/
├── server.js          ✅ exists
├── cron.js            ← CREATE THIS NOW
├── package.json       ✅ fixed
└── routes/
    ├── push.js        ← also needed (from previous steps)
    └── nudge-engine.js ← also needed (from previous steps)
