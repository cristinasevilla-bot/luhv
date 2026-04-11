const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { Pool }  = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const stripe = null;
const STRIPE_WEBHOOK_SECRET = null;

const TIERS = {
  basic: { name: 'Basic', price_id: process.env.STRIPE_PRICE_BASIC, monthly_tokens: 0, coach_access: false },
  pro:   { name: 'Pro',   price_id: process.env.STRIPE_PRICE_PRO,   monthly_tokens: 400000, coach_access: true }
};

const TOKEN_PACKS = [
  { id: 'pack_5',  price_usd: 5,  credits_usd: 4,  tokens: 500000,  stripe_price: process.env.STRIPE_PRICE_PACK5  },
  { id: 'pack_10', price_usd: 10, credits_usd: 8,  tokens: 1000000, stripe_price: process.env.STRIPE_PRICE_PACK10 },
  { id: 'pack_20', price_usd: 20, credits_usd: 17, tokens: 2000000, stripe_price: process.env.STRIPE_PRICE_PACK20 },
  { id: 'pack_50', price_usd: 50, credits_usd: 44, tokens: 5000000, stripe_price: process.env.STRIPE_PRICE_PACK50 },
];

const app  = express();
const PORT = process.env.PORT || 3001;

app.get('/health', (req, res) => res.status(200).json({ ok: true }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const pushRouter = require('./routes/push');
app.use('/push', pushRouter);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

const KNOWLEDGE_BASE = `
=== MELTOS BY LUHV+ KNOWLEDGE BASE ===

--- CORE PHILOSOPHY ---
Business is a Sport — treat it with the discipline, strategy, and team mentality of an elite athlete.
"Master your mind, elevate your life, simplify success." — Shon Cru-May
Blueprint: Renovate -> Innovate -> Collaborate -> Repeat
  - Renovate: Take what already exists and add value to it.
  - Innovate: Add your own signature, twist, spin.
  - Collaborate: Work with others already aligned with your goal.
"The way you do one thing in life is the way you do everything in life."
"Life never goes according to plan — it goes according to vision."
Good is no longer good enough — the shift from good to great starts in the mind.

--- MINDSET ---
Fixed mindset: believes life is unchangeable, avoids risk and challenge.
Growth mindset: sees failure as feedback, weakness as something to overcome.
Key practice: catch negative self-talk and rewrite it.
Add the word "yet" to limitations: "I'm not good at this yet."

--- CONFIDENCE & INTENTIONALITY ---
Confidence is a skill — it can be built through daily practice.
Intentionality: small, conscious daily decisions about what enhances your life.
FOCUS = Fulfilling Obligations Consistently Until Successful.

--- ALIGNMENT ---
Alignment: when thoughts, feelings, behaviors, and actions work in harmony.
Authentic alignment: own your strengths AND weaknesses; never deny who you are.

--- BECOMING MORE EFFECTIVE IN LESS TIME ---
Ask yourself: What are my intentions? Where is my time being spent? How can I be more efficient?
The Renovate/Innovate/Collaborate method: use what's at your disposal, add value, put your signature on it, then multiply through others.

--- FOUR MONETIZATION LENSES ---
Paid to Speak: monetize ideas through your voice. Events, podcasts, keynotes. $1k-$50k+.
Paid to Think: monetize ideas as strategy/IP. Strategy Days, Mastermind, Licensing. $4k-$25k+.
Paid to Organize: monetize ideas as systems. SOPs, Notion/ClickUp builds, Fractional COO. $29-$15k.
Paid to Do: productized execution on subscription. Unlimited queue, credits pack. $499-$5k/mo.

--- GETTING UNSTUCK ---
Procrastination = emotion regulation problem, not time management.
Power Hours: work without distraction for 1 hour, short break, repeat.
"What can I get done in 5 minutes that moves me forward?" — set timer, you'll keep going.

--- VISION ---
Write a personal vision statement covering: health, family, relationships, finance, spirituality, habits.
Vision = the navigation system when detours happen.
Commitment + Consistency = Success.

--- KEY MELTOS PHRASES ---
"You are the MVP in your life."
"You're the cream of the crop."
"Let's get this TRIUMPH"
"I don't remember a version of you that quit and I never will."
"That's MELTOS energy right there"
"Step into your next level."
"No more waiting — it's YOUR time."
"Lock in. Show up. Win."
"Let's build leaders — not followers."
`;

const SESSION_PHASES = [
  {
    id: 'mindset_checkin',
    name: 'Mindset Check-In',
    steps: [
      { key: 'welcome', coachPrompt: (name) => `Welcome ${name}! I'm your MELTOS AI Coach and I'm genuinely excited you're here. This is YOUR space to grow, get clear, and step into the next level of who you're becoming. Before we dive in, I want to ask you something real: On a scale of 1-10, where is your mindset RIGHT NOW — and what's one word that describes how you're feeling today?`, processKey: 'mindset_score' },
      { key: 'fixed_vs_growth', coachPrompt: (name, prev) => `I hear you ${prev.mindset_score}. That's real, and I respect it. Now let me ask you this: When something doesn't go your way — a goal you missed, a plan that fell apart — what's your first instinct? Do you tend to think "I'm just not built for this"... or "What can I learn from this?" Be honest.`, processKey: 'mindset_type' },
      { key: 'self_talk', coachPrompt: (name, prev) => `Good. Awareness is step one always. Here's what I know: the story you tell yourself when things get hard is EVERYTHING. What's one negative thing you say to yourself on repeat? The one that shows up most when you're stuck or doubting. Let's name it so we can rewrite it.`, processKey: 'negative_self_talk' },
      { key: 'reframe', coachPrompt: (name, prev) => `"${prev.negative_self_talk}" — okay, we're putting that on notice right now. That narrative doesn't get to run the show anymore. Here's your assignment: flip it. How would the MVP version of you reframe that exact thought? What does the GROWTH version of that belief sound like?`, processKey: 'reframe' }
    ]
  },
  {
    id: 'alignment_audit',
    name: 'Alignment Audit',
    steps: [
      { key: 'gift_discovery', coachPrompt: (name, prev) => `${name}, you just did something most people never do — you looked your own mind in the face and chose growth. Now let's go deeper. I want to find your gift — the thing you do that feels effortless to YOU but is transformative to others. What do people always come to you for? What do you do that makes time disappear?`, processKey: 'gift' },
      { key: 'transformation_sentence', coachPrompt: (name, prev) => `"${prev.gift}" — that's gold. Now let's turn that into a power statement. Complete this sentence: "I help _____ do/achieve/feel _____ so they can _____." Don't overthink it — just let it flow. This becomes your guiding mantra.`, processKey: 'transformation_statement' },
      { key: 'alignment_check', coachPrompt: (name, prev) => `"${prev.transformation_statement}" — write that somewhere you'll see it every single day. Now tell me: is what you're doing RIGHT NOW in your career or business actually aligned with that gift? Are you living it — or is it still waiting to be activated?`, processKey: 'alignment_gap' }
    ]
  },
  {
    id: 'lens_selection',
    name: 'Monetization Lens',
    steps: [
      { key: 'energy_check', coachPrompt: (name, prev) => `Here's where it gets exciting, ${name}. Your gift is real. Now let's talk about how you GET PAID for it. Which feels most natural to you? (A) Speaking on stage or podcast, (B) Consulting 1-on-1 as a strategist, (C) Building systems and organizing chaos, (D) Executing and delivering results for clients.`, processKey: 'lens_preference' },
      { key: 'lens_confirm', coachPrompt: (name, prev) => `Based on what you said — "${prev.lens_preference}" — your primary lens is showing up. But let me ask this: what kind of work drains you? What's the thing you could do but absolutely hate doing? Knowing what to say NO to is just as powerful as knowing your yes.`, processKey: 'energy_drain' },
      { key: 'first_offer', coachPrompt: (name, prev) => `Perfect. You're getting clear. Now — if you had to launch something in the next 72 hours, what would it be? Don't think about price yet. Just: what's the ONE thing you could offer right now that would genuinely help someone?`, processKey: 'first_offer' }
    ]
  },
  {
    id: 'mvp_commitment',
    name: 'MVP Commitment',
    steps: [
      { key: 'vision', coachPrompt: (name, prev) => `${name}, we've gone deep today — and I want you to feel that. You've named your mindset, found your gift, and started seeing how it turns into income. Now picture this: it's 12 months from now. You went all in. What does your life look like? What changed? Tell me what you see.`, processKey: 'vision_12months' },
      { key: 'one_action', coachPrompt: (name, prev) => `"${prev.vision_12months}" — THAT is why we do this work. That version of you already exists — you just have to become them. So here's your MVP challenge: What is ONE action you will take in the next 24 hours that the future version of you would be proud of? Not a list. ONE thing. Make it specific.`, processKey: 'next_action' },
      { key: 'close', coachPrompt: (name, prev) => `"${prev.next_action}" — lock it in. Screenshot this. Tell someone. Do it. ${name}, you are the MVP in your life and today you proved it. I don't remember a version of you that quit — and I never will. Lock in. Show up. Win.`, processKey: 'session_complete' }
    ]
  }
];

const buildCoachSystem = (userContext, sessionContext, mode) => `
You are the MELTOS AI Coach — voice of the MELTOS by Luhv+ performance platform created by Shon Cru-May.

CORE PURPOSE: Clarity and direction. Whatever the user inputs, you provide clarity and direction.

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}

ALIGNMENT CHECK RULES:
When a user asks if a choice is aligned, evaluate against:
1. Their active goals
2. Their transformation statement
3. Their monetization lens
4. The four foundations: body, mind, money, relationships
5. MELTOS principles: Renovate/Innovate/Collaborate, intentionality, growth mindset
Always respond with: ALIGNED / NEEDS ADJUSTMENT / NOT ALIGNED — then explain.

TONE & VOICE:
- Warm, personal, motivational — like a trusted coach who genuinely believes in you.
- High energy but never fake. Real talk mixed with deep encouragement.
- Use emojis naturally (1-2 per message max).
- Short punchy sentences mixed with deeper insight.
- Always end with a challenge, question, or clear next step.
- Keep responses under 5 sentences unless they ask for a detailed plan.
- Never use markdown, asterisks, or bold formatting. Plain text only.

${userContext || ''}
${sessionContext || ''}
${mode === 'intention' ? 'MODE: Daily intention validation. Validate against goals and transformation statement. Be direct.' : ''}
${mode === 'decision' ? 'MODE: Decision alignment check. Use ALIGNMENT CHECK RULES. Be direct and specific.' : ''}
`;

const coachAuth = async (req, res, next) => {
  req.userTier = 'pro';
  req.tokenBalance = 999999;
  next();
};

async function deductTokens(userId, inputTokens, outputTokens) {
  const total = inputTokens + outputTokens;
  await db.query('UPDATE users SET token_balance = GREATEST(0, token_balance - $1) WHERE id=$2', [total, userId]);
}

async function getActiveSession(userId) {
  const { rows } = await db.query(
    'SELECT * FROM coach_sessions WHERE user_id=$1 AND completed=false ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

async function createSession(userId) {
  const { rows } = await db.query(
    "INSERT INTO coach_sessions (user_id, phase, phase_index, responses) VALUES ($1,'mindset_checkin',0,'{}') RETURNING *",
    [userId]
  );
  return rows[0];
}

async function updateSession(sessionId, updates) {
  const { rows } = await db.query(
    'UPDATE coach_sessions SET phase=$2, phase_index=$3, responses=$4, lens=$5, completed=$6, updated_at=NOW() WHERE id=$1 RETURNING *',
    [sessionId, updates.phase, updates.phase_index, JSON.stringify(updates.responses), updates.lens||null, updates.completed||false]
  );
  return rows[0];
}

async function updateUserStreak(userId) {
  const { rows: [user] } = await db.query('SELECT streak, last_streak_date FROM users WHERE id=$1', [userId]);
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];
  const lastDate = user.last_streak_date ? new Date(user.last_streak_date).toISOString().split('T')[0] : null;
  if (lastDate === today) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];
  const newStreak = lastDate === yStr ? (user.streak || 0) + 1 : 1;
  await db.query('UPDATE users SET streak=$1, last_streak_date=$2 WHERE id=$3', [newStreak, today, userId]);
}

// ── SESSION ROUTES ────────────────────────────────────────────────────────────

app.post('/api/coach/session', auth, coachAuth, async (req, res) => {
  try {
    const { message } = req.body;
    const { rows: [user] } = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
    let session = await getActiveSession(req.user.id);

    if (!session) {
      session = await createSession(req.user.id);
      const phase = SESSION_PHASES[0];
      const step  = phase.steps[0];
      return res.json({ question: step.coachPrompt(user.name, {}), phase: phase.id, phaseName: phase.name, step: step.key, progress: 0, isComplete: false, sessionId: session.id });
    }

    const phaseIdx    = SESSION_PHASES.findIndex(p => p.id === session.phase);
    const phase       = SESSION_PHASES[phaseIdx];
    const stepIdx     = session.phase_index;
    const currentStep = phase.steps[stepIdx];
    const responses   = { ...session.responses };
    if (message && currentStep) responses[currentStep.processKey] = message;

    let lens = session.lens;
    if (responses.lens_preference && !lens) {
      const lp = responses.lens_preference.toLowerCase();
      if      (lp.includes('a') || lp.includes('speak') || lp.includes('stage'))   lens = 'Paid to Speak';
      else if (lp.includes('b') || lp.includes('consult') || lp.includes('strateg')) lens = 'Paid to Think';
      else if (lp.includes('c') || lp.includes('system') || lp.includes('organ'))   lens = 'Paid to Organize';
      else if (lp.includes('d') || lp.includes('execut') || lp.includes('deliver')) lens = 'Paid to Do';
    }

    let nextPhaseIdx = phaseIdx;
    let nextStepIdx  = stepIdx + 1;
    let isComplete   = false;

    if (nextStepIdx >= phase.steps.length) { nextPhaseIdx = phaseIdx + 1; nextStepIdx = 0; }
    if (nextPhaseIdx >= SESSION_PHASES.length) isComplete = true;

    const nextPhase = isComplete ? SESSION_PHASES[SESSION_PHASES.length - 1] : SESSION_PHASES[nextPhaseIdx];
    await updateSession(session.id, { phase: isComplete ? session.phase : nextPhase.id, phase_index: nextStepIdx, responses, lens, completed: isComplete });

    if (isComplete) {
      const aiRes = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 600,
        system: buildCoachSystem('USER: ' + user.name + ', Streak: ' + user.streak + ' days'),
        messages: [{ role: 'user', content: 'The user ' + user.name + ' just completed their MELTOS guided coaching session. Their responses: ' + JSON.stringify(responses, null, 2) + '. Their identified lens: ' + (lens || 'not yet determined') + '. Write a powerful 3-4 sentence closing message. Celebrate what they discovered. Remind them of their transformation statement. Challenge them to take the action they committed to. End with "Lock in. Show up. Win."' }]
      });
      return res.json({ question: aiRes.content[0].text, phase: 'complete', phaseName: 'Session Complete', step: 'done', progress: 100, isComplete: true, lens, sessionId: session.id, responses });
    }

    const nextPhaseObj = SESSION_PHASES[nextPhaseIdx];
    const nextStep     = nextPhaseObj.steps[nextStepIdx];
    let question;
    const rawQuestion  = nextStep.coachPrompt(user.name, responses);

    if (nextStepIdx === 0 && nextPhaseIdx > phaseIdx) {
      const aiRes = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 400,
        system: buildCoachSystem('USER: ' + user.name),
        messages: [{ role: 'user', content: 'The user ' + user.name + ' just finished the "' + phase.name + '" phase. Their key answers: ' + JSON.stringify(responses, null, 2) + '. Now smoothly transition into the "' + nextPhaseObj.name + '" phase by first acknowledging what they shared, then asking this next question naturally: "' + rawQuestion + '". Keep it warm, under 5 sentences, MELTOS voice.' }]
      });
      question = aiRes.content[0].text;
    } else {
      question = rawQuestion;
    }

    const totalSteps    = SESSION_PHASES.reduce((acc, p) => acc + p.steps.length, 0);
    const completedSteps = SESSION_PHASES.slice(0, nextPhaseIdx).reduce((acc, p) => acc + p.steps.length, 0) + nextStepIdx;
    const progress = Math.round((completedSteps / totalSteps) * 100);

    if (message) {
      await db.query('INSERT INTO conversations (user_id, role, content) VALUES ($1,$2,$3), ($1,$4,$5)', [req.user.id, 'user', message, 'assistant', question]);
    }

    res.json({ question, phase: nextPhaseObj.id, phaseName: nextPhaseObj.name, step: nextStep.key, progress, isComplete: false, lens, sessionId: session.id });
  } catch (e) {
    console.error('Session error:', e);
    res.status(500).json({ error: 'Session temporarily unavailable' });
  }
});

