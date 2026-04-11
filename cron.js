const cron = require('node-cron');
const fetch = require('node-fetch');

const API = 'https://luhv.onrender.com';
const SECRET = process.env.CRON_SECRET;

async function fireNudge(nudgeType) {
  console.log('[Luhv+ Cron] Firing ' + nudgeType + ' — ' + new Date().toISOString());
  try {
    const res = await fetch(API + '/push/send-nudge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': SECRET
      },
      body: JSON.stringify({ nudgeType: nudgeType })
    });
    const result = await res.json();
    console.log('[Luhv+ Cron] result: ' + JSON.stringify(result));
  } catch (err) {
    console.error('[Luhv+ Cron] error: ' + err.message);
  }
}

cron.schedule('0 6 * * *', function() { fireNudge('morning'); });
cron.schedule('0 11 * * *', function() { fireNudge('midday'); });
cron.schedule('0 18 * * *', function() { fireNudge('evening'); });
cron.schedule('0 19 * * *', function() { fireNudge('danger'); });

console.log('[Luhv+ Cron] Scheduler active');
console.log('  08:00 -> morning');
console.log('  13:00 -> midday');
console.log('  20:00 -> evening');
console.log('  21:00 -> streak danger');
