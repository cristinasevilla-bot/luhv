function categorizeHabits(habits) {
  var pending = habits.filter(function(h) { return !h.done; });
  var done = habits.filter(function(h) { return h.done; });
  function isHealth(h) { return /water|workout|soda|yoga|sleep|wake|gym|run|exercise/i.test(h.name); }
  function isBusiness(h) { return /outreach|prospect|client|linkedin|email|social|post|pipeline|follow|referral|sales|lead/i.test(h.name); }
  function isDating(h) { return /date|dating|swipe|browse|app|conversation|profile/i.test(h.name); }
  return {
    pending: { health: pending.filter(isHealth), business: pending.filter(isBusiness), dating: pending.filter(isDating), all: pending },
    done: { health: done.filter(isHealth), business: done.filter(isBusiness), dating: done.filter(isDating), all: done },
    total: habits.length,
    doneCount: done.length,
    pct: habits.length > 0 ? Math.round((done.length / habits.length) * 100) : 0
  };
}

function getMostUrgentGoal(goals) {
  if (!goals || !goals.length) return null;
  var active = goals.filter(function(g) { return g.status === 'active' && g.progress < 100; });
  if (!active.length) return null;
  return active.map(function(g) {
    var progressScore = 100 - (g.progress || 0);
    var days = g.deadline ? Math.max(0, (new Date(g.deadline) - Date.now()) / 86400000) : 999;
    var deadlineScore = days < 30 ? 50 : days < 90 ? 20 : 0;
    return Object.assign({}, g, { urgencyScore: progressScore + deadlineScore, daysLeft: Math.round(days) });
  }).sort(function(a, b) { return b.urgencyScore - a.urgencyScore; })[0];
}

function getWeakestHabit(weeklyHabits) {
  if (!weeklyHabits || !weeklyHabits.length) return null;
  var weak = weeklyHabits.filter(function(h) { return h.rate < 50; });
  return weak.length ? weak.sort(function(a, b) { return a.rate - b.rate; })[0] : null;
}