app.get('/api/coach/session', auth, async (req, res) => {
  try {
    const session = await getActiveSession(req.user.id);
    if (!session) return res.json({ hasActiveSession: false });
    const phaseObj   = SESSION_PHASES.find(p => p.id === session.phase);
    const totalSteps = SESSION_PHASES.reduce((acc, p) => acc + p.steps.length, 0);
    const phaseIdx   = SESSION_PHASES.findIndex(p => p.id === session.phase);
    const completedSteps = SESSION_PHASES.slice(0, phaseIdx).reduce((acc, p) => acc + p.steps.length, 0) + session.phase_index;
    res.json({ hasActiveSession: true, sessionId: session.id, phase: session.phase, phaseName: phaseObj?.name, progress: Math.round((completedSteps / totalSteps) * 100), lens: session.lens, responses: session.responses });
  } catch (e) { res.status(500).json({ error: 'Could not fetch session' }); }
});

app.post('/api/coach/session/reset', auth, coachAuth, async (req, res) => {
  try {
    await db.query('UPDATE coach_sessions SET completed=true WHERE user_id=$1 AND completed=false', [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Could not reset session' }); }
});

// ── FREE CHAT ─────────────────────────────────────────────────────────────────

app.post('/api/coach/chat', auth, coachAuth, async (req, res) => {
  const { message, history = [] } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const { rows: [user] }  = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
  const { rows: goals }   = await db.query("SELECT title, progress, target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
  const { rows: habits }  = await db.query(
    `SELECT h.name, h.target_type, h.daily_target,
      CASE WHEN h.target_type='check' THEN (hc.id IS NOT NULL)
           ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done_today,
      COALESCE(hc.value,0) as today_value
     FROM habits h LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2
     WHERE h.user_id=$1 ORDER BY h.created_at`,
    [req.user.id, today]
  );
  const { rows: [latest] } = await db.query('SELECT content FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);
  const session = await getActiveSession(req.user.id);

  const doneTasks  = habits.filter(h => h.done_today).length;
  const totalTasks = habits.length;
  const habitsSummary = habits.length > 0
    ? habits.map(h => h.name + ' [' + (h.done_today ? 'done' : h.target_type === 'count' ? h.today_value + '/' + h.daily_target : 'pending') + ']').join(', ')
    : 'no tasks set yet';

  const userContext = `
USER CONTEXT:
- Name: ${user.name}
- Current streak: ${user.streak} days
- Active goals: ${goals.map(g => g.title.replace(/^\[.*?\]\s*/,'') + ' (' + Math.round((g.progress/g.target)*100) + '%)').join(', ') || 'none yet'}
- Today tasks (${doneTasks}/${totalTasks} done): ${habitsSummary}
- Latest journal: "${latest?.content?.slice(0,120) || 'No entries yet'}"
`;
  const sessionContext = session ? `
COACHING SESSION CONTEXT:
- Current phase: ${session.phase}
- Identified lens: ${session.lens || 'not yet determined'}
- Key responses: ${JSON.stringify(session.responses).slice(0,400)}
` : '';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1200,
      system: buildCoachSystem(userContext, sessionContext, 'chat') + '\n\nIMPORTANT: End every response with ONE specific follow-up question based on what was just discussed.',
      messages: [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: message }]
    });
    const reply = response.content[0].text;
    await db.query('INSERT INTO conversations (user_id, role, content) VALUES ($1,$2,$3), ($1,$4,$5)', [req.user.id, 'user', message, 'assistant', reply]);
    const usage = response.usage;
    await deductTokens(req.user.id, usage.input_tokens, usage.output_tokens);
    const { rows: [updated] } = await db.query('SELECT token_balance FROM users WHERE id=$1', [req.user.id]);
    res.json({ reply, token_balance: updated.token_balance });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Coach is temporarily unavailable' });
  }
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await db.query('INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email', [name, email, hash]);
    res.json({ token: sign({ id: rows[0].id }), user: rows[0] });
  } catch (e) { res.status(400).json({ error: 'Email already in use' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash)))
    return res.status(401).json({ error: 'Invalid credentials' });
  const { password_hash, ...user } = rows[0];
  res.json({ token: sign({ id: user.id }), user });
});

