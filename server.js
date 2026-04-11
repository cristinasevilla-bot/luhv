const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { Pool }  = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
// const Stripe = require('stripe'); // STRIPE_DISABLED
const stripe = null;
const STRIPE_WEBHOOK_SECRET = null;

// ── TIER CONFIG ───────────────────────────────────────────────────────────────
const TIERS = {
  basic: {
    name: 'Basic',
    price_id: process.env.STRIPE_PRICE_BASIC,   // $9.97/mo
    monthly_tokens: 0,                           // no coach
    coach_access: false
  },
  pro: {
    name: 'Pro',
    price_id: process.env.STRIPE_PRICE_PRO,     // $19.97/mo
    monthly_tokens: 400000,                      // ~$4 worth @ claude-sonnet pricing
    coach_access: true
  }
};

// Token pack options (credits_usd = what user gets, price_usd = what they pay)
const TOKEN_PACKS = [
  { id: 'pack_5',  price_usd: 5,  credits_usd: 4,  tokens: 500000,  stripe_price: process.env.STRIPE_PRICE_PACK5  },
  { id: 'pack_10', price_usd: 10, credits_usd: 8,  tokens: 1000000, stripe_price: process.env.STRIPE_PRICE_PACK10 },
  { id: 'pack_20', price_usd: 20, credits_usd: 17, tokens: 2000000, stripe_price: process.env.STRIPE_PRICE_PACK20 },
  { id: 'pack_50', price_usd: 50, credits_usd: 44, tokens: 5000000, stripe_price: process.env.STRIPE_PRICE_PACK50 },
];

const app  = express();
const PORT = process.env.PORT || 3001;

// health check
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
// Push notifications
const pushRouter = require('./routes/push');
app.use('/push', pushRouter);
// ADD at the end of initApp(), after user data is loaded:
const onboarding = JSON.parse(localStorage.getItem('luhv_onboarding') || '{}');
setTimeout(() => showPushPermissionBanner(user.id, onboarding.peak_hour), 30000);