function cap(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function pickRandom(arr) {
  var valid = arr.filter(Boolean);
  return valid[Math.floor(Math.random() * valid.length)];
}

function buildMorningNudge(user, onboarding, habits, goals) {
  var name = cap(user.name) || 'Hey';
  var streak = user.streak || 0;
  var urgentGoal = getMostUrgentGoal(goals);
  var goal90 = (onboarding && onboarding.goal_90days) || '';
  var growthStyle = (onboarding && onboarding.growth_style) || '';
  var cats = categorizeHabits(habits);
  var options = [];
  if (urgentGoal && urgentGoal.daysLeft <= 90) {
    options.push({ title: 'Good morning, ' + name, body: urgentGoal.daysLeft + ' days left to "' + urgentGoal.title + '" at ' + urgentGoal.progress + '%. Today\'s ' + cats.total + ' habits move that number.', tag: 'luhv-morning', nudgeType: 'morning-goal-deadline' });
  }
  if (growthStyle && growthStyle.toLowerCase().indexOf('action') !== -1) {
    options.push({ title: name + ' — today\'s window is open', body: cats.total + ' habits on your list. You move fast — the first one takes 2 minutes. Start now.', tag: 'luhv-morning', nudgeType: 'morning-action-style' });
  }
  if (cats.pending.dating.length > 0 && goal90) {
    options.push({ title: 'Morning, ' + name, body: 'Your 90-day goal: "' + goal90 + '". Tonight is your peak hour — set yourself up now.', tag: 'luhv-morning', nudgeType: 'morning-dating-goal' });
  }
  if (streak >= 3) {
    options.push({ title: streak + '-day streak, ' + name, body: 'You\'ve shown up ' + streak + ' days straight. Today makes it ' + (streak + 1) + '. ' + cats.total + ' habits waiting.', tag: 'luhv-morning', nudgeType: 'morning-streak' });
  }
  options.push({ title: 'New day, ' + name, body: cats.total + ' habits. 1 day. Everything you do today compounds.', tag: 'luhv-morning', nudgeType: 'morning-generic' });
  return pickRandom(options);
}

function buildMiddayNudge(user, onboarding, habits, goals, weeklyHabits) {
  var name = cap(user.name) || 'Hey';
  var cats = categorizeHabits(habits);
  var pct = cats.pct;
  if (pct >= 50) return null;
  var urgentGoal = getMostUrgentGoal(goals);
  var weakest = getWeakestHabit(weeklyHabits || []);
  var options = [];
  if (weakest) {
    options.push({ title: 'Midday check-in, ' + name, body: 'You\'re at ' + pct + '% today. "' + weakest.name + '" is only at ' + weakest.rate + '% this week — fix that pattern this afternoon.', tag: 'luhv-midday', nudgeType: 'midday-weak-habit' });
  }
  if (cats.pending.business.length > 0) {
    options.push({ title: 'Halfway through the day, ' + name, body: cats.pending.business.length + ' business tasks still open. Afternoons are great for outreach.', tag: 'luhv-midday', nudgeType: 'midday-business' });
  }
  if (cats.done.health.length === 0 && cats.pending.health.length > 0) {
    options.push({ title: name + ' — body check', body: 'No health habits done yet. Start with ' + cats.pending.health[0].icon + ' "' + cats.pending.health[0].name + '".', tag: 'luhv-midday', nudgeType: 'midday-health-zero' });
  }
  if (urgentGoal) {
    options.push({ title: 'Midday, ' + name, body: '"' + urgentGoal.title + '" is at ' + urgentGoal.progress + '%. You\'re at ' + pct + '% today. The afternoon is yours.', tag: 'luhv-midday', nudgeType: 'midday-goal' });
  }
  options.push({ title: 'Midday check-in', body: pct + '% done so far. ' + cats.pending.all.length + ' habits left — your peak hour kicks in at 5pm.', tag: 'luhv-midday', nudgeType: 'midday-generic' });
  return pickRandom(options);
}

function buildEveningNudge(user, onboarding, habits, goals) {
  var name = cap(user.name) || 'Hey';
  var streak = user.streak || 0;
  var cats = categorizeHabits(habits);
  var pct = cats.pct;
  var urgentGoal = getMostUrgentGoal(goals);
  var goal90 = (onboarding && onboarding.goal_90days) || '';
  var growthStyle = (onboarding && onboarding.growth_style) || '';
  var obstacle = (onboarding && onboarding.obstacle) || '';

  if (pct === 0) {
    var opts = [];
    if (goal90) opts.push({ title: name + ' — your goal is waiting', body: '"' + goal90 + '" won\'t happen on its own. Start with 1 habit now.', tag: 'luhv-evening', nudgeType: 'evening-cold-goal' });
    if (obstacle) opts.push({ title: name + ', don\'t let ' + obstacle.toLowerCase() + ' win today', body: 'Breaking it starts with one small action right now.', tag: 'luhv-evening', nudgeType: 'evening-cold-obstacle' });
    if (cats.pending.dating.length > 0) opts.push({ title: name + ' — this is your peak hour', body: cats.pending.dating.length + ' dating habit(s) pending. Evening energy is your thing — use it.', tag: 'luhv-evening', nudgeType: 'evening-cold-dating' });
    if (streak > 0 && cats.pending.all.length > 0) opts.push({ title: streak + '-day streak — don\'t break it tonight', body: 'Start with ' + cats.pending.all[0].icon + ' "' + cats.pending.all[0].name + '" — it takes 2 minutes.', tag: 'luhv-evening', nudgeType: 'evening-cold-streak' });
    opts.push({ title: name + ' — the day is still yours', body: cats.pending.all.length + ' habits left. Do the first one right now.', tag: 'luhv-evening', nudgeType: 'evening-cold-generic' });
    return pickRandom(opts);
  }

  if (pct <= 40) {
    var businessGoal = goals && goals.find(function(g) { return /client|prospect|business|sales|revenue|monthly/i.test(g.title); });
    if (cats.pending.business.length > 0 && businessGoal) {
      return { title: '"' + businessGoal.title + '" is at ' + businessGoal.progress + '%', body: cats.pending.business.length + ' business task(s) left tonight. Every outreach moves that number.', tag: 'luhv-evening', nudgeType: 'evening-low-business' };
    }
    var datingGoal = goals && goals.find(function(g) { return /date|dating|relationship|guy|girl|love/i.test(g.title); });
    if (cats.pending.dating.length > 0) {
      return { title: name + ' — love takes action', body: datingGoal ? '"' + datingGoal.title + '" is at ' + datingGoal.progress + '%. "' + cats.pending.dating[0].name + '" gets you closer.' : cats.pending.dating.length + ' dating habit(s) pending. Tonight is a great night.', tag: 'luhv-evening', nudgeType: 'evening-low-dating' };
    }
    return { title: name + ' — ' + pct + '% done, keep pushing', body: urgentGoal ? '"' + urgentGoal.title + '" at ' + urgentGoal.progress + '%. Every habit tonight moves the needle.' : cats.done.all.length + ' done, ' + cats.pending.all.length + ' to go. Your peak hour is now.', tag: 'luhv-evening', nudgeType: 'evening-low-generic' };
  }

  if (pct <= 75) {
    if (cats.pending.health.length > 0 && streak >= 3) {
      var h = cats.pending.health[0];
      return { title: streak + '-day streak — finish it strong', body: 'Just ' + h.icon + ' "' + h.name + '" left on health. 5 minutes and the day is locked in.', tag: 'luhv-evening', nudgeType: 'evening-mid-health-streak' };
    }
    if (growthStyle && growthStyle.toLowerCase().indexOf('action') !== -1 && cats.pending.all.length > 0) {
      var next = cats.pending.all[0];
      return { title: name + ' — fast action, real results', body: 'Next up: ' + next.icon + ' "' + next.name + '". Do it before the night gets away.', tag: 'luhv-evening', nudgeType: 'evening-mid-action' };
    }
    return { title: name + ' — ' + pct + '% done, almost there', body: urgentGoal ? 'Building toward "' + urgentGoal.title + '" (' + urgentGoal.progress + '%). Last ' + cats.pending.all.length + ' habits close the gap.' : cats.done.all.length + ' of ' + cats.total + ' done. Final push.', tag: 'luhv-evening', nudgeType: 'evening-mid-generic' };
  }

  if (pct < 100 && cats.pending.all.length > 0) {
    var last = cats.pending.all[0];
    var highOpts = [];
    highOpts.push({ title: name + ' — 1 left. Close it out.', body: last.icon + ' "' + last.name + '" is all that stands between you and a perfect day.', tag: 'luhv-evening', nudgeType: 'evening-high-last' });
    if (urgentGoal) highOpts.push({ title: 'Today counts toward "' + urgentGoal.title + '"', body: 'At ' + urgentGoal.progress + '% on your goal. Finish today and keep that ' + streak + '-day streak alive.', tag: 'luhv-evening', nudgeType: 'evening-high-goal' });
    return pickRandom(highOpts);
  }

  return { title: name + ' — perfect day', body: streak > 0 ? (streak + 1) + '-day streak. You are building the version of yourself you have always wanted.' : 'Every habit done. This is what separates people who say from people who do.', tag: 'luhv-complete', nudgeType: 'evening-complete' };
}

function buildStreakDangerNudge(user, onboarding, habits, goals) {
  var name = cap(user.name) || 'Hey';
  var streak = user.streak || 0;
  var cats = categorizeHabits(habits);
  if (cats.pct > 0 || streak === 0) return null;
  var urgentGoal = getMostUrgentGoal(goals);
  var goal90 = (onboarding && onboarding.goal_90days) || '';
  var easiest = cats.pending.all.length > 0 ? cats.pending.all[cats.pending.all.length - 1] : null;
  var opts = [];
  opts.push({ title: name + ' — your ' + streak + '-day streak ends in 1 hour', body: 'Just 1 habit saves it. ' + (easiest ? easiest.icon + ' "' + easiest.name + '"' : 'Pick one') + ' — do it right now.', tag: 'luhv-danger', nudgeType: 'danger-streak-rescue' });
  if (urgentGoal) opts.push({ title: streak + ' days at risk, ' + name, body: '"' + urgentGoal.title + '" needs you consistent. 1 habit right now keeps the chain alive.', tag: 'luhv-danger', nudgeType: 'danger-streak-goal' });
  if (goal90) opts.push({ title: 'Last call, ' + name, body: 'You are working toward "' + goal90 + '". Save your streak with 1 check right now.', tag: 'luhv-danger', nudgeType: 'danger-streak-90goal' });
  return pickRandom(opts);
}

function buildNudge(nudgeType, user, onboarding, habits, goals, weeklyHabits) {
  if (nudgeType === 'morning') return buildMorningNudge(user, onboarding, habits, goals);
  if (nudgeType === 'midday')  return buildMiddayNudge(user, onboarding, habits, goals, weeklyHabits || []);
  if (nudgeType === 'evening') return buildEveningNudge(user, onboarding, habits, goals);
  if (nudgeType === 'danger')  return buildStreakDangerNudge(user, onboarding, habits, goals);
  return buildEveningNudge(user, onboarding, habits, goals);
}

module.exports = { buildNudge, categorizeHabits, getMostUrgentGoal };