// ── QUOTES ────────────────────────────────────────────────────────────────────

app.get('/api/quotes', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM quotes ORDER BY created_at DESC');
  res.json(rows);
});

app.get('/api/quotes/today', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM quotes ORDER BY id');
  const idx = Math.floor(Date.now() / 86400000) % rows.length;
  res.json(rows[idx] || null);
});

app.post('/api/quotes', auth, async (req, res) => {
  const { text, author } = req.body;
  const { rows } = await db.query('INSERT INTO quotes (text,author) VALUES ($1,$2) RETURNING *', [text, author]);
  res.json(rows[0]);
});

app.delete('/api/quotes/:id', auth, async (req, res) => {
  await db.query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── HABITS ────────────────────────────────────────────────────────────────────

app.get('/api/habits', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await db.query(
    `SELECT h.*, COALESCE(hc.value,0) as today_value,
      CASE WHEN h.target_type='check' THEN (hc.id IS NOT NULL)
           ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done
     FROM habits h LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2
     WHERE h.user_id=$1 ORDER BY h.created_at`,
    [req.user.id, today]
  );
  res.json(rows);
});

app.post('/api/habits', auth, async (req, res) => {
  const { name, time, icon, target_type, daily_target } = req.body;
  const { rows } = await db.query(
    'INSERT INTO habits (user_id,name,time,icon,target_type,daily_target) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.user.id, name, time||null, icon||'x', target_type||'check', daily_target||1]
  );
  res.json(rows[0]);
});

app.patch('/api/habits/:id/check', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows: [habit] } = await db.query('SELECT * FROM habits WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!habit) return res.status(404).json({ error: 'Habit not found' });
  const { rows: [existing] } = await db.query('SELECT id,value FROM habit_completions WHERE habit_id=$1 AND user_id=$2 AND date=$3', [req.params.id, req.user.id, today]);

  if (habit.target_type === 'check') {
    if (existing) {
      await db.query('DELETE FROM habit_completions WHERE id=$1', [existing.id]);
      res.json({ done: false, value: 0, target: 1 });
    } else {
      await db.query('INSERT INTO habit_completions (habit_id,user_id,date,value) VALUES ($1,$2,$3,1)', [req.params.id, req.user.id, today]);
      await updateUserStreak(req.user.id);
      res.json({ done: true, value: 1, target: 1 });
    }
  } else {
    const currentValue = existing ? existing.value : 0;
    const newValue = Math.min(currentValue + 1, habit.daily_target);
    if (existing) {
      await db.query('UPDATE habit_completions SET value=$1 WHERE id=$2', [newValue, existing.id]);
    } else {
      await db.query('INSERT INTO habit_completions (habit_id,user_id,date,value) VALUES ($1,$2,$3,$4)', [req.params.id, req.user.id, today, newValue]);
    }
    const done = newValue >= habit.daily_target;
    if (done && !existing) await updateUserStreak(req.user.id);
    res.json({ done, value: newValue, target: habit.daily_target });
  }
});