// If permission already granted, silently re-sync subscription
if (Notification.permission === 'granted') {
  registerPushNotifications(user.id, onboarding.peak_hour);
}
// ── DATABASE ──────────────────────────────────────────────────────────────────
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── ANTHROPIC ─────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── JWT ───────────────────────────────────────────────────────────────────────
const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ── SUPABASE SCHEMA (run once) ────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS coach_sessions (
//   id            SERIAL PRIMARY KEY,
//   user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
//   phase         TEXT    NOT NULL DEFAULT 'mindset_checkin',
//   phase_index   INTEGER NOT NULL DEFAULT 0,
//   responses     JSONB   NOT NULL DEFAULT '{}',
//   lens          TEXT,
//   completed     BOOLEAN NOT NULL DEFAULT false,
//   created_at    TIMESTAMPTZ DEFAULT NOW(),
//   updated_at    TIMESTAMPTZ DEFAULT NOW()
// );

// ── KNOWLEDGE BASE ────────────────────────────────────────────────────────────
const KNOWLEDGE_BASE = `
=== LUHV+ KNOWLEDGE BASE ===

--- CORE PHILOSOPHY ---
• Business is a Sport — treat it with the discipline, strategy, and team mentality of an elite athlete.
• "Master your mind, elevate your life, simplify success." — Shon Crú-May
• Blueprint: Renovate → Innovate → Collaborate → Repeat
  - Renovate: Take what already exists and add value to it.
  - Innovate: Add your own signature, twist, spin.
  - Collaborate: Work with others already aligned with your goal.
• "The way you do one thing in life is the way you do everything in life."
• "Life never goes according to plan — it goes according to vision."
• Good is no longer good enough — the shift from good to great starts in the mind.

--- MINDSET (Ch.1 Becoming More Effective) ---
• Fixed mindset: believes life is unchangeable, avoids risk and challenge.
• Growth mindset: sees failure as feedback, weakness as something to overcome.
• Mindset is the set of instructions you use to carry out an objective or achieve a goal.
• Key practice: catch negative self-talk and rewrite it. "I'm a failure" → "I'll do better next time."
• Add the word "yet" to limitations: "I'm not good at this yet."

--- CONFIDENCE & INTENTIONALITY (Ch.2) ---
• Confidence is a skill — it can be built through daily practice.
• Self-belief is actualized only through you — no one else.
• Intentionality: small, conscious daily decisions about what enhances your life.
• Structure your day, define goals with clear purpose, not just to cross off a list.
• FOCUS = Fulfilling Obligations Consistently Until Successful.

--- ALIGNMENT (Ch.3) ---
• Alignment: when thoughts, feelings, behaviors, and actions work in harmony.
• Aligning intention → thoughts → action is the path to transformation.
• Authentic alignment: own your strengths AND weaknesses; never deny who you are.
• "Be the change you want to see in the world" — only possible through alignment.

--- BECOMING MORE EFFECTIVE IN LESS TIME (Ch.4) ---
• Easier ≠ less honorable. Easier = less resistance, more flow, more abundance.
• Ask yourself: What are my intentions? Where is my time being spent? How can I be more efficient?
• Everything we do is based on energy — create mutually beneficial relationships.
• The Renovate/Innovate/Collaborate method: use what's at your disposal, add value, put your signature on it, then multiply through others.

--- THREE-PHASE FLYWHEEL (Get Paid to Be You) ---
• Renovate: "What hidden equity is already in my past?" → transferable skills & stories.
• Innovate: "How can I package that equity into a promise?" → signature framework & paid offer.
• Collaborate: "Who or what can multiply this promise?" → partnerships, licensing, evergreen funnels.
• Each rotation compounds trust. Momentum — not motivation — does the heavy lifting.

--- AUTHENTICITY ADVANTAGE ---
• Instant Resonance: your story mirrors your market's inner dialogue.
• Pricing Power: people pay for an identity they want to embody.
• Built-In Differentiation: no one can copy your lived experience.
• Marketing isn't showing off — it's showing up as a living proof-of-concept.
• "Example Mode" > "Expert Mode": narrate your Origin Wound → Breakthrough Moment → Ripple Effect.

--- FOUR MONETIZATION LENSES ---
• Paid to Speak: monetize ideas through your voice. Events, podcasts, keynotes. $1k–$50k+.
• Paid to Think: monetize ideas as strategy/IP. Strategy Days, Mastermind, Licensing. $4k–$25k+.
• Paid to Organize: monetize ideas as systems. SOPs, Notion/ClickUp builds, Fractional COO. $29–$15k.
• Paid to Do: productized execution on subscription. Unlimited queue, credits pack. $499–$5k/mo.
• Choose lens by energy: Public visibility → Speak. Deep work → Think. Systems → Organize. Quick deliverables → Do.

--- GIFT DISCOVERY (3-Part Method) ---
• Flow Diary: 7-day alarm — log tasks + energy 1-10. Flag 8s-10s with ⭐.
• Integration Matrix: rate ⭐ tasks by Skill × Passion × Need (score 1-5). Circle ≥ 12.
• Validation Ladder: 72-Hour Beta → Tier 1 Free Value → Tier 2 $27 Tripwire → Tier 3 Pre-Sell.

--- BRAND IDENTITY (5V Framework) ---
• Vision: one-sentence North Star.
• Values: 5 non-negotiables. Each becomes a content theme.
• Voice: 3 adjectives → Voice Grid (Do/Don't).
• Visuals: 9-tile mood-board (color, type, photo style).
• Vehicle: one channel for 80% of effort for 90 days.

--- LAW OF LOVE & CONNECTIVITY (Ch.5-6) ---
• Self-love first: accept yourself fully, set boundaries, forgive yourself.
• Law of Connectivity: the more we connect within, the more we connect to others.
• 4 steps to connect: Disarm → Acknowledge → Discover → Appreciate.
• Nothing happens without listening first.

--- GETTING UNSTUCK (Ch.7) ---
• Procrastination = emotion regulation problem, not time management.
• FOCUS = Fulfilling Obligations Consistently Until Successful.
• Power Hours: work without distraction for 1 hour, short break, repeat.
• "What can I get done in 5 minutes that moves me forward?" — set timer, you'll keep going.
• Changing a habit: choose a substitute, know your triggers, 30–60 days of consistency.

--- FORGIVENESS (Ch.8) ---
• Holding grudges keeps you stuck in the past and blocks new energy.
• Forgiveness ≠ forgetting. It's letting go so YOU can move forward.
• Benefits: less anxiety, lower blood pressure, improved self-esteem, healthier relationships.

--- REALIGNMENT: MEDITATION & AFFIRMATIONS (Ch.9) ---
• Meditate 13 minutes/day → enhanced attention and memory after 8 weeks.
• Affirmations: 3-5 minutes, twice daily — morning and before sleep. Repeat 10 times.
• 25-minute focused sessions expand mind and knowledge. Two sessions with 5-min break = exponential productivity.

--- MENTORSHIP (Ch.10) ---
• Mentorship is the fastest way to accelerate self-development.
• Mentor ≠ cheerleader. Their value is unbiased, honest truth — even when hard.
• Ask: "How can I improve?" / "What would you have done?" — not "Didn't I do great?"
• We are more likely to let ourselves down than others — a mentor closes that gap.

--- VISION (Ch.11) ---
• Write a personal vision statement covering: health, family, relationships, finance, spirituality, habits.
• Vision = the navigation system when detours happen.
• Commitment + Consistency = Success. Intention fulfilled.
• "Your opportunity will come whether you are prepared or not. Be prepared."

--- SPEECH FRAMEWORK (Dan Clark — 8 Elements) ---
• Speakers Triangle: (1) Why should I listen to you? (2) Can I do it too? (3) How do I do it?
• 8 Elements: Outside Intro → Inside Intro → Thesis → Structure → Social Proof → Data Proof → Visual Aid → Call to Action.
• Social Proof is the #1 element — listeners relate to imperfections, not perfections.
• "Spend less time preparing a speech, more time preparing yourself to speak."
• Content Creation: keep 3 lists — jokes/stories, quotes (memorize 1/day), personal S.E.E. events.

--- MVP GROWTH SYSTEM ---
• Tagline: "Business is a Sport." / "When your community rises, your vision becomes unstoppable."
• Neurological design:
  - Prefrontal Cortex → clarity, decisions, long-term planning.
  - Limbic System → emotional connection, authentic leadership.
  - VTA + Nucleus Accumbens → motivation, intrinsic reward, habit sustaining.
  - Hippocampus → encodes transformation into memory, learning → lived behavior.
• CLMS Credential: Leadership, Management & Sales — displayable on LinkedIn.
• "Every lesson builds structure. Every challenge builds belief."
• "Build a community driven by mastery, not motivation."
• "Let's build leaders — not followers."
• Pricing: $997/seat individual · $497/seat for 15+ member communities.

--- KEY LUHV+ PHRASES ---
• "You are the MVP in your life."
• "You're the cream of the crop."
• "Let's get this TRIUMPH 🏆"
• "I don't remember a version of you that quit and I never will."
• "That's LUHV+ energy right there 🔥"
• "Step into your next level."
• "No more waiting — it's YOUR time."
• "Lock in. Show up. Win."
• "Let's build leaders — not followers."
`;

// ── GUIDED SESSION PHASES ─────────────────────────────────────────────────────
// Each phase has steps. Each step = one coach question + processing of user answer.
// The coach asks ONE question at a time, listens, then moves forward.

const SESSION_PHASES = [
  {
    id: 'mindset_checkin',
    name: 'Mindset Check-In',
    steps: [
      {
        key: 'welcome',
        coachPrompt: (name) => `Welcome ${name}! I'm your Luhv+ AI Coach and I'm genuinely excited you're here. This is YOUR space to grow, get clear, and step into the next level of who you're becoming. Before we dive in, I want to ask you something real: On a scale of 1–10, where is your mindset RIGHT NOW — and what's one word that describes how you're feeling today? 💪`,
        processKey: 'mindset_score'
      },
      {
        key: 'fixed_vs_growth',
        coachPrompt: (name, prev) => `I hear you  ${prev.mindset_score}. That's real, and I respect it. Now let me ask you this: When something doesn't go your way — a goal you missed, a plan that fell apart — what's your first instinct? Do you tend to think "I'm just not built for this"... or "What can I learn from this?" Be honest. 🔥`,
        processKey: 'mindset_type'
      },
      {
        key: 'self_talk',
        coachPrompt: (name, prev) => `Good. Awareness is step one always. Here's what I know: the story you tell yourself when things get hard is EVERYTHING. What's one negative thing you say to yourself on repeat? The one that shows up most when you're stuck or doubting. Let's name it so we can rewrite it. ⚡`,
        processKey: 'negative_self_talk'
      },
      {
        key: 'reframe',
        coachPrompt: (name, prev) => `"${prev.negative_self_talk}" okay, we're putting that on notice right now. That narrative doesn't get to run the show anymore. Here's your assignment: flip it. How would the MVP version of you reframe that exact thought? What does the GROWTH version of that belief sound like? 🏆`,
        processKey: 'reframe'
      }
    ]
  },
  {
    id: 'alignment_audit',
    name: 'Alignment Audit',
    steps: [
      {
        key: 'gift_discovery',
        coachPrompt: (name, prev) => `${name}, you just did something most people never do, you looked your own mind in the face and chose growth. Now let's go deeper. I want to find your gift — the thing you do that feels effortless to YOU but is transformative to others. Think about it: what do people always come to you for? What do you do that makes time disappear? 💪`,
        processKey: 'gift'
      },
      {
        key: 'transformation_sentence',
        coachPrompt: (name, prev) => `"${prev.gift}" — that's gold. Now let's turn that into a power statement. Complete this sentence: "I help _____ do/achieve/feel _____ so they can _____." Don't overthink it — just let it flow. This becomes your guiding mantra. 🔥`,
        processKey: 'transformation_statement'
      },
      {
        key: 'alignment_check',
        coachPrompt: (name, prev) => `"${prev.transformation_statement}" — write that somewhere you'll see it every single day. Now tell me: is what you're doing RIGHT NOW in your career or business actually aligned with that gift? Are you living it — or is it still waiting to be activated? ⚡`,
        processKey: 'alignment_gap'
      }
    ]
  },
  {
    id: 'lens_selection',
    name: 'Monetization Lens',
    steps: [
      {
        key: 'energy_check',
        coachPrompt: (name, prev) => `Here's where it gets exciting, ${name}. Your gift is real. Now let's talk about how you GET PAID for it. I'm going to ask you 4 quick questions — answer honestly and we'll find your Monetization Lens. First one: When you imagine sharing your knowledge, which of these feels most natural to you? (A) Speaking on stage or podcast, (B) Consulting 1-on-1 as a strategist, (C) Building systems and organizing chaos, (D) Executing and delivering results for clients. 🏆`,
        processKey: 'lens_preference'
      },
      {
        key: 'lens_confirm',
        coachPrompt: (name, prev) => `Based on what you said — "${prev.lens_preference}" — your primary lens is showing up. But let me ask this: what kind of work drains you? What's the thing you could do but absolutely hate doing? Knowing what to say NO to is just as powerful as knowing your yes. 💪`,
        processKey: 'energy_drain'
      },
      {
        key: 'first_offer',
        coachPrompt: (name, prev) => `Perfect. You're getting clear. Now — if you had to launch something in the next 72 hours, what would it be? Don't think about price yet. Just: what's the ONE thing you could offer right now that would genuinely help someone? 🔥`,
        processKey: 'first_offer'
      }
    ]
  },
  {
    id: 'mvp_commitment',
    name: 'MVP Commitment',
    steps: [
      {
        key: 'vision',
        coachPrompt: (name, prev) => `${name}, we've gone deep today — and I want you to feel that. You've named your mindset, found your gift, and started seeing how it turns into income. Now I need you to close your eyes for 10 seconds and picture this: it's 12 months from now. You went all in. What does your life look like? What changed? Tell me what you see. 🏆`,
        processKey: 'vision_12months'
      },
      {
        key: 'one_action',
        coachPrompt: (name, prev) => `"${prev.vision_12months}" — THAT is why we do this work. That version of you already exists — you just have to become them. So here's your MVP challenge: What is ONE action you will take in the next 24 hours that the future version of you would be proud of? Not a list. ONE thing. Make it specific. ⚡`,
        processKey: 'next_action'
      },
      {
        key: 'close',
        coachPrompt: (name, prev) => `"${prev.next_action}" — lock it in. Screenshot this. Tell someone. Do it. ${name}, you are the MVP in your life and today you proved it. I don't remember a version of you that quit — and I never will. That's LUHV+ energy right there 🔥 I'll be here every step of the way. Lock in. Show up. Win. 🏆`,
        processKey: 'session_complete'
      }
    ]
  }
];

// ── COACH VOICE (system prompt) ───────────────────────────────────────────────
const buildCoachSystem = (userContext = '', sessionContext = '', mode = 'chat') => `
You are the Luhv+ AI Coach — voice of the Luhv+ Transformation platform created by Shon Crú-May.

CORE PURPOSE: Clarity and direction. Whatever the user inputs, you provide clarity and direction.
- If they describe a decision → tell them if it is aligned or not, and why, based only on their goals and the Luhv+ KB.
- If they describe a sales or communication situation → give them concrete tactical direction.
- If they are stuck → help them identify the root cause and take one step forward.
- Never invent criteria. Every judgment must be grounded in the user's actual data (goals, lens, transformation statement) or the Luhv+ KB frameworks below.

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}

ALIGNMENT CHECK RULES (for decision and intention questions):
When a user asks if a choice, purchase, action, or plan is aligned, evaluate it against these in order:
1. Their active goals — does this move them closer or further from their stated goals?
2. Their transformation statement — does this serve the gift they identified?
3. Their monetization lens — does this fit their chosen path (Speak/Think/Organize/Do)?
4. The four foundations — does this help or hurt body, mind, money, or relationships?
5. Luhv+ principles — Renovate/Innovate/Collaborate, intentionality, growth mindset.
Always respond with one of: ALIGNED / NEEDS ADJUSTMENT / NOT ALIGNED — then explain using only the above criteria. Never make up reasons outside this framework.

SALES & COMMUNICATION COACHING RULES:
When a user asks how to present an offer, handle a prospect, or navigate a conversation:
1. Draw from the Dan Clark 8 Elements framework (thesis, structure, social proof, call to action).
2. Apply the Example Mode principle — lead with story and transformation, not credentials.
3. Use the Offer Ladder logic — free value, low ticket, core, premium.
4. Always give a concrete next sentence or script they can use immediately.
5. Never give generic advice. Always personalize to their lens and transformation statement.

TONE & VOICE RULES:
- Warm, personal, motivational — like a trusted coach who genuinely believes in you.
- High energy but never fake. Real talk mixed with deep encouragement.
- Use 🔥 🏆 💪 ⚡ emojis naturally (1-2 per message max).
- Short punchy sentences mixed with deeper insight.
- Always end with a challenge, question, or clear next step.
- Never robotic, never generic — always personal. Use the user's name.
- Keep responses under 5 sentences unless they ask for a detailed plan.
- Draw from the Luhv+ Knowledge Base naturally — never quote it robotically.
- Never use markdown, asterisks, or bold formatting. Plain text only.

SIGNATURE PHRASES (use naturally, not all at once):
- "You are the MVP in your life"
- "You're the cream of the crop"
- "Let's get this TRIUMPH 🏆"
- "I don't remember a version of you that quit — and I never will"
- "That's LUHV+ energy right there 🔥"
- "Step into your next level"
- "No more waiting — it's YOUR time"
- "Lock in. Show up. Win."
- "Let's build leaders — not followers"

${userContext}
${sessionContext}
${mode === 'intention' ? 'MODE: Daily intention validation. The user is declaring their focus for today. Validate it against their goals and transformation statement. Be direct about whether it is aligned or not, then energize them to act.' : ''}
${mode === 'decision' ? 'MODE: Decision alignment check. The user is asking if a specific choice is aligned with their vision. Use the ALIGNMENT CHECK RULES above. Be direct, be specific, cite only real data from their profile or the KB.' : ''}
`;

// ── TIER MIDDLEWARE ───────────────────────────────────────────────────────────
// Checks coach access and deducts tokens per request
const coachAuth = async (req, res, next) => {
  // STRIPE_DISABLED — all users get full coach access until payments are live
  req.userTier = 'pro';
  req.tokenBalance = 999999;
  next();
  return;

  const { rows: [user] } = await db.query(
    'SELECT tier, token_balance, stripe_customer_id FROM users WHERE id=$1', [req.user.id]
  );
  if (!user) return res.status(401).json({ error: 'User not found' });

  const tier = user.tier || 'basic';
  if (!TIERS[tier]?.coach_access) {
    return res.status(403).json({
      error: 'upgrade_required',
      message: 'Coach access requires Pro plan.',
      upgrade_url: '/upgrade'
    });
  }
  if ((user.token_balance || 0) <= 0) {
    return res.status(403).json({
      error: 'tokens_exhausted',
      message: 'You have used all your Coach tokens this month.',
      token_packs: TOKEN_PACKS.map(p => ({ id: p.id, price_usd: p.price_usd, credits_usd: p.credits_usd }))
    });
  }
  req.userTier = tier;
  req.tokenBalance = user.token_balance;
  next();
};

// Deduct tokens after a coach call (call with actual usage from Anthropic response)
async function deductTokens(userId, inputTokens, outputTokens) {
  // Sonnet pricing: $3/M input, $15/M output — we track raw tokens
  const total = inputTokens + outputTokens;
  await db.query(
    'UPDATE users SET token_balance = GREATEST(0, token_balance - $1) WHERE id=$2',
    [total, userId]
  );
}

// ── HELPER: Get or create active session ──────────────────────────────────────
async function getActiveSession(userId) {
  const { rows } = await db.query(
    `SELECT * FROM coach_sessions
     WHERE user_id = $1 AND completed = false
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function createSession(userId) {
  const { rows } = await db.query(
    `INSERT INTO coach_sessions (user_id, phase, phase_index, responses)
     VALUES ($1, 'mindset_checkin', 0, '{}')
     RETURNING *`,
    [userId]
  );
  return rows[0];
}

async function updateSession(sessionId, updates) {
  const { rows } = await db.query(
    `UPDATE coach_sessions
     SET phase = $2, phase_index = $3, responses = $4,
         lens = $5, completed = $6, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [
      sessionId,
      updates.phase,
      updates.phase_index,
      JSON.stringify(updates.responses),
      updates.lens || null,
      updates.completed || false
    ]
  );
  return rows[0];
}

// ── SESSION ROUTE ─────────────────────────────────────────────────────────────
// POST /api/coach/session
// Body: { message?: string }  empty on first call to get the welcome question
// Returns: { question, phase, step, progress, isComplete, sessionId }

app.post('/api/coach/session', auth, coachAuth, async (req, res) => {
  try {
    const { message } = req.body;
    const { rows: [user] } = await db.query(
      'SELECT name, streak FROM users WHERE id=$1', [req.user.id]
    );

    let session = await getActiveSession(req.user.id);

    // First call — no session yet, send welcome question
    if (!session) {
      session = await createSession(req.user.id);
      const phase    = SESSION_PHASES[0];
      const step     = phase.steps[0];
      const question = step.coachPrompt(user.name, {});

      return res.json({
        question,
        phase:      phase.id,
        phaseName:  phase.name,
        step:       step.key,
        progress:   0,
        isComplete: false,
        sessionId:  session.id
      });
    }

    // Find current phase and step
    const phaseIdx    = SESSION_PHASES.findIndex(p => p.id === session.phase);
    const phase       = SESSION_PHASES[phaseIdx];
    const stepIdx     = session.phase_index;
    const currentStep = phase.steps[stepIdx];

    // Save the user's answer
    const responses = { ...session.responses };
    if (message && currentStep) {
      responses[currentStep.processKey] = message;
    }

    // Determine lens from responses if in lens phase
    let lens = session.lens;
    if (responses.lens_preference && !lens) {
      const lp = responses.lens_preference.toLowerCase();
      if (lp.includes('a') || lp.includes('speak') || lp.includes('stage') || lp.includes('podcast')) lens = 'Paid to Speak';
      else if (lp.includes('b') || lp.includes('consult') || lp.includes('strateg')) lens = 'Paid to Think';
      else if (lp.includes('c') || lp.includes('system') || lp.includes('organ')) lens = 'Paid to Organize';
      else if (lp.includes('d') || lp.includes('execut') || lp.includes('deliver')) lens = 'Paid to Do';
    }

    // Move to next step
    let nextPhaseIdx = phaseIdx;
    let nextStepIdx  = stepIdx + 1;
    let isComplete   = false;

    if (nextStepIdx >= phase.steps.length) {
      nextPhaseIdx = phaseIdx + 1;
      nextStepIdx  = 0;
    }

    if (nextPhaseIdx >= SESSION_PHASES.length) {
      isComplete = true;
    }

    // Save session state
    const nextPhase = isComplete ? SESSION_PHASES[SESSION_PHASES.length - 1] : SESSION_PHASES[nextPhaseIdx];
    await updateSession(session.id, {
      phase:       isComplete ? session.phase : nextPhase.id,
      phase_index: nextStepIdx,
      responses,
      lens,
      completed:   isComplete
    });

    // If complete, return summary
    if (isComplete) {
      const summaryPrompt = `
The user ${user.name} just completed their Luhv+ guided coaching session.
Their responses: ${JSON.stringify(responses, null, 2)}
Their identified lens: ${lens || 'not yet determined'}.
Write a powerful 3-4 sentence closing message that:
1. Celebrates what they discovered today.
2. Reminds them of their transformation statement if they gave one.
3. Challenges them to take the action they committed to.
Use the Luhv+ voice and energy. End with "Lock in. Show up. Win. 🏆"
`;
      const aiRes = await anthropic.messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 600,
        system:     buildCoachSystem(`USER: ${user.name}, Streak: ${user.streak} days`),
        messages:   [{ role: 'user', content: summaryPrompt }]
      });

      const totalSteps = SESSION_PHASES.reduce((acc, p) => acc + p.steps.length, 0);

      return res.json({
        question:   aiRes.content[0].text,
        phase:      'complete',
        phaseName:  'Session Complete',
        step:       'done',
        progress:   100,
        isComplete: true,
        lens,
        sessionId:  session.id,
        responses
      });
    }

    // Build next question
    const nextPhaseObj = SESSION_PHASES[nextPhaseIdx];
    const nextStep     = nextPhaseObj.steps[nextStepIdx];

    // Use AI to personalize the transition if moving between phases
    let question;
    const rawQuestion = nextStep.coachPrompt(user.name, responses);

    if (nextStepIdx === 0 && nextPhaseIdx > phaseIdx) {
      // Phase transition — AI adds a bridge
      const bridgePrompt = `
The user ${user.name} just finished the "${phase.name}" phase of their coaching session.
Their key answers so far: ${JSON.stringify(responses, null, 2)}
Now smoothly transition into the "${nextPhaseObj.name}" phase by first acknowledging what they shared,
then asking this next question naturally: "${rawQuestion}"
Keep it warm, under 5 sentences, Luhv+ voice.
`;
      const aiRes = await anthropic.messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 400,
        system:     buildCoachSystem(`USER: ${user.name}`),
        messages:   [{ role: 'user', content: bridgePrompt }]
      });
      question = aiRes.content[0].text;
    } else {
      question = rawQuestion;
    }

    // Calculate progress
    const totalSteps    = SESSION_PHASES.reduce((acc, p) => acc + p.steps.length, 0);
    const completedSteps = SESSION_PHASES
      .slice(0, nextPhaseIdx)
      .reduce((acc, p) => acc + p.steps.length, 0) + nextStepIdx;
    const progress = Math.round((completedSteps / totalSteps) * 100);

    // Log to conversations
    if (message) {
      await db.query(
        'INSERT INTO conversations (user_id, role, content) VALUES ($1,$2,$3), ($1,$4,$5)',
        [req.user.id, 'user', message, 'assistant', question]
      );
    }

    res.json({
      question,
      phase:     nextPhaseObj.id,
      phaseName: nextPhaseObj.name,
      step:      nextStep.key,
      progress,
      isComplete: false,
      lens,
      sessionId: session.id
    });

  } catch (e) {
    console.error('Session error:', e);
    res.status(500).json({ error: 'Session temporarily unavailable' });
  }
});