app.patch('/api/habits/:id/reset', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  await db.query('DELETE FROM habit_completions WHERE habit_id=$1 AND user_id=$2 AND date=$3', [req.params.id, req.user.id, today]);
  res.json({ done: false, value: 0 });
});

app.delete('/api/habits/:id', auth, async (req, res) => {
  await db.query('DELETE FROM habit_completions WHERE habit_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  await db.query('DELETE FROM habits WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

app.patch('/api/habits/:id/name', auth, async (req, res) => {
  const { name, icon, time } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const { rows } = await db.query('UPDATE habits SET name=$1,icon=$2,time=$3 WHERE id=$4 AND user_id=$5 RETURNING *', [name.trim(), icon||'x', time||null, req.params.id, req.user.id]);
  res.json(rows[0] || null);
});

// ── GOALS ─────────────────────────────────────────────────────────────────────

app.get('/api/goals', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM goals WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json(rows);
});

app.post('/api/goals', auth, async (req, res) => {
  const { title, deadline, target, unit } = req.body;
  const { rows } = await db.query('INSERT INTO goals (user_id,title,deadline,target,unit) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.id, title, deadline, target, unit]);
  res.json(rows[0]);
});

app.patch('/api/goals/:id/progress', auth, async (req, res) => {
  const { progress } = req.body;
  const { rows } = await db.query('UPDATE goals SET progress=$1 WHERE id=$2 AND user_id=$3 RETURNING *', [progress, req.params.id, req.user.id]);
  res.json(rows[0]);
});

app.patch('/api/goals/:id/title', auth, async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const { rows } = await db.query('UPDATE goals SET title=$1 WHERE id=$2 AND user_id=$3 RETURNING *', [title.trim(), req.params.id, req.user.id]);
  res.json(rows[0] || null);
});

app.delete('/api/goals/:id', auth, async (req, res) => {
  await db.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ── JOURNAL ───────────────────────────────────────────────────────────────────

app.get('/api/journal', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
  res.json(rows);
});

app.post('/api/journal', auth, async (req, res) => {
  const { title, content, mood, energy_level } = req.body;
  const { rows } = await db.query('INSERT INTO journal_entries (user_id,title,content,mood,energy_level) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.id, title, content, mood, energy_level||null]);
  res.json(rows[0]);
});

app.get('/api/journal/prompt', auth, async (req, res) => {
  const prompts = [
    "What's one belief that's been holding you back, and how can you start rewriting it today?",
    "Describe your ideal life 5 years from now in vivid detail.",
    "What would you do today if you knew you couldn't fail?",
    "List 3 wins from this week, no matter how small.",
    "Who do you need to become to achieve your biggest goal?",
    "What's one habit the MVP version of you does every single day?",
    "Where are you playing small — and what would it look like to go all in?",
  ];
  const idx = Math.floor(Date.now() / 86400000) % prompts.length;
  res.json({ prompt: prompts[idx] });
});

// ── ENERGY ────────────────────────────────────────────────────────────────────

app.post('/api/energy', auth, async (req, res) => {
  const { level, note } = req.body;
  if (!level || level < 1 || level > 5) return res.status(400).json({ error: 'Level must be 1-5' });
  const { rows } = await db.query('INSERT INTO energy_logs (user_id,level,note) VALUES ($1,$2,$3) RETURNING *', [req.user.id, level, note||null]);
  res.json(rows[0]);
});

app.get('/api/energy', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM energy_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT 14', [req.user.id]);
  res.json(rows);
});

app.get('/api/energy/today', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await db.query("SELECT * FROM energy_logs WHERE user_id=$1 AND logged_at::date=$2 ORDER BY logged_at DESC LIMIT 1", [req.user.id, today]);
  res.json(rows[0] || null);
});

// ── INTENTIONS ────────────────────────────────────────────────────────────────

app.get('/api/intention/today', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await db.query('SELECT * FROM daily_intentions WHERE user_id=$1 AND date=$2', [req.user.id, today]);
  res.json(rows[0] || null);
});

app.post('/api/intention', auth, async (req, res) => {
  const { intention } = req.body;
  if (!intention?.trim()) return res.status(400).json({ error: 'Intention required' });
  const { rows: [user] }  = await db.query('SELECT name,streak FROM users WHERE id=$1', [req.user.id]);
  const { rows: goals }   = await db.query("SELECT title,progress,target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
  const session           = await getActiveSession(req.user.id);
  const userContext = `USER: ${user.name}, Streak: ${user.streak} days, Goals: ${goals.map(g => g.title.replace(/^\[.*?\]\s*/,'') + ' (' + Math.round((g.progress/g.target)*100) + '%)').join(', ')||'none'}, Transformation: ${session?.responses?.transformation_statement||'not defined'}, Lens: ${session?.lens||'not chosen'}`;
  const prompt = `${user.name} is setting their daily intention: "${intention}"\n\nEvaluate and respond in this exact format:\nALIGNMENT: [ALIGNED / NEEDS ADJUSTMENT / NOT ALIGNED]\nREASON: [one sentence]\nCOACH: [2-3 sentences in MELTOS voice]`;
  try {
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 500, system: buildCoachSystem(userContext, '', 'intention'), messages: [{ role: 'user', content: prompt }] });
    const raw = response.content[0].text;
    const alignMatch = raw.match(/ALIGNMENT:\s*(ALIGNED|NEEDS ADJUSTMENT|NOT ALIGNED)/i);
    const coachMatch = raw.match(/COACH:\s*([\s\S]+)/i);
    const alignmentMap = { 'ALIGNED': 'aligned', 'NEEDS ADJUSTMENT': 'needs_adjustment', 'NOT ALIGNED': 'not_aligned' };
    const alignment  = alignmentMap[alignMatch?.[1]?.toUpperCase()] || 'needs_adjustment';
    const coachReply = coachMatch?.[1]?.trim() || raw;
    const today = new Date().toISOString().split('T')[0];
    await db.query(`INSERT INTO daily_intentions (user_id,intention,coach_reply,alignment,date) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,date) DO UPDATE SET intention=$2,coach_reply=$3,alignment=$4`, [req.user.id, intention.trim(), coachReply, alignment, today]);
    res.json({ alignment, coachReply, raw });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Coach unavailable' }); }
});

// ── DECISIONS ─────────────────────────────────────────────────────────────────

app.get('/api/decisions', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM decision_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
  res.json(rows);
});

app.post('/api/decisions', auth, async (req, res) => {
  const { decision, context } = req.body;
  if (!decision?.trim()) return res.status(400).json({ error: 'Decision required' });
  const { rows: [user] }  = await db.query('SELECT name,streak FROM users WHERE id=$1', [req.user.id]);
  const { rows: goals }   = await db.query("SELECT title,progress,target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
  const session           = await getActiveSession(req.user.id);
  const userContext = `USER: ${user.name}, Goals: ${goals.map(g => g.title.replace(/^\[.*?\]\s*/,'') + ' (' + Math.round((g.progress/g.target)*100) + '%)').join(', ')||'none'}, Transformation: ${session?.responses?.transformation_statement||'not defined'}, Lens: ${session?.lens||'not chosen'}, Vision: ${session?.responses?.vision_12months||'not defined'}`;
  const prompt = `${user.name} is logging a decision.\nDecision: "${decision}"\n${context ? 'Context: "' + context + '"' : ''}\n\nRespond in this exact format:\nALIGNMENT: [ALIGNED / NEEDS ADJUSTMENT / NOT ALIGNED]\nFOUNDATION: [body/mind/money/relationships]\nREASON: [one sentence]\nCOACH: [2-4 sentences with clear direction]`;
  try {
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 600, system: buildCoachSystem(userContext, '', 'decision'), messages: [{ role: 'user', content: prompt }] });
    const raw = response.content[0].text;
    const alignMatch     = raw.match(/ALIGNMENT:\s*(ALIGNED|NEEDS ADJUSTMENT|NOT ALIGNED)/i);
    const foundationMatch = raw.match(/FOUNDATION:\s*(\w+)/i);
    const coachMatch     = raw.match(/COACH:\s*([\s\S]+)/i);
    const alignmentMap   = { 'ALIGNED': 'aligned', 'NEEDS ADJUSTMENT': 'needs_adjustment', 'NOT ALIGNED': 'not_aligned' };
    const alignment  = alignmentMap[alignMatch?.[1]?.toUpperCase()] || 'needs_adjustment';
    const foundation = foundationMatch?.[1]?.toLowerCase() || null;
    const coachReply = coachMatch?.[1]?.trim() || raw;
    await db.query('INSERT INTO decision_log (user_id,decision,context,coach_reply,alignment,foundation) VALUES ($1,$2,$3,$4,$5,$6)', [req.user.id, decision.trim(), context?.trim()||null, coachReply, alignment, foundation]);
    res.json({ alignment, foundation, coachReply, raw });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Coach unavailable' }); }
});

// ── COACH GREETING ────────────────────────────────────────────────────────────

app.get('/api/coach/greeting', auth, async (req, res) => {
  try {
    const { rows: [user] }     = await db.query('SELECT name,streak FROM users WHERE id=$1', [req.user.id]);
    const { rows: goals }      = await db.query("SELECT title,progress,target,updated_at FROM goals WHERE user_id=$1 AND status='active' ORDER BY updated_at ASC", [req.user.id]);
    const { rows: entries }    = await db.query('SELECT mood,created_at FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.id]);
    const { rows: [lastChat] } = await db.query('SELECT created_at FROM conversations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);
    const today  = new Date().toISOString().split('T')[0];
    const { rows: habits }  = await db.query(`SELECT h.name, CASE WHEN h.target_type='check' THEN (hc.id IS NOT NULL) ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done FROM habits h LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2 WHERE h.user_id=$1`, [req.user.id, today]);
    const { rows: energy }  = await db.query("SELECT level FROM energy_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT 1", [req.user.id]);
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const stalledGoals = goals.filter(g => { const daysSince = (now - new Date(g.updated_at)) / (1000*60*60*24); return daysSince > 2 && Math.round((g.progress/g.target)*100) < 100; });
    const habitsDone = habits.filter(h => h.done).length;
    const energyLevel = energy[0]?.level || null;
    const daysSinceChat = lastChat ? Math.floor((now - new Date(lastChat.created_at)) / (1000*60*60*24)) : 999;
    const fullContext = `USER: ${user.name}, Streak: ${user.streak} days, Time: ${timeOfDay}, Goals: ${goals.map(g => g.title.replace(/^\[.*?\]\s*/,'') + ' (' + Math.round((g.progress/g.target)*100) + '%)').join(', ')||'none'}, Stalled goals: ${stalledGoals.map(g => g.title.replace(/^\[.*?\]\s*/,'')).join(', ')||'none'}, Habits today: ${habitsDone}/${habits.length} done, Energy: ${energyLevel ? energyLevel + '/5' : 'not logged'}, Days since last chat: ${daysSinceChat}, Pending: ${habits.filter(h => !h.done).map(h => h.name).join(', ')||'all done'}`;
    const greetingPrompt = `Generate a short proactive opening message for ${user.name} this ${timeOfDay}. Max 2 sentences. Be specific — reference one real data point. End with a question OR a direct challenge. No emojis at the start. One max at the end.`;
    const chipPrompt = `Based on this user data, generate exactly 4 short coach conversation starters as a JSON array. Each should be a complete sentence the user would send (15 words max). Make them specific to their actual situation. Return ONLY a JSON array of 4 strings.\n\nUser data:\n${fullContext}`;
    const [greetingRes, chipRes] = await Promise.all([
      anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 200, system: buildCoachSystem(fullContext, '', 'chat'), messages: [{ role: 'user', content: greetingPrompt }] }),
      anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 200, system: 'You generate JSON arrays of conversation starters. Return ONLY valid JSON, no markdown.', messages: [{ role: 'user', content: chipPrompt }] })
    ]);
    let chips = [];
    try { chips = JSON.parse(chipRes.content[0].text); if (!Array.isArray(chips)) chips = []; } catch(e) { chips = []; }
    res.json({ greeting: greetingRes.content[0].text, chips });
  } catch (e) { console.error('Greeting error:', e); res.json({ greeting: null }); }
});

// ── EFFECTIVENESS SCORE ───────────────────────────────────────────────────────