// ── GET SESSION STATUS ────────────────────────────────────────────────────────
app.get('/api/coach/session', auth, async (req, res) => {
  try {
    const session = await getActiveSession(req.user.id);
    if (!session) return res.json({ hasActiveSession: false });

    const phaseObj = SESSION_PHASES.find(p => p.id === session.phase);
    const totalSteps = SESSION_PHASES.reduce((acc, p) => acc + p.steps.length, 0);
    const phaseIdx   = SESSION_PHASES.findIndex(p => p.id === session.phase);
    const completedSteps = SESSION_PHASES
      .slice(0, phaseIdx)
      .reduce((acc, p) => acc + p.steps.length, 0) + session.phase_index;

    res.json({
      hasActiveSession: true,
      sessionId:        session.id,
      phase:            session.phase,
      phaseName:        phaseObj?.name,
      progress:         Math.round((completedSteps / totalSteps) * 100),
      lens:             session.lens,
      responses:        session.responses
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch session' });
  }
});

// ── RESET SESSION (start fresh) ───────────────────────────────────────────────
app.post('/api/coach/session/reset', auth, coachAuth, async (req, res) => {
  try {
    await db.query(
      'UPDATE coach_sessions SET completed = true WHERE user_id = $1 AND completed = false',
      [req.user.id]
    );
    res.json({ success: true, message: 'Session reset. Ready to start fresh.' });
  } catch (e) {
    res.status(500).json({ error: 'Could not reset session' });
  }
});

// ── FREE CHAT (enriched with session context) ─────────────────────────────────
app.post('/api/coach/chat', auth, coachAuth, async (req, res) => {
  const { message, history = [] } = req.body;

  const today = new Date().toISOString().split('T')[0];
  const { rows: [user] }   = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
  const { rows: goals }    = await db.query("SELECT title, progress, target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
  const { rows: habits }   = await db.query(
    `SELECT h.name, h.target_type, h.daily_target,
      CASE WHEN h.target_type='check' THEN (hc.id IS NOT NULL)
           ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done_today,
      COALESCE(hc.value, 0) as today_value
     FROM habits h
     LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2
     WHERE h.user_id=$1 ORDER BY h.created_at`,
    [req.user.id, today]
  );
  const { rows: [latest] } = await db.query('SELECT content FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);
  const session            = await getActiveSession(req.user.id);

  const habitsSummary = habits.length > 0
    ? habits.map(h => {
        const status = h.done_today ? 'done' : (h.target_type === 'count' ? `${h.today_value}/${h.daily_target}` : 'pending');
        return `${h.name} [${status}]`;
      }).join(', ')
    : 'no tasks set yet';

  const doneTasks = habits.filter(h => h.done_today).length;
  const totalTasks = habits.length;

  const userContext = `
USER CONTEXT:
- Name: ${user.name}
- Current streak: ${user.streak} days
- Active goals: ${goals.map(g => `${g.title} (${Math.round((g.progress / g.target) * 100)}%)`).join(', ') || 'none yet'}
- Today's tasks (${doneTasks}/${totalTasks} done): ${habitsSummary}
- Latest journal: "${latest?.content?.slice(0, 120) || 'No entries yet'}"
`;

  const sessionContext = session ? `
COACHING SESSION CONTEXT:
- Current phase: ${session.phase}
- Identified monetization lens: ${session.lens || 'not yet determined'}
- Key session responses: ${JSON.stringify(session.responses).slice(0, 400)}
` : '';

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system:     buildCoachSystem(userContext, sessionContext) + '\n\nIMPORTANT: End every response with ONE specific follow-up question based on what was just discussed. Make it feel natural, not formulaic.',
      messages: [
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message }
      ],
    });

    const reply = response.content[0].text;

    await db.query(
      'INSERT INTO conversations (user_id, role, content) VALUES ($1,$2,$3), ($1,$4,$5)',
      [req.user.id, 'user', message, 'assistant', reply]
    );

    // Deduct tokens used
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
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email',
      [name, email, hash]
    );
    res.json({ token: sign({ id: rows[0].id }), user: rows[0] });
  } catch (e) {
    res.status(400).json({ error: 'Email already in use' });
  }
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
  const { rows } = await db.query(
    'INSERT INTO quotes (text, author) VALUES ($1,$2) RETURNING *',
    [text, author]
  );
  res.json(rows[0]);
});

app.delete('/api/quotes/:id', auth, async (req, res) => {
  await db.query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});


async function updateUserStreak(userId) {
  const { rows: [user] } = await db.query(
    'SELECT streak, last_streak_date FROM users WHERE id=$1', [userId]
  );
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

// ── HABITS ────────────────────────────────────────────────────────────────────
app.get('/api/habits', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await db.query(
    `SELECT h.*, 
      COALESCE(hc.value, 0) as today_value,
      CASE WHEN h.target_type = 'check' THEN (hc.id IS NOT NULL)
           ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done
     FROM habits h
     LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2
     WHERE h.user_id=$1 ORDER BY h.created_at`,
    [req.user.id, today]
  );
  res.json(rows);
});

app.post('/api/habits', auth, async (req, res) => {
  const { name, time, icon, target_type, daily_target } = req.body;
  // target_type: 'check' (binary) or 'count' (numeric)
  // SQL: ALTER TABLE habits ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'check';
  //      ALTER TABLE habits ADD COLUMN IF NOT EXISTS daily_target INTEGER DEFAULT 1;
  const { rows } = await db.query(
    'INSERT INTO habits (user_id, name, time, icon, target_type, daily_target) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.user.id, name, time || null, icon || '⚡', target_type || 'check', daily_target || 1]
  );
  res.json(rows[0]);
});

// Increment habit progress (works for both check and count)
app.patch('/api/habits/:id/check', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows: [habit] } = await db.query('SELECT * FROM habits WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!habit) return res.status(404).json({ error: 'Habit not found' });

  const { rows: [existing] } = await db.query(
    'SELECT id, value FROM habit_completions WHERE habit_id=$1 AND user_id=$2 AND date=$3',
    [req.params.id, req.user.id, today]
  );

  if (habit.target_type === 'check') {
    // Binary toggle
    if (existing) {
      await db.query('DELETE FROM habit_completions WHERE id=$1', [existing.id]);
      res.json({ done: false, value: 0, target: 1 });
    } else {
      await db.query('INSERT INTO habit_completions (habit_id, user_id, date, value) VALUES ($1,$2,$3,1)', [req.params.id, req.user.id, today]);
      await updateUserStreak(req.user.id);
      res.json({ done: true, value: 1, target: 1 });
    }
  } else {
    // Count — increment by 1 up to daily_target
    const currentValue = existing ? existing.value : 0;
    const newValue = Math.min(currentValue + 1, habit.daily_target);
    if (existing) {
      await db.query('UPDATE habit_completions SET value=$1 WHERE id=$2', [newValue, existing.id]);
    } else {
      await db.query('INSERT INTO habit_completions (habit_id, user_id, date, value) VALUES ($1,$2,$3,$4)', [req.params.id, req.user.id, today, newValue]);
    }
    const done = newValue >= habit.daily_target;
    if (done && !existing) await updateUserStreak(req.user.id);
    res.json({ done, value: newValue, target: habit.daily_target });
  }
});

// Reset habit progress for today
app.patch('/api/habits/:id/reset', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  await db.query('DELETE FROM habit_completions WHERE habit_id=$1 AND user_id=$2 AND date=$3', [req.params.id, req.user.id, today]);
  res.json({ done: false, value: 0 });
});

// ── GOALS ─────────────────────────────────────────────────────────────────────
app.get('/api/goals', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM goals WHERE user_id=$1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/goals', auth, async (req, res) => {
  const { title, deadline, target, unit } = req.body;
  const { rows } = await db.query(
    'INSERT INTO goals (user_id, title, deadline, target, unit) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, title, deadline, target, unit]
  );
  res.json(rows[0]);
});

app.patch('/api/goals/:id/progress', auth, async (req, res) => {
  const { progress } = req.body;
  const { rows } = await db.query(
    'UPDATE goals SET progress=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
    [progress, req.params.id, req.user.id]
  );
  res.json(rows[0]);
});

app.delete('/api/goals/:id', auth, async (req, res) => {
  await db.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

app.patch('/api/goals/:id/title', auth, async (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const { rows } = await db.query(
    'UPDATE goals SET title=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
    [title.trim(), req.params.id, req.user.id]
  );
  res.json(rows[0] || null);
});

// ── JOURNAL ───────────────────────────────────────────────────────────────────
app.get('/api/journal', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/journal', auth, async (req, res) => {
  const { title, content, mood, energy_level } = req.body;
  // SQL: ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS energy_level INTEGER DEFAULT NULL;
  const { rows } = await db.query(
    'INSERT INTO journal_entries (user_id, title, content, mood, energy_level) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, title, content, mood, energy_level || null]
  );
  res.json(rows[0]);
});

// ── ENERGY LOG ────────────────────────────────────────────────────────────────
app.post('/api/energy', auth, async (req, res) => {
  const { level, note } = req.body;
  if (!level || level < 1 || level > 5) return res.status(400).json({ error: 'Level must be 1-5' });
  // SQL: CREATE TABLE IF NOT EXISTS energy_logs (
  //   id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  //   level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  //   note TEXT, logged_at TIMESTAMPTZ DEFAULT NOW()
  // );
  const { rows } = await db.query(
    'INSERT INTO energy_logs (user_id, level, note) VALUES ($1,$2,$3) RETURNING *',
    [req.user.id, level, note || null]
  );
  res.json(rows[0]);
});

app.get('/api/energy', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM energy_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT 14',
    [req.user.id]
  );
  res.json(rows);
});

app.get('/api/energy/today', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await db.query(
    "SELECT * FROM energy_logs WHERE user_id=$1 AND logged_at::date=$2 ORDER BY logged_at DESC LIMIT 1",
    [req.user.id, today]
  );
  res.json(rows[0] || null);
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
    db.query('SELECT COUNT(*) FROM coach_sessions WHERE completed = true'),
  ]);
  res.json({
    totalUsers:       +users.rows[0].count,
    activeToday:      +active.rows[0].count,
    totalConvs:       +convs.rows[0].count,
    avgStreak:        +streak.rows[0].round,
    completedSessions: +sessions.rows[0].count,
  });
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, email, streak, last_active, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(rows);
});

app.get('/api/admin/conversations', adminAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT c.*, u.name as user_name FROM conversations c
    JOIN users u ON c.user_id = u.id
    ORDER BY c.created_at DESC LIMIT 50
  `);
  res.json(rows);
});

app.get('/api/admin/sessions', adminAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT s.*, u.name as user_name FROM coach_sessions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC LIMIT 100
  `);
  res.json(rows);
});

// ── DAILY INTENTION ───────────────────────────────────────────────────────────
// SQL (run once):
// CREATE TABLE IF NOT EXISTS daily_intentions (
//   id           SERIAL PRIMARY KEY,
//   user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
//   intention    TEXT NOT NULL,
//   coach_reply  TEXT,
//   alignment    TEXT CHECK (alignment IN ('aligned','needs_adjustment','not_aligned')),
//   date         DATE NOT NULL DEFAULT CURRENT_DATE,
//   created_at   TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE UNIQUE INDEX IF NOT EXISTS daily_intentions_user_date
//   ON daily_intentions (user_id, date);