app.get('/api/effectiveness-score', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { rows: [user] }      = await db.query('SELECT name,streak FROM users WHERE id=$1', [req.user.id]);
    const { rows: goals }       = await db.query("SELECT progress,target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
    const { rows: habits }      = await db.query(`SELECT h.target_type,h.daily_target,COALESCE(hc.value,0) as today_value, CASE WHEN h.target_type='check' THEN (hc.id IS NOT NULL) ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done FROM habits h LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2 WHERE h.user_id=$1`, [req.user.id, today]);
    const { rows: [intention] } = await db.query('SELECT alignment FROM daily_intentions WHERE user_id=$1 AND date=$2', [req.user.id, today]);
    const { rows: decisions }   = await db.query("SELECT alignment FROM decision_log WHERE user_id=$1 AND created_at > NOW() - INTERVAL '7 days'", [req.user.id]);

    let mindset = 0;
    if (intention) mindset = intention.alignment === 'aligned' ? 25 : intention.alignment === 'needs_adjustment' ? 15 : 8;

    let action = 0;
    if (habits.length > 0) {
      const habitScore = habits.reduce((sum, h) => sum + (h.target_type === 'check' ? (h.done ? 1 : 0) : Math.min(1, h.today_value / h.daily_target)), 0);
      action = Math.round((habitScore / habits.length) * 25);
    }

    const momentum = goals.length > 0 ? Math.round(goals.reduce((a,g) => a+(g.progress/g.target)*100, 0) / goals.length * 0.25) : 0;
    const alignment = decisions.length > 0 ? Math.round((decisions.filter(d => d.alignment === 'aligned').length / decisions.length) * 25) : (intention?.alignment === 'aligned' ? 10 : 5);
    const total = Math.min(100, mindset + action + momentum + alignment);

    let level, message;
    if (total >= 91)      { level = 'Peak';      message = 'When good is no longer good enough — you are there.'; }
    else if (total >= 71) { level = 'Effective'; message = 'You are becoming more effective in less time.'; }
    else if (total >= 41) { level = 'Great';     message = 'Moving from good to great. Keep the momentum.'; }
    else                  { level = 'Good';      message = 'Good is the starting point. Now go for great.'; }

    res.json({ total, level, message, breakdown: { mindset, action, momentum, alignment } });
  } catch(e) { console.error('Score error:', e); res.status(500).json({ error: 'Could not calculate score' }); }
});

// ── WEEKLY REVIEW ─────────────────────────────────────────────────────────────

app.get('/api/weekly-review', auth, async (req, res) => {
  try {
    const { rows: [user] }   = await db.query('SELECT name,streak FROM users WHERE id=$1', [req.user.id]);
    const { rows: goals }    = await db.query("SELECT title,progress,target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
    const { rows: habits }   = await db.query(`SELECT h.name, COUNT(hc.id) as completions FROM habits h LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date >= CURRENT_DATE - INTERVAL '7 days' WHERE h.user_id=$1 GROUP BY h.id,h.name`, [req.user.id]);
    const { rows: decisions }= await db.query("SELECT alignment FROM decision_log WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days'", [req.user.id]);
    const { rows: energy }   = await db.query("SELECT level FROM energy_logs WHERE user_id=$1 AND logged_at >= NOW() - INTERVAL '7 days'", [req.user.id]);

    const avgGoal   = goals.length ? Math.round(goals.reduce((a,g) => a+(g.progress/g.target)*100, 0)/goals.length) : 0;
    const habitDone = habits.filter(h => parseInt(h.completions) > 0).length;
    const aligned   = decisions.filter(d => d.alignment === 'aligned').length;
    const avgEnergy = energy.length ? Math.round(energy.reduce((a,e) => a+e.level, 0)/energy.length*10)/10 : null;

    const context = `WEEKLY for ${user.name}: Streak ${user.streak} days, Goals avg ${avgGoal}%, Habits ${habitDone}/${habits.length} active, Decisions aligned ${aligned}/${decisions.length}, Energy avg ${avgEnergy || 'not tracked'}/5`;
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: buildCoachSystem(context, '', 'chat'), messages: [{ role: 'user', content: 'Write a weekly performance review for ' + user.name + '. 3-4 sentences. Reference specific data. One win to celebrate. One specific challenge for next week. End with a direct motivational push in MELTOS style. Sound like a real coach.' }] });
    res.json({ summary: response.content[0].text, stats: { avgGoal, habitDone, totalHabits: habits.length, aligned, totalDecisions: decisions.length, avgEnergy } });
  } catch(e) { console.error('Weekly review error:', e); res.status(500).json({ error: 'Could not generate review' }); }
});

// ── PEAK REPORT ───────────────────────────────────────────────────────────────

app.get('/api/peak-report', auth, async (req, res) => {
  try {
    const { rows: byHour }      = await db.query("SELECT EXTRACT(HOUR FROM COALESCE(completed_at,created_at)) as hour, COUNT(*) as count FROM habit_completions WHERE user_id=$1 AND date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY hour ORDER BY hour", [req.user.id]);
    const { rows: energyByHour }= await db.query("SELECT EXTRACT(HOUR FROM logged_at) as hour, AVG(level) as avg_energy FROM energy_logs WHERE user_id=$1 AND logged_at >= NOW() - INTERVAL '30 days' GROUP BY hour ORDER BY hour", [req.user.id]);
    const { rows: byDay }       = await db.query("SELECT TO_CHAR(date,'Dy') as day, alignment, COUNT(*) as count FROM daily_intentions WHERE user_id=$1 AND date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY day,alignment", [req.user.id]);
    res.json({ byHour, energyByHour, byDay });
  } catch(e) { console.error('Peak report error:', e); res.status(500).json({ error: 'Could not generate report' }); }
});

// ── LIFE DOMAINS ──────────────────────────────────────────────────────────────

app.get('/api/domains', auth, async (req, res) => {
  const { rows: domains } = await db.query('SELECT * FROM life_domains WHERE user_id=$1 ORDER BY created_at', [req.user.id]);
  for (const d of domains) {
    const { rows: metrics } = await db.query('SELECT * FROM domain_metrics WHERE domain_id=$1 AND user_id=$2 ORDER BY created_at', [d.id, req.user.id]);
    d.metrics = metrics;
  }
  res.json(domains);
});