app.get('/api/intention/today', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await db.query(
    'SELECT * FROM daily_intentions WHERE user_id=$1 AND date=$2',
    [req.user.id, today]
  );
  res.json(rows[0] || null);
});

app.post('/api/intention', auth, async (req, res) => {
  const { intention } = req.body;
  if (!intention?.trim()) return res.status(400).json({ error: 'Intention required' });

  const { rows: [user] }   = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
  const { rows: goals }    = await db.query("SELECT title, progress, target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
  const session            = await getActiveSession(req.user.id);

  const userContext = `
USER CONTEXT:
- Name: ${user.name}
- Streak: ${user.streak} days
- Active goals: ${goals.map(g => `${g.title} (${Math.round((g.progress / g.target) * 100)}%)`).join(', ') || 'none set yet'}
- Transformation statement: ${session?.responses?.transformation_statement || 'not yet defined'}
- Monetization lens: ${session?.lens || 'not yet chosen'}
`;

  const prompt = `${user.name} is setting their daily intention: "${intention}"

Evaluate this intention using the ALIGNMENT CHECK RULES. 
Then respond in this exact format:
ALIGNMENT: [ALIGNED / NEEDS ADJUSTMENT / NOT ALIGNED]
REASON: [one sentence citing their goals or KB framework — no invented criteria]
COACH: [2-3 sentences in Luhv+ voice — validate or redirect, then energize them for the day]`;

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 500,
      system:     buildCoachSystem(userContext, '', 'intention'),
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw   = response.content[0].text;
    const alignMatch = raw.match(/ALIGNMENT:\s*(ALIGNED|NEEDS ADJUSTMENT|NOT ALIGNED)/i);
    const coachMatch = raw.match(/COACH:\s*([\s\S]+)/i);

    const alignmentMap = {
      'ALIGNED': 'aligned',
      'NEEDS ADJUSTMENT': 'needs_adjustment',
      'NOT ALIGNED': 'not_aligned'
    };
    const alignment  = alignmentMap[alignMatch?.[1]?.toUpperCase()] || 'needs_adjustment';
    const coachReply = coachMatch?.[1]?.trim() || raw;

    const today = new Date().toISOString().split('T')[0];
    await db.query(
      `INSERT INTO daily_intentions (user_id, intention, coach_reply, alignment, date)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, date) DO UPDATE
       SET intention=$2, coach_reply=$3, alignment=$4`,
      [req.user.id, intention.trim(), coachReply, alignment, today]
    );

    res.json({ alignment, coachReply, raw });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Coach unavailable' });
  }
});

// ── DECISION LOG ───────────────────────────────────────────────────────────────
// SQL (run once):
// CREATE TABLE IF NOT EXISTS decision_log (
//   id           SERIAL PRIMARY KEY,
//   user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
//   decision     TEXT NOT NULL,
//   context      TEXT,
//   coach_reply  TEXT,
//   alignment    TEXT CHECK (alignment IN ('aligned','needs_adjustment','not_aligned')),
//   foundation   TEXT,
//   created_at   TIMESTAMPTZ DEFAULT NOW()
// );