app.post('/api/domains', auth, async (req, res) => {
  const { name, icon, color, domain_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows } = await db.query('INSERT INTO life_domains (user_id,name,icon,color,domain_type) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.id, name, icon||'x', color||'#0ea5e9', domain_type||'custom']);
  res.json({ ...rows[0], metrics: [] });
});

app.patch('/api/domains/:id', auth, async (req, res) => {
  const { name, icon, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const { rows } = await db.query('UPDATE life_domains SET name=$1,icon=$2,color=$3 WHERE id=$4 AND user_id=$5 RETURNING *', [name.trim(), icon||'x', color||'#0ea5e9', req.params.id, req.user.id]);
  res.json(rows[0] || null);
});

app.delete('/api/domains/:id', auth, async (req, res) => {
  await db.query('DELETE FROM life_domains WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

app.post('/api/domains/:id/metrics', auth, async (req, res) => {
  const { name, metric_type, unit, target, period } = req.body;
  if (!name || !target) return res.status(400).json({ error: 'Name and target required' });
  const { rows } = await db.query('INSERT INTO domain_metrics (domain_id,user_id,name,metric_type,unit,target,period) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [req.params.id, req.user.id, name, metric_type||'number', unit||'', target, period||'monthly']);
  res.json(rows[0]);
});

app.post('/api/domains/metrics/:id/log', auth, async (req, res) => {
  const { value, note } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Value required' });
  await db.query('UPDATE domain_metrics SET current_value=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3', [value, req.params.id, req.user.id]);
  const { rows } = await db.query('INSERT INTO domain_metric_logs (metric_id,user_id,value,note) VALUES ($1,$2,$3,$4) RETURNING *', [req.params.id, req.user.id, value, note||null]);
  res.json(rows[0]);
});

app.delete('/api/domains/metrics/:id', auth, async (req, res) => {
  await db.query('DELETE FROM domain_metrics WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// ── ONBOARDING ────────────────────────────────────────────────────────────────

app.get('/api/onboarding/status', auth, async (req, res) => {
  try {
    const { rows: [user] } = await db.query('SELECT onboarding_data FROM users WHERE id=$1', [req.user.id]);
    const data = user?.onboarding_data || null;
    const done = !!(data && Object.keys(data).length > 2);
    res.json({ done, data });
  } catch(e) { res.json({ done: false, data: null }); }
});

app.post('/api/onboarding/complete', auth, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'data required' });
    await db.query('UPDATE users SET onboarding_data=$1 WHERE id=$2', [JSON.stringify(data), req.user.id]);
    if (data.goal_90days && data.goal_90days.trim().length > 3) {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 90);
      try {
        await db.query("INSERT INTO goals (user_id,title,progress,target,deadline,category,status) VALUES ($1,$2,0,100,$3,'Business','active')", [req.user.id, data.goal_90days.trim(), deadline.toISOString().split('T')[0]]);
      } catch(ge) {
        await db.query('INSERT INTO goals (user_id,title,progress,target,deadline) VALUES ($1,$2,0,100,$3)', [req.user.id, data.goal_90days.trim(), deadline.toISOString().split('T')[0]]);
      }
    }
    const name = data.name || 'Champion';
    const stuck = data.stuck_area || 'your goals';
    const obstacle = data.obstacle || 'staying focused';
    let msg = 'Welcome ' + name + '! Your profile is set up.\n\nYou are working on ' + stuck + ' and your obstacle is ' + obstacle + '. That is where we focus.\n\n';
    if (data.peak_hour) msg += 'Peak hour: ' + data.peak_hour + ' — protect that time.\n\n';
    if (data.goal_90days) msg += '90-day goal created: "' + data.goal_90days + '"\n\n';
    msg += 'Lock in. Show up. Win.';
    res.json({ success: true, welcomeMessage: msg });
  } catch(e) { console.error('Onboarding error:', e.message); res.status(500).json({ error: 'Could not complete onboarding', detail: e.message }); }
});

app.patch('/api/onboarding/peak-hour', auth, async (req, res) => {
  const { peak_hour } = req.body;
  if (!peak_hour) return res.status(400).json({ error: 'peak_hour required' });
  try {
    const { rows: [user] } = await db.query('SELECT onboarding_data FROM users WHERE id=$1', [req.user.id]);
    const data = user?.onboarding_data || {};
    data.peak_hour = peak_hour;
    await db.query('UPDATE users SET onboarding_data=$1 WHERE id=$2', [JSON.stringify(data), req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Could not update' }); }
});

// ── HABITS WEEKLY ─────────────────────────────────────────────────────────────

app.get('/api/habits/weekly', auth, async (req, res) => {
  try {
    const today = new Date();
    const dow = today.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon);
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); days.push(d.toISOString().split('T')[0]); }
    const { rows: habits }      = await db.query('SELECT id,name,icon,target_type,daily_target FROM habits WHERE user_id=$1 ORDER BY created_at', [req.user.id]);
    const { rows: completions } = await db.query('SELECT habit_id,date,value FROM habit_completions WHERE user_id=$1 AND date>=$2 AND date<=$3', [req.user.id, days[0], days[6]]);
    const result = habits.map(h => ({
      id: h.id, name: h.name, icon: h.icon,
      days: days.map(date => {
        const c = completions.find(c => c.habit_id === h.id && c.date.toISOString().split('T')[0] === date);
        const done = h.target_type === 'check' ? !!c : (c ? c.value >= h.daily_target : false);
        return { date, done, value: c ? c.value : 0 };
      })
    }));
    res.json({ days, habits: result });
  } catch(e) { res.status(500).json({ error: 'Could not load weekly habits' }); }
});

// ── REPORT & EXPORT ───────────────────────────────────────────────────────────

app.get('/api/report', auth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];
    const [user, goals, habits, completions, energy, decisions] = await Promise.all([
      db.query('SELECT name,streak FROM users WHERE id=$1', [req.user.id]),
      db.query("SELECT title,progress,target,deadline,category FROM goals WHERE user_id=$1 AND status='active' ORDER BY created_at", [req.user.id]),
      db.query('SELECT id,name,icon,target_type,daily_target FROM habits WHERE user_id=$1 ORDER BY created_at', [req.user.id]),
      db.query('SELECT habit_id,date,value FROM habit_completions WHERE user_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [req.user.id, fromDate, toDate]),
      db.query('SELECT level,logged_at FROM energy_logs WHERE user_id=$1 AND logged_at::date>=$2 AND logged_at::date<=$3 ORDER BY logged_at', [req.user.id, fromDate, toDate]),
      db.query('SELECT decision,alignment,created_at FROM decision_log WHERE user_id=$1 AND created_at::date>=$2 AND created_at::date<=$3 ORDER BY created_at DESC', [req.user.id, fromDate, toDate]),
    ]);
    const habitStats = habits.rows.map(h => {
      const hComp = completions.rows.filter(c => c.habit_id === h.id);
      const uniqueDays = [...new Set(hComp.map(c => c.date.toISOString().split('T')[0]))];
      const totalDays  = Math.ceil((new Date(toDate) - new Date(fromDate)) / (1000*60*60*24)) + 1;
      return { ...h, completedDays: uniqueDays.length, totalDays, rate: Math.round((uniqueDays.length / totalDays) * 100) };
    });
    const avgEnergy = energy.rows.length > 0 ? Math.round(energy.rows.reduce((a,e) => a+e.level, 0) / energy.rows.length * 10) / 10 : null;
    const aligned   = decisions.rows.filter(d => d.alignment === 'aligned').length;
    res.json({ user: user.rows[0], period: { from: fromDate, to: toDate }, goals: goals.rows.map(g => ({ ...g, title: g.title.replace(/^\[.*?\]\s*/,''), pct: Math.round((g.progress/g.target)*100) })), habits: habitStats, energy: { logs: energy.rows, avg: avgEnergy }, decisions: { total: decisions.rows.length, aligned, items: decisions.rows } });
  } catch(e) { console.error('Report error:', e); res.status(500).json({ error: 'Could not generate report' }); }
});

app.get('/api/export/csv', auth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];
    const [goals, habits, completions, energy] = await Promise.all([
      db.query("SELECT title,progress,target,deadline FROM goals WHERE user_id=$1", [req.user.id]),
      db.query('SELECT id,name FROM habits WHERE user_id=$1', [req.user.id]),
      db.query('SELECT habit_id,date,value FROM habit_completions WHERE user_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [req.user.id, fromDate, toDate]),
      db.query('SELECT level,logged_at FROM energy_logs WHERE user_id=$1 AND logged_at::date>=$2 AND logged_at::date<=$3 ORDER BY logged_at', [req.user.id, fromDate, toDate]),
    ]);
    let csv = 'GOALS\nTitle,Progress (%),Deadline\n';
    goals.rows.forEach(g => { csv += '"' + g.title.replace(/^\[.*?\]\s*/,'') + '",' + Math.round((g.progress/g.target)*100) + ',"' + (g.deadline||'No deadline') + '"\n'; });
    csv += '\nHABIT COMPLETIONS\nDate,' + habits.rows.map(h => '"' + h.name + '"').join(',') + '\n';
    const days = [];
    let d = new Date(fromDate); const end = new Date(toDate);
    while (d <= end) { days.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() + 1); }
    days.forEach(date => {
      const row = [date];
      habits.rows.forEach(h => { const c = completions.rows.find(c => c.habit_id === h.id && c.date.toISOString().split('T')[0] === date); row.push(c ? (c.value >= 1 ? 'Yes' : 'No') : 'No'); });
      csv += row.join(',') + '\n';
    });
    csv += '\nENERGY LOGS\nDate,Level (1-5)\n';
    energy.rows.forEach(e => { csv += '"' + e.logged_at.toISOString().split('T')[0] + '",' + e.level + '\n'; });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="meltos-report-' + fromDate + '-to-' + toDate + '.csv"');
    res.send(csv);
  } catch(e) { console.error('CSV error:', e); res.status(500).json({ error: 'Could not generate CSV' }); }
});