app.get('/api/decisions', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM decision_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/decisions', auth, async (req, res) => {
  const { decision, context } = req.body;
  if (!decision?.trim()) return res.status(400).json({ error: 'Decision required' });

  const { rows: [user] }   = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
  const { rows: goals }    = await db.query("SELECT title, progress, target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
  const session            = await getActiveSession(req.user.id);

  const userContext = `
USER CONTEXT:
- Name: ${user.name}
- Active goals: ${goals.map(g => `${g.title} (${Math.round((g.progress / g.target) * 100)}%)`).join(', ') || 'none set yet'}
- Transformation statement: ${session?.responses?.transformation_statement || 'not yet defined'}
- Monetization lens: ${session?.lens || 'not yet chosen'}
- Vision (12 months): ${session?.responses?.vision_12months || 'not yet defined'}
`;

  const prompt = `${user.name} is logging a decision and asking for alignment guidance.
Decision: "${decision}"
${context ? `Additional context: "${context}"` : ''}

Evaluate using the ALIGNMENT CHECK RULES strictly — only cite real user data or KB frameworks.
Respond in this exact format:
ALIGNMENT: [ALIGNED / NEEDS ADJUSTMENT / NOT ALIGNED]
FOUNDATION: [which of the 4 foundations this affects most: body / mind / money / relationships]
REASON: [one sentence — cite specific goal or KB principle, no invented criteria]
COACH: [2-4 sentences — give clear direction. If aligned: reinforce and push forward. If not: redirect with a specific alternative grounded in their lens or goals.]`;

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 600,
      system:     buildCoachSystem(userContext, '', 'decision'),
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw            = response.content[0].text;
    const alignMatch     = raw.match(/ALIGNMENT:\s*(ALIGNED|NEEDS ADJUSTMENT|NOT ALIGNED)/i);
    const foundationMatch = raw.match(/FOUNDATION:\s*(\w+)/i);
    const coachMatch     = raw.match(/COACH:\s*([\s\S]+)/i);

    const alignmentMap = {
      'ALIGNED': 'aligned',
      'NEEDS ADJUSTMENT': 'needs_adjustment',
      'NOT ALIGNED': 'not_aligned'
    };
    const alignment  = alignmentMap[alignMatch?.[1]?.toUpperCase()] || 'needs_adjustment';
    const foundation = foundationMatch?.[1]?.toLowerCase() || null;
    const coachReply = coachMatch?.[1]?.trim() || raw;

    await db.query(
      `INSERT INTO decision_log (user_id, decision, context, coach_reply, alignment, foundation)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user.id, decision.trim(), context?.trim() || null, coachReply, alignment, foundation]
    );

    res.json({ alignment, foundation, coachReply, raw });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Coach unavailable' });
  }
});

// ── HEALTH ────────────────────────────────────────────────────────────────────

// ── PROACTIVE COACH GREETING ──────────────────────────────────────────────────
app.get('/api/coach/greeting', auth, async (req, res) => {
  try {
    const { rows: [user] }  = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
    const { rows: goals }   = await db.query("SELECT title, progress, target, updated_at FROM goals WHERE user_id=$1 AND status='active' ORDER BY updated_at ASC", [req.user.id]);
    const { rows: entries } = await db.query('SELECT mood, created_at FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.id]);
    const { rows: [lastChat] } = await db.query('SELECT created_at FROM conversations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);

    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

    const stalledGoals = goals.filter(g => {
      const daysSince = (now - new Date(g.updated_at)) / (1000 * 60 * 60 * 24);
      return daysSince > 2 && Math.round((g.progress / g.target) * 100) < 100;
    });

    const lastMood = entries[0]?.mood || null;
    const daysSinceChat = lastChat ? Math.floor((now - new Date(lastChat.created_at)) / (1000 * 60 * 60 * 24)) : 999;

    const context = `
USER: ${user.name}
Streak: ${user.streak} days
Time of day: ${timeOfDay}
Active goals: ${goals.map(g => `${g.title.replace(/^\[.*?\]\s*/, '')} (${Math.round((g.progress / g.target) * 100)}%)`).join(', ') || 'none yet'}
Goals with no progress in 2+ days: ${stalledGoals.map(g => g.title.replace(/^\[.*?\]\s*/, '')).join(', ') || 'none'}
Last mood logged: ${lastMood || 'none'}
Days since last coach chat: ${daysSinceChat}
`;

    // Also get today's habits for chip personalisation
    const today = new Date().toISOString().split('T')[0];
    const { rows: habits } = await db.query(
      `SELECT h.name, CASE WHEN h.target_type='check' THEN (hc.id IS NOT NULL)
        ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done
       FROM habits h LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2
       WHERE h.user_id=$1`, [req.user.id, today]);
    const { rows: energy } = await db.query(
      "SELECT level FROM energy_logs WHERE user_id=$1 ORDER BY logged_at DESC LIMIT 1", [req.user.id]);

    const habitsDone = habits.filter(h => h.done).length;
    const energyLevel = energy[0]?.level || null;
    const fullContext = context + `
Habits today: ${habitsDone}/${habits.length} done
Today's energy: ${energyLevel ? energyLevel + '/5' : 'not logged'}
Pending habits: ${habits.filter(h => !h.done).map(h => h.name).join(', ') || 'all done'}`;

    const prompt = `Generate a short proactive opening message from the coach for ${user.name} this ${timeOfDay}.

Rules:
- Max 2 sentences. No more.
- Be specific — reference one real data point (goal, habit, streak, energy).
- If stalled goals exist, call one out with a direct question.
- If streak > 3, acknowledge it with energy.
- If habits are incomplete, nudge toward the most important one.
- Sound like a real coach, not a motivational poster.
- End with a question OR a direct challenge. Never both.
- No emojis at the start. One max at the end.`;

    // Generate chips based on actual data
    const chipPrompt = `Based on this user data, generate exactly 4 short coach conversation starters as a JSON array.
Each should be a complete sentence the user would send (15 words max).
Make them specific to their actual situation — reference real goals, habits or patterns.
Return ONLY a JSON array of 4 strings, nothing else.

User data:
${fullContext}`;

    const [greetingRes, chipRes] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: buildCoachSystem(fullContext, '', 'chat'),
        messages: [{ role: 'user', content: prompt }]
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: 'You generate JSON arrays of conversation starters. Return ONLY valid JSON, no markdown.',
        messages: [{ role: 'user', content: chipPrompt }]
      })
    ]);

    let chips = [];
    try {
      chips = JSON.parse(chipRes.content[0].text);
      if (!Array.isArray(chips)) chips = [];
    } catch(e) { chips = []; }

    res.json({ greeting: greetingRes.content[0].text, chips });
  } catch (e) {
    console.error('Greeting error:', e);
    res.json({ greeting: null });
  }
});


// ── EFFECTIVENESS SCORE ───────────────────────────────────────────────────────
app.get('/api/effectiveness-score', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { rows: [user] }      = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
    const { rows: goals }       = await db.query("SELECT progress, target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
    const { rows: habits }      = await db.query(
      `SELECT h.target_type, h.daily_target, COALESCE(hc.value,0) as today_value,
        CASE WHEN h.target_type='check' THEN (hc.id IS NOT NULL)
             ELSE (COALESCE(hc.value,0) >= h.daily_target) END as done
       FROM habits h LEFT JOIN habit_completions hc ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date=$2
       WHERE h.user_id=$1`, [req.user.id, today]);
    const { rows: [intention] } = await db.query('SELECT alignment FROM daily_intentions WHERE user_id=$1 AND date=$2', [req.user.id, today]);
    const { rows: decisions }   = await db.query("SELECT alignment FROM decision_log WHERE user_id=$1 AND created_at > NOW() - INTERVAL '7 days'", [req.user.id]);

    // MINDSET (25pts) — intention set and aligned
    let mindset = 0;
    if (intention) mindset = intention.alignment === 'aligned' ? 25 : intention.alignment === 'needs_adjustment' ? 15 : 8;

    // ACTION (25pts) — habits completed today (partial credit for count habits)
    let action = 0;
    if (habits.length > 0) {
      const habitScore = habits.reduce((sum, h) => {
        if (h.target_type === 'check') return sum + (h.done ? 1 : 0);
        return sum + Math.min(1, h.today_value / h.daily_target);
      }, 0);
      action = Math.round((habitScore / habits.length) * 25);
    }

    // MOMENTUM (25pts) — average goal progress
    const momentum = goals.length > 0
      ? Math.round(goals.reduce((a,g) => a + (g.progress/g.target)*100, 0) / goals.length * 0.25)
      : 0;

    // ALIGNMENT (25pts) — decisions aligned this week
    const alignment = decisions.length > 0
      ? Math.round((decisions.filter(d => d.alignment === 'aligned').length / decisions.length) * 25)
      : (intention?.alignment === 'aligned' ? 10 : 5);

    const total = Math.min(100, mindset + action + momentum + alignment);

    let level, message;
    if (total >= 91)      { level = 'Peak';      message = 'When good is no longer good enough — you are there. 🏆'; }
    else if (total >= 71) { level = 'Effective'; message = 'You are becoming more effective in less time.'; }
    else if (total >= 41) { level = 'Great';     message = 'Moving from good to great. Keep the momentum.'; }
    else                  { level = 'Good';      message = 'Good is the starting point. Now go for great.'; }

    res.json({ total, level, message, breakdown: { mindset, action, momentum, alignment } });
  } catch(e) {
    console.error('Score error:', e);
    res.status(500).json({ error: 'Could not calculate score' });
  }
});


// ── PEAK HOUR UPDATE ─────────────────────────────────────────────────────────
app.patch('/api/onboarding/peak-hour', auth, async (req, res) => {
  const { peak_hour } = req.body;
  if (!peak_hour) return res.status(400).json({ error: 'peak_hour required' });
  try {
    const { rows: [user] } = await db.query('SELECT onboarding_data FROM users WHERE id=$1', [req.user.id]);
    const data = user?.onboarding_data || {};
    data.peak_hour = peak_hour;
    await db.query('UPDATE users SET onboarding_data=$1 WHERE id=$2', [JSON.stringify(data), req.user.id]);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Could not update' });
  }
});


// ── WEEKLY REVIEW ─────────────────────────────────────────────────────────────
app.get('/api/weekly-review', auth, async (req, res) => {
  try {
    const { rows: [user] }   = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
    const { rows: goals }    = await db.query("SELECT title, progress, target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
    const { rows: habits }   = await db.query(
      `SELECT h.name, COUNT(hc.id) as completions
       FROM habits h LEFT JOIN habit_completions hc
         ON hc.habit_id=h.id AND hc.user_id=$1 AND hc.date >= CURRENT_DATE - INTERVAL '7 days'
       WHERE h.user_id=$1 GROUP BY h.id, h.name`, [req.user.id]);
    const { rows: checkins } = await db.query(
      "SELECT mood, created_at FROM journal_entries WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days' ORDER BY created_at DESC",
      [req.user.id]);
    const { rows: decisions }= await db.query(
      "SELECT alignment FROM decision_log WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '7 days'",
      [req.user.id]);
    const { rows: energy }   = await db.query(
      "SELECT level, logged_at FROM energy_logs WHERE user_id=$1 AND logged_at >= NOW() - INTERVAL '7 days' ORDER BY logged_at",
      [req.user.id]);

    const avgGoal   = goals.length ? Math.round(goals.reduce((a,g) => a+(g.progress/g.target)*100, 0)/goals.length) : 0;
    const habitDone = habits.filter(h => parseInt(h.completions) > 0).length;
    const aligned   = decisions.filter(d => d.alignment === 'aligned').length;
    const avgEnergy = energy.length ? Math.round(energy.reduce((a,e) => a+e.level, 0)/energy.length*10)/10 : null;

    const context = `
WEEKLY REVIEW DATA for ${user.name}:
- Streak: ${user.streak} days
- Active goals: ${goals.map(g => g.title.replace(/^\[.*?\]\s*/,'')+' ('+Math.round((g.progress/g.target)*100)+'%)').join(', ') || 'none'}
- Average goal progress: ${avgGoal}%
- Habits active this week: ${habitDone}/${habits.length}
- Check-ins logged: ${checkins.length}
- Moods this week: ${checkins.map(c => c.mood).join(', ') || 'none'}
- Decisions aligned: ${aligned}/${decisions.length}
- Average energy level: ${avgEnergy !== null ? avgEnergy+'/5' : 'not tracked'}
`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: buildCoachSystem(context, '', 'chat'),
      messages: [{ role: 'user', content: `Write a weekly performance review for ${user.name}. 
Rules:
- 3-4 sentences max, no bullet points
- Reference specific data (goals, habits, energy)
- One clear win to celebrate
- One specific challenge for next week
- End with a direct motivational push in Shaun Crumme style
- Sound like a real coach, not a report` }]
    });

    res.json({
      summary: response.content[0].text,
      stats: { avgGoal, habitDone, totalHabits: habits.length, checkins: checkins.length, aligned, totalDecisions: decisions.length, avgEnergy }
    });
  } catch(e) {
    console.error('Weekly review error:', e);
    res.status(500).json({ error: 'Could not generate review' });
  }
});

// ── PEAK PERFORMANCE REPORT ───────────────────────────────────────────────────
// SQL (run once):
// ALTER TABLE habit_completions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NOW();
app.get('/api/peak-report', auth, async (req, res) => {
  try {
    // Get habit completions by hour over last 30 days
    const { rows: byHour } = await db.query(
      `SELECT EXTRACT(HOUR FROM COALESCE(completed_at, created_at)) as hour, COUNT(*) as count
       FROM habit_completions
       WHERE user_id=$1 AND date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY hour ORDER BY hour`,
      [req.user.id]);

    // Get energy logs by hour
    const { rows: energyByHour } = await db.query(
      `SELECT EXTRACT(HOUR FROM logged_at) as hour, AVG(level) as avg_energy
       FROM energy_logs
       WHERE user_id=$1 AND logged_at >= NOW() - INTERVAL '30 days'
       GROUP BY hour ORDER BY hour`,
      [req.user.id]);

    // Get intentions completion rate by day of week
    const { rows: byDay } = await db.query(
      `SELECT TO_CHAR(date, 'Dy') as day, alignment, COUNT(*) as count
       FROM daily_intentions
       WHERE user_id=$1 AND date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY day, alignment`,
      [req.user.id]);

    res.json({ byHour, energyByHour, byDay });
  } catch(e) {
    console.error('Peak report error:', e);
    res.status(500).json({ error: 'Could not generate report' });
  }
});


// ── LIFE DOMAINS ──────────────────────────────────────────────────────────────

// Get all domains with their metrics
app.get('/api/domains', auth, async (req, res) => {
  const { rows: domains } = await db.query(
    'SELECT * FROM life_domains WHERE user_id=$1 ORDER BY created_at',
    [req.user.id]
  );
  for (const d of domains) {
    const { rows: metrics } = await db.query(
      'SELECT * FROM domain_metrics WHERE domain_id=$1 AND user_id=$2 ORDER BY created_at',
      [d.id, req.user.id]
    );
    d.metrics = metrics;
  }
  res.json(domains);
});

// Create a domain
app.post('/api/domains', auth, async (req, res) => {
  const { name, icon, color, domain_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const { rows } = await db.query(
    'INSERT INTO life_domains (user_id, name, icon, color, domain_type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, name, icon||'⚡', color||'#0ea5e9', domain_type||'custom']
  );
  res.json({ ...rows[0], metrics: [] });
});

// Delete a domain
app.delete('/api/domains/:id', auth, async (req, res) => {
  await db.query('DELETE FROM life_domains WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

// Add a metric to a domain
app.post('/api/domains/:id/metrics', auth, async (req, res) => {
  const { name, metric_type, unit, target, period } = req.body;
  if (!name || !target) return res.status(400).json({ error: 'Name and target required' });
  const { rows } = await db.query(
    'INSERT INTO domain_metrics (domain_id, user_id, name, metric_type, unit, target, period) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.params.id, req.user.id, name, metric_type||'number', unit||'', target, period||'monthly']
  );
  res.json(rows[0]);
});

// Log a value for a metric
app.post('/api/domains/metrics/:id/log', auth, async (req, res) => {
  const { value, note } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Value required' });
  // Update current value
  await db.query(
    'UPDATE domain_metrics SET current_value=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3',
    [value, req.params.id, req.user.id]
  );
  // Log entry
  const { rows } = await db.query(
    'INSERT INTO domain_metric_logs (metric_id, user_id, value, note) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, req.user.id, value, note||null]
  );
  res.json(rows[0]);
});

// Delete a metric
app.delete('/api/domains/metrics/:id', auth, async (req, res) => {
  await db.query('DELETE FROM domain_metrics WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});


// ── EXPORT ENDPOINTS ──────────────────────────────────────────────────────────

// Get report data for a period (for both PDF and CSV)
app.get('/api/report', auth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];

    const [user, goals, habits, completions, energy, decisions, checkins] = await Promise.all([
      db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]),
      db.query("SELECT title, progress, target, deadline, category FROM goals WHERE user_id=$1 AND status='active' ORDER BY created_at", [req.user.id]),
      db.query('SELECT id, name, icon, target_type, daily_target FROM habits WHERE user_id=$1 ORDER BY created_at', [req.user.id]),
      db.query('SELECT habit_id, date, value FROM habit_completions WHERE user_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [req.user.id, fromDate, toDate]),
      db.query('SELECT level, logged_at FROM energy_logs WHERE user_id=$1 AND logged_at::date>=$2 AND logged_at::date<=$3 ORDER BY logged_at', [req.user.id, fromDate, toDate]),
      db.query('SELECT decision, alignment, created_at FROM decision_log WHERE user_id=$1 AND created_at::date>=$2 AND created_at::date<=$3 ORDER BY created_at DESC', [req.user.id, fromDate, toDate]),
      db.query('SELECT mood, created_at FROM journal_entries WHERE user_id=$1 AND created_at::date>=$2 AND created_at::date<=$3 ORDER BY created_at', [req.user.id, fromDate, toDate]),
    ]);

    // Calculate habit completion rates
    const habitStats = habits.rows.map(h => {
      const hCompletions = completions.rows.filter(c => c.habit_id === h.id);
      const uniqueDays = [...new Set(hCompletions.map(c => c.date.toISOString().split('T')[0]))];
      const totalDays = Math.ceil((new Date(toDate) - new Date(fromDate)) / (1000*60*60*24)) + 1;
      return {
        ...h,
        completedDays: uniqueDays.length,
        totalDays,
        rate: Math.round((uniqueDays.length / totalDays) * 100)
      };
    });

    const avgEnergy = energy.rows.length > 0
      ? Math.round(energy.rows.reduce((a,e) => a+e.level, 0) / energy.rows.length * 10) / 10
      : null;

    const aligned = decisions.rows.filter(d => d.alignment === 'aligned').length;

    res.json({
      user: user.rows[0],
      period: { from: fromDate, to: toDate },
      goals: goals.rows.map(g => ({
        ...g,
        title: g.title.replace(/^\[.*?\]\s*/, ''),
        pct: Math.round((g.progress / g.target) * 100)
      })),
      habits: habitStats,
      energy: { logs: energy.rows, avg: avgEnergy },
      decisions: { total: decisions.rows.length, aligned, items: decisions.rows },
      checkins: { total: checkins.rows.length, moods: checkins.rows },
    });
  } catch(e) {
    console.error('Report error:', e);
    res.status(500).json({ error: 'Could not generate report' });
  }
});

// CSV Export
app.get('/api/export/csv', auth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];

    const [goals, habits, completions, energy] = await Promise.all([
      db.query("SELECT title, progress, target, deadline FROM goals WHERE user_id=$1", [req.user.id]),
      db.query('SELECT id, name FROM habits WHERE user_id=$1', [req.user.id]),
      db.query('SELECT habit_id, date, value FROM habit_completions WHERE user_id=$1 AND date>=$2 AND date<=$3 ORDER BY date', [req.user.id, fromDate, toDate]),
      db.query('SELECT level, logged_at FROM energy_logs WHERE user_id=$1 AND logged_at::date>=$2 AND logged_at::date<=$3 ORDER BY logged_at', [req.user.id, fromDate, toDate]),
    ]);

    let csv = '';

    // Goals sheet
    csv += 'GOALS\n';
    csv += 'Title,Progress (%),Deadline\n';
    goals.rows.forEach(g => {
      csv += `"${g.title.replace(/^\[.*?\]\s*/, '')}",${Math.round((g.progress/g.target)*100)},"${g.deadline || 'No deadline'}"\n`;
    });

    csv += '\nHABIT COMPLETIONS\n';
    csv += 'Date,' + habits.rows.map(h => '"' + h.name + '"').join(',') + '\n';

    // Build date rows
    const days = [];
    let d = new Date(fromDate);
    const end = new Date(toDate);
    while (d <= end) {
      days.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }
    days.forEach(date => {
      const row = [date];
      habits.rows.forEach(h => {
        const c = completions.rows.find(c => c.habit_id === h.id && c.date.toISOString().split('T')[0] === date);
        row.push(c ? (c.value >= 1 ? 'Yes' : 'No') : 'No');
      });
      csv += row.join(',') + '\n';
    });

    csv += '\nENERGY LOGS\n';
    csv += 'Date,Level (1-5)\n';
    energy.rows.forEach(e => {
      csv += `"${e.logged_at.toISOString().split('T')[0]}",${e.level}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="luhv-report-${fromDate}-to-${toDate}.csv"`);
    res.send(csv);
  } catch(e) {
    console.error('CSV error:', e);
    res.status(500).json({ error: 'Could not generate CSV' });
  }
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
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d.toISOString().split('T')[0]);
    }
    const { rows: habits } = await db.query(
      'SELECT id, name, icon, target_type, daily_target FROM habits WHERE user_id=$1 ORDER BY created_at',
      [req.user.id]
    );
    const { rows: completions } = await db.query(
      'SELECT habit_id, date, value FROM habit_completions WHERE user_id=$1 AND date>=$2 AND date<=$3',
      [req.user.id, days[0], days[6]]
    );
    const result = habits.map(h => ({
      id: h.id, name: h.name, icon: h.icon,
      days: days.map(date => {
        const c = completions.find(c => c.habit_id === h.id && c.date.toISOString().split('T')[0] === date);
        const done = h.target_type === 'check' ? !!c : (c ? c.value >= h.daily_target : false);
        return { date, done, value: c ? c.value : 0 };
      })
    }));
    res.json({ days, habits: result });
  } catch(e) {
    res.status(500).json({ error: 'Could not load weekly habits' });
  }
});

// ── ONBOARDING STATUS ─────────────────────────────────────────────────────────
app.get('/api/onboarding/status', auth, async (req, res) => {
  try {
    const { rows: [user] } = await db.query(
      'SELECT onboarding_data FROM users WHERE id=$1', [req.user.id]
    );
    const data = user?.onboarding_data || null;
    const done = !!(data && Object.keys(data).length > 2);
    res.json({ done, data });
  } catch(e) {
    res.json({ done: false, data: null });
  }
});

// ── ONBOARDING COMPLETE ───────────────────────────────────────────────────────
app.post('/api/onboarding/complete', auth, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'data required' });
    await db.query(
      'UPDATE users SET onboarding_data=$1 WHERE id=$2',
      [JSON.stringify(data), req.user.id]
    );
    if (data.goal_90days && data.goal_90days.trim().length > 3) {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 90);
      try {
        await db.query("INSERT INTO goals (user_id, title, progress, target, deadline, category, status) VALUES ($1,$2,0,100,$3,'Business','active')", [req.user.id, data.goal_90days.trim(), deadline.toISOString().split('T')[0]]);
      } catch(ge) {
        await db.query('INSERT INTO goals (user_id, title, progress, target, deadline) VALUES ($1,$2,0,100,$3)', [req.user.id, data.goal_90days.trim(), deadline.toISOString().split('T')[0]]);
      }
    }
    const name = data.name || 'Champion';
    const stuck = data.stuck_area || 'your goals';
    const obstacle = data.obstacle || 'staying focused';
    const peak = data.peak_hour || '';
    const goal = data.goal_90days || '';
    let msg = `Welcome ${name}! 🏆 Your profile is set up.\n\nYou're working on **${stuck}** and your obstacle is **${obstacle}**. That's where we focus.\n\n`;
    if (peak) msg += `Peak hour: **${peak}** — protect that time.\n\n`;
    if (goal) msg += `✅ 90-day goal created: "${goal}"\n\n`;
    msg += `Let's go from good to great. 🔥`;
    res.json({ success: true, welcomeMessage: msg });
  } catch(e) {
    console.error('Onboarding error detail:', e.message, e.code);
    res.status(500).json({ error: 'Could not complete onboarding', detail: e.message });
  }
});



// ── HABIT DELETE & EDIT ───────────────────────────────────────────────────────
app.delete('/api/habits/:id', auth, async (req, res) => {
  await db.query('DELETE FROM habit_completions WHERE habit_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  await db.query('DELETE FROM habits WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
});

app.patch('/api/habits/:id/name', auth, async (req, res) => {
  const { name, icon, time } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const { rows } = await db.query(
    'UPDATE habits SET name=$1, icon=$2, time=$3 WHERE id=$4 AND user_id=$5 RETURNING *',
    [name.trim(), icon || '⚡', time || null, req.params.id, req.user.id]
  );
  res.json(rows[0] || null);
});

// ── DOMAIN (LIFESTYLE) EDIT ───────────────────────────────────────────────────
app.patch('/api/domains/:id', auth, async (req, res) => {
  const { name, icon, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const { rows } = await db.query(
    'UPDATE life_domains SET name=$1, icon=$2, color=$3 WHERE id=$4 AND user_id=$5 RETURNING *',
    [name.trim(), icon || '⚡', color || '#0ea5e9', req.params.id, req.user.id]
  );
  res.json(rows[0] || null);
});

// ── SUBSCRIPTION & BILLING ────────────────────────────────────────────────────

// Get current tier + token balance
app.get('/api/billing/status', auth, async (req, res) => {
  try {
    const { rows: [user] } = await db.query(
      'SELECT tier, token_balance, stripe_customer_id, billing_period_end FROM users WHERE id=$1',
      [req.user.id]
    );
    const tier = user.tier || 'basic';
    res.json({
      tier,
      tier_name: TIERS[tier]?.name || 'Basic',
      coach_access: TIERS[tier]?.coach_access || false,
      token_balance: user.token_balance || 0,
      billing_period_end: user.billing_period_end,
      token_packs: TOKEN_PACKS.map(p => ({ id: p.id, price_usd: p.price_usd, credits_usd: p.credits_usd, tokens: p.tokens }))
    });
  } catch(e) {
    res.status(500).json({ error: 'Could not fetch billing status' });
  }
});

// Create checkout session for subscription upgrade
app.post('/api/billing/subscribe', auth, async (req, res) => {
  // STRIPE_DISABLED — return coming soon
  return res.json({ checkout_url: null, message: 'Payments coming soon' });
  try {
    const { tier } = req.body;
    if (!TIERS[tier]) return res.status(400).json({ error: 'Invalid tier' });

    const { rows: [user] } = await db.query('SELECT email, name, stripe_customer_id FROM users WHERE id=$1', [req.user.id]);

    // Create or reuse Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { user_id: req.user.id } });
      customerId = customer.id;
      await db.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.user.id]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: TIERS[tier].price_id, quantity: 1 }],
      success_url: process.env.APP_URL + '?upgraded=1',
      cancel_url: process.env.APP_URL + '?upgrade_cancelled=1',
      metadata: { user_id: req.user.id, tier }
    });

    res.json({ checkout_url: session.url });
  } catch(e) {
    console.error('Subscribe error:', e);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// Create checkout session for token pack purchase
app.post('/api/billing/buy-tokens', auth, async (req, res) => {
  // STRIPE_DISABLED
  return res.json({ checkout_url: null, message: 'Payments coming soon' });
  try {
    const { pack_id } = req.body;
    const pack = TOKEN_PACKS.find(p => p.id === pack_id);
    if (!pack) return res.status(400).json({ error: 'Invalid pack' });

    const { rows: [user] } = await db.query('SELECT email, name, stripe_customer_id FROM users WHERE id=$1', [req.user.id]);

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { user_id: req.user.id } });
      customerId = customer.id;
      await db.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customerId, req.user.id]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: pack.stripe_price, quantity: 1 }],
      success_url: process.env.APP_URL + '?tokens_purchased=1',
      cancel_url: process.env.APP_URL + '?purchase_cancelled=1',
      metadata: { user_id: req.user.id, pack_id, tokens: pack.tokens }
    });

    res.json({ checkout_url: session.url });
  } catch(e) {
    console.error('Buy tokens error:', e);
    res.status(500).json({ error: 'Could not create token purchase session' });
  }
});