// ── SMART TASK SUGGESTIONS ────────────────────────────────────────────────────

app.post('/api/goals/suggest-tasks', auth, async (req, res) => {
  const { goal } = req.body;
  if (!goal?.trim()) return res.status(400).json({ error: 'Goal required' });
  const prompt = 'The user\'s goal is: "' + goal + '"\n\nGenerate 3-5 specific daily tasks that directly lead to achieving this goal.\nReturn ONLY a valid JSON array, no markdown:\n[\n  { "name": "Short action verb + what (max 50 chars)", "icon": "single emoji", "target": null_or_number, "time": null_or_"9:00 AM" }\n]';
  try {
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 700, system: 'You are a productivity coach. Return ONLY valid JSON arrays. No markdown. No explanation.', messages: [{ role: 'user', content: prompt }] });
    const raw = response.content[0].text.trim().replace(/```json|```/g, '').trim();
    let tasks = [];
    try { tasks = JSON.parse(raw); if (!Array.isArray(tasks)) tasks = []; } catch(pe) { const match = raw.match(/\[[\s\S]*\]/); if (match) { try { tasks = JSON.parse(match[0]); } catch(e2) { tasks = []; } } }
    res.json({ tasks: tasks.slice(0, 5) });
  } catch(e) { console.error('Suggest tasks error:', e.message); res.status(500).json({ error: 'Could not generate suggestions' }); }
});

// ── CHAT EXPORT ───────────────────────────────────────────────────────────────

app.get('/api/coach/export', auth, async (req, res) => {
  try {
    const { rows }      = await db.query('SELECT role,content,created_at FROM conversations WHERE user_id=$1 ORDER BY created_at ASC', [req.user.id]);
    const { rows: [user] } = await db.query('SELECT name FROM users WHERE id=$1', [req.user.id]);
    let text = 'MELTOS COACH CONVERSATION\nUser: ' + user.name + '\nExported: ' + new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) + '\n---\n\n';
    rows.forEach(msg => {
      const time = new Date(msg.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      text += (msg.role === 'user' ? 'YOU' : 'COACH') + ' (' + time + ')\n' + msg.content + '\n\n';
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="meltos-coach-' + new Date().toISOString().split('T')[0] + '.txt"');
    res.send(text);
  } catch(e) { res.status(500).json({ error: 'Export failed' }); }
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only' });
    next();
  });
};

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const [users, active, convs, streak, sessions] = await Promise.all([
    db.query('SELECT COUNT(*) FROM users'),
    db.query("SELECT COUNT(*) FROM users WHERE last_active > NOW() - INTERVAL '1 day'"),
    db.query('SELECT COUNT(*) FROM conversations'),
    db.query('SELECT ROUND(AVG(streak)) FROM users'),
    db.query('SELECT COUNT(*) FROM coach_sessions WHERE completed=true'),
  ]);
  res.json({ totalUsers: +users.rows[0].count, activeToday: +active.rows[0].count, totalConvs: +convs.rows[0].count, avgStreak: +streak.rows[0].round, completedSessions: +sessions.rows[0].count });
});

// ── BILLING STUBS (Stripe disabled) ───────────────────────────────────────────

app.get('/api/billing/status', auth, async (req, res) => {
  res.json({ tier: 'pro', tier_name: 'Pro', coach_access: true, token_balance: 999999, token_packs: TOKEN_PACKS.map(p => ({ id: p.id, price_usd: p.price_usd, credits_usd: p.credits_usd, tokens: p.tokens })) });
});

app.post('/api/billing/subscribe', auth, async (req, res) => {
  res.json({ checkout_url: null, message: 'Payments coming soon' });
});

app.post('/api/billing/buy-tokens', auth, async (req, res) => {
  res.json({ checkout_url: null, message: 'Payments coming soon' });
});

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  res.json({ received: true });
});

app.post('/api/billing/cancel', auth, async (req, res) => {
  res.json({ success: false, message: 'Payments coming soon' });
});

// ── MIGRATIONS ────────────────────────────────────────────────────────────────

async function runMigrations() {
  const migrations = [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_streak_date DATE',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_data JSONB',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'basic'",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS token_balance INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_period_end TIMESTAMPTZ',
    "ALTER TABLE goals ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Business'",
    "ALTER TABLE goals ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'",
    "ALTER TABLE habits ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'check'",
    'ALTER TABLE habits ADD COLUMN IF NOT EXISTS daily_target INTEGER DEFAULT 1',
    'ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS energy_level INTEGER',
    'ALTER TABLE habit_completions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NOW()',
    'CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_id INT NOT NULL UNIQUE, endpoint TEXT NOT NULL, keys JSONB NOT NULL, peak_hour TEXT DEFAULT \'Evening (5-9pm)\', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())',
    'CREATE TABLE IF NOT EXISTS energy_logs (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5), note TEXT, logged_at TIMESTAMPTZ DEFAULT NOW())',
    'CREATE TABLE IF NOT EXISTS daily_intentions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, intention TEXT NOT NULL, coach_reply TEXT, alignment TEXT, date DATE NOT NULL DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())',
    'CREATE UNIQUE INDEX IF NOT EXISTS daily_intentions_user_date ON daily_intentions (user_id, date)',
    'CREATE TABLE IF NOT EXISTS decision_log (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, decision TEXT NOT NULL, context TEXT, coach_reply TEXT, alignment TEXT, foundation TEXT, created_at TIMESTAMPTZ DEFAULT NOW())',
    "CREATE TABLE IF NOT EXISTS coach_sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, phase TEXT NOT NULL DEFAULT 'mindset_checkin', phase_index INTEGER NOT NULL DEFAULT 0, responses JSONB NOT NULL DEFAULT '{}', lens TEXT, completed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())",
    "CREATE TABLE IF NOT EXISTS life_domains (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, icon TEXT DEFAULT '?', color TEXT DEFAULT '#0ea5e9', domain_type TEXT DEFAULT 'custom', created_at TIMESTAMPTZ DEFAULT NOW())",
    "CREATE TABLE IF NOT EXISTS domain_metrics (id SERIAL PRIMARY KEY, domain_id INTEGER REFERENCES life_domains(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, metric_type TEXT DEFAULT 'number', unit TEXT, target NUMERIC, current_value NUMERIC DEFAULT 0, period TEXT DEFAULT 'monthly', updated_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW())",
    'CREATE TABLE IF NOT EXISTS domain_metric_logs (id SERIAL PRIMARY KEY, metric_id INTEGER, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, value NUMERIC NOT NULL, note TEXT, logged_at TIMESTAMPTZ DEFAULT NOW())',
  ];
  for (const sql of migrations) {
    try { await db.query(sql); } catch(e) { console.warn('Migration warning:', sql.slice(0,60), e.message); }
  }
  console.log('Migrations complete');
}

runMigrations().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log('MELTOS API running on port ' + PORT));
});