// Stripe webhook — handles subscription activated + token purchases
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // STRIPE_DISABLED
  return res.json({ received: true });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch(e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).send('Webhook Error');
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata.user_id;

      if (session.mode === 'subscription') {
        // Subscription activated — upgrade tier and give monthly tokens
        const tier = session.metadata.tier;
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.query(
          'UPDATE users SET tier=$1, token_balance=$2, billing_period_end=$3, stripe_subscription_id=$4 WHERE id=$5',
          [tier, TIERS[tier].monthly_tokens, periodEnd.toISOString(), session.subscription, userId]
        );
        console.log(`User ${userId} upgraded to ${tier}`);

      } else if (session.mode === 'payment') {
        // Token pack purchased — add tokens
        const tokens = parseInt(session.metadata.tokens);
        await db.query(
          'UPDATE users SET token_balance = token_balance + $1 WHERE id=$2',
          [tokens, userId]
        );
        console.log(`User ${userId} bought ${tokens} tokens`);
      }
    }

    if (event.type === 'invoice.paid') {
      // Monthly renewal — reset token balance
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const { rows: [user] } = await db.query('SELECT id, tier FROM users WHERE stripe_customer_id=$1', [customerId]);
      if (user && TIERS[user.tier]) {
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.query(
          'UPDATE users SET token_balance=$1, billing_period_end=$2 WHERE id=$3',
          [TIERS[user.tier].monthly_tokens, periodEnd.toISOString(), user.id]
        );
        console.log(`Monthly renewal for user ${user.id} — tokens reset`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      // Subscription cancelled — downgrade to basic
      const sub = event.data.object;
      await db.query(
        'UPDATE users SET tier=$1, token_balance=0 WHERE stripe_subscription_id=$2',
        ['basic', sub.id]
      );
    }

  } catch(e) {
    console.error('Webhook processing error:', e);
  }

  res.json({ received: true });
});

// Cancel subscription
app.post('/api/billing/cancel', auth, async (req, res) => {
  // STRIPE_DISABLED
  return res.json({ success: false, message: 'Payments coming soon' });
  try {
    const { rows: [user] } = await db.query('SELECT stripe_subscription_id FROM users WHERE id=$1', [req.user.id]);
    if (!user.stripe_subscription_id) return res.status(400).json({ error: 'No active subscription' });
    await stripe.subscriptions.update(user.stripe_subscription_id, { cancel_at_period_end: true });
    res.json({ success: true, message: 'Subscription will cancel at end of billing period.' });
  } catch(e) {
    res.status(500).json({ error: 'Could not cancel subscription' });
  }
});


// ── SMART TASK SUGGESTIONS ────────────────────────────────────────────────────
app.post('/api/goals/suggest-tasks', auth, async (req, res) => {
  const { goal } = req.body;
  if (!goal?.trim()) return res.status(400).json({ error: 'Goal required' });
  
  const prompt = `The user's goal is: "${goal}"

Generate 3-5 specific daily tasks that directly lead to achieving this goal.
Use realistic conversion rates and daily minimums. Examples:
- "Get 3 new clients" → outreach 10 prospects/day (10% conversion rate)  
- "Drink more water" → 6 glasses/day at 9am, 1pm, 6pm
- "Lose 5kg" → 30 min exercise daily + log meals
- "Save $500/month" → log every expense daily
- "Read more" → 20 pages before bed

Return ONLY a valid JSON array, no markdown, no explanation:
[
  { "name": "Short action verb + what (max 50 chars)", "icon": "single emoji", "target": null_or_number, "time": null_or_"9:00 AM" }
]`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: 'You are a productivity coach. Return ONLY valid JSON arrays. No markdown. No explanation.',
      messages: [{ role: 'user', content: prompt }]
    });
    
    const raw = response.content[0].text.trim().replace(/```json|```/g, '').trim();
    let tasks = [];
    try {
      tasks = JSON.parse(raw);
      if (!Array.isArray(tasks)) tasks = [];
    } catch(pe) {
      // Try to extract array from response
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        try { tasks = JSON.parse(match[0]); } catch(e2) { tasks = []; }
      }
    }
    
    res.json({ tasks: tasks.slice(0, 5) });
  } catch(e) {
    console.error('Suggest tasks error:', e.message);
    res.status(500).json({ error: 'Could not generate suggestions', detail: e.message });
  }
});

// ── CHAT EXPORT ───────────────────────────────────────────────────────────────
app.get('/api/coach/export', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT role, content, created_at FROM conversations WHERE user_id=$1 ORDER BY created_at ASC', [req.user.id]);
    const { rows: [user] } = await db.query('SELECT name FROM users WHERE id=$1', [req.user.id]);
    let text = 'LUHV+ COACH CONVERSATION\n';
    text += 'User: ' + user.name + '\n';
    text += 'Exported: ' + new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) + '\n';
    text += '---\n\n';
    rows.forEach(msg => {
      const time = new Date(msg.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      text += (msg.role === 'user' ? 'YOU' : 'COACH') + ' (' + time + ')\n' + msg.content + '\n\n';
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="luhv-coach-' + new Date().toISOString().split('T')[0] + '.txt"');
    res.send(text);
  } catch(e) { res.status(500).json({ error: 'Export failed' }); }
});

// ── STARTUP MIGRATIONS ────────────────────────────────────────────────────────
async function runMigrations() {
  const migrations = [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_streak_date DATE',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_data JSONB',
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'basic'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_balance INTEGER DEFAULT 0`,
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_period_end TIMESTAMPTZ',
    `ALTER TABLE goals ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Business'`,
    `ALTER TABLE goals ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
    `ALTER TABLE habits ADD COLUMN IF NOT EXISTS target_type TEXT DEFAULT 'check'`,
    'ALTER TABLE habits ADD COLUMN IF NOT EXISTS daily_target INTEGER DEFAULT 1',
    'ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS energy_level INTEGER',
    'ALTER TABLE habit_completions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NOW()',
    `CREATE TABLE IF NOT EXISTS energy_logs (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5), note TEXT, logged_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS daily_intentions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, intention TEXT NOT NULL, coach_reply TEXT, alignment TEXT, date DATE NOT NULL DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE UNIQUE INDEX IF NOT EXISTS daily_intentions_user_date ON daily_intentions (user_id, date)`,
    `CREATE TABLE IF NOT EXISTS decision_log (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, decision TEXT NOT NULL, context TEXT, coach_reply TEXT, alignment TEXT, foundation TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS coach_sessions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, phase TEXT NOT NULL DEFAULT 'mindset_checkin', phase_index INTEGER NOT NULL DEFAULT 0, responses JSONB NOT NULL DEFAULT '{}', lens TEXT, completed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS life_domains (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, icon TEXT DEFAULT '?', color TEXT DEFAULT '#0ea5e9', domain_type TEXT DEFAULT 'custom', created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS domain_metrics (id SERIAL PRIMARY KEY, domain_id INTEGER REFERENCES life_domains(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, metric_type TEXT DEFAULT 'number', unit TEXT, target NUMERIC, current_value NUMERIC DEFAULT 0, period TEXT DEFAULT 'monthly', updated_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS domain_metric_logs (id SERIAL PRIMARY KEY, metric_id INTEGER, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, value NUMERIC NOT NULL, note TEXT, logged_at TIMESTAMPTZ DEFAULT NOW())`,
  ];
  for (const sql of migrations) {
    try { await db.query(sql); } catch(e) { console.warn('Migration warning:', sql.slice(0,50), e.message); }
  }
  console.log('Migrations complete');
}

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Luhv+ API' }));

runMigrations().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log('Luhv+ API running on port ' + PORT));
});
