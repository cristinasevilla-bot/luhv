const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// ── DATABASE ─────────────────────────────────────────────────────────────────
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── AI CLIENTS ───────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── JWT ──────────────────────────────────────────────────────────────────────
const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ── KNOWLEDGE BASE ───────────────────────────────────────────────────────────
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
• "I don't remember a version of you that quit — and I never will."
• "That's LUHV+ energy right there 🔥"
• "Step into your next level."
• "No more waiting — it's YOUR time."
• "Lock in. Show up. Win."
• "Let's build leaders — not followers."
`;

// ── GUIDED SESSION PHASES ────────────────────────────────────────────────────
const SESSION_PHASES = [
  {
    id: 'mindset_checkin',
    name: 'Mindset Check-In',
    steps: [
      {
        key: 'welcome',
        coachPrompt: (name) => `Welcome ${name}! I'm your Luhv+ AI Coach — and I'm genuinely excited you're here. This is YOUR space to grow, get clear, and step into the next level of who you're becoming. Before we dive in, I want to ask you something real: On a scale of 1–10, where is your mindset RIGHT NOW — and what's one word that describes how you're feeling today? 💪`,
        processKey: 'mindset_score'
      },
      {
        key: 'fixed_vs_growth',
        coachPrompt: (name, prev) => `I hear you — ${prev.mindset_score}. That's real, and I respect it. Now let me ask you this: When something doesn't go your way — a goal you missed, a plan that fell apart — what's your first instinct? Do you tend to think "I'm just not built for this"... or "What can I learn from this?" Be honest. 🔥`,
        processKey: 'mindset_type'
      },
      {
        key: 'self_talk',
        coachPrompt: (name) => `Good. Awareness is step one — always. Here's what I know: the story you tell yourself when things get hard is EVERYTHING. What's one negative thing you say to yourself on repeat? The one that shows up most when you're stuck or doubting. Let's name it so we can rewrite it. ⚡`,
        processKey: 'negative_self_talk'
      },
      {
        key: 'reframe',
        coachPrompt: (name, prev) => `"${prev.negative_self_talk}" — okay, we're putting that on notice right now. That narrative doesn't get to run the show anymore. Here's your assignment: flip it. How would the MVP version of you reframe that exact thought? What does the GROWTH version of that belief sound like? 🏆`,
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
        coachPrompt: (name) => `${name}, you just did something most people never do — you looked your own mind in the face and chose growth. Now let's go deeper. I want to find your gift — the thing you do that feels effortless to YOU but is transformative to others. Think about it: what do people always come to you for? What do you do that makes time disappear? 💪`,
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
        coachPrompt: (name) => `Here's where it gets exciting, ${name}. Your gift is real. Now let's talk about how you GET PAID for it. I'm going to ask you 4 quick questions — answer honestly and we'll find your Monetization Lens. First one: When you imagine sharing your knowledge, which of these feels most natural to you? (A) Speaking on stage or podcast, (B) Consulting 1-on-1 as a strategist, (C) Building systems and organizing chaos, (D) Executing and delivering results for clients. 🏆`,
        processKey: 'lens_preference'
      },
      {
        key: 'lens_confirm',
        coachPrompt: (name, prev) => `Based on what you said — "${prev.lens_preference}" — your primary lens is showing up. But let me ask this: what kind of work drains you? What's the thing you could do but absolutely hate doing? Knowing what to say NO to is just as powerful as knowing your yes. 💪`,
        processKey: 'energy_drain'
      },
      {
        key: 'first_offer',
        coachPrompt: () => `Perfect. You're getting clear. Now — if you had to launch something in the next 72 hours, what would it be? Don't think about price yet. Just: what's the ONE thing you could offer right now that would genuinely help someone? 🔥`,
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
        coachPrompt: (name) => `${name}, we've gone deep today — and I want you to feel that. You've named your mindset, found your gift, and started seeing how it turns into income. Now I need you to close your eyes for 10 seconds and picture this: it's 12 months from now. You went all in. What does your life look like? What changed? Tell me what you see. 🏆`,
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

// ── COACH SYSTEM PROMPT ──────────────────────────────────────────────────────
const buildCoachSystem = (userContext = '', sessionContext = '', retrievedKbContext = '') => `
You are the Luhv+ AI Coach — voice of the Luhv+ Transformation platform created by Shon Crú-May.

STATIC KNOWLEDGE BASE:
${KNOWLEDGE_BASE}

RETRIEVED KNOWLEDGE BASE CONTEXT:
${retrievedKbContext || 'No additional retrieved KB context available.'}

TONE & VOICE RULES:
- Warm, personal, motivational — like a trusted coach who genuinely believes in you.
- High energy but never fake. Real talk mixed with deep encouragement.
- Use 🔥 🏆 💪 ⚡ emojis naturally (1-2 per message max).
- Short punchy sentences mixed with deeper insight.
- Always end with a challenge, question, or clear next step.
- Never robotic, never generic — always personal. Use the user's name when helpful.
- Keep responses under 5 sentences unless they ask for a detailed plan.
- Draw from the Luhv+ Knowledge Base naturally — don't quote it robotically.
- If retrieved KB context is relevant, prioritize it.
- Do not invent teachings that are not supported by the KB context.
- Never use markdown, asterisks (*), or bold formatting. Plain text only.

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
`;

// ── KB SEMANTIC SEARCH HELPERS ───────────────────────────────────────────────
async function createQueryEmbedding(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536
  });

  return res.data[0].embedding;
}

function inferKbFilter(userMessage = '') {
  const q = userMessage.toLowerCase();

  if (
    q.includes('speak') ||
    q.includes('confidence') ||
    q.includes('presentation') ||
    q.includes('fear') ||
    q.includes('public speaking')
  ) {
    return { category: 'communication' };
  }

  if (
    q.includes('time') ||
    q.includes('focus') ||
    q.includes('productive') ||
    q.includes('productivity') ||
    q.includes('stuck') ||
    q.includes('procrastination') ||
    q.includes('overwhelm')
  ) {
    return { category: 'productivity' };
  }

  if (
    q.includes('accountability') ||
    q.includes('discipline') ||
    q.includes('leader') ||
    q.includes('leadership') ||
    q.includes('consistency')
  ) {
    return { category: 'accountability' };
  }

  return {};
}

async function getRelevantKbChunks(userMessage) {
  try {
    const embedding = await createQueryEmbedding(userMessage);
    const filter = inferKbFilter(userMessage);

    const { rows } = await db.query(
      `
      select *
      from match_kb_chunks($1::extensions.vector, $2::int, $3::float, $4::jsonb)
      `,
      [
        `[${embedding.join(',')}]`,
        6,
        0.72,
        JSON.stringify(filter)
      ]
    );

    return rows || [];
  } catch (error) {
    console.error('KB retrieval error:', error.message);
    return [];
  }
}

function buildKbContext(chunks) {
  if (!chunks.length) {
    return 'No highly relevant KB chunks were found.';
  }

  return chunks
    .map((chunk, i) => {
      const book = chunk.metadata?.book || 'Unknown source';
      const category = chunk.metadata?.category || 'general';
      const similarity = Number(chunk.similarity || 0).toFixed(3);

      return [
        `[KB ${i + 1}]`,
        `Source: ${book}`,
        `Category: ${category}`,
        `Similarity: ${similarity}`,
        chunk.content
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

function extractAnthropicText(response) {
  if (!response || !Array.isArray(response.content)) return '';

  return response.content
    .map((block) => (block && block.type === 'text' && block.text ? block.text : ''))
    .join('\n')
    .trim();
}

// ── SESSION HELPERS ──────────────────────────────────────────────────────────
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
     SET phase = $2,
         phase_index = $3,
         responses = $4,
         lens = $5,
         completed = $6,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
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

// ── SESSION ROUTE ────────────────────────────────────────────────────────────
app.post('/api/coach/session', auth, async (req, res) => {
  try {
    const { message } = req.body;
    const {
      rows: [user]
    } = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);

    let session = await getActiveSession(req.user.id);

    if (!session) {
      session = await createSession(req.user.id);
      const phase = SESSION_PHASES[0];
      const step = phase.steps[0];
      const question = step.coachPrompt(user.name, {});

      return res.json({
        question,
        phase: phase.id,
        phaseName: phase.name,
        step: step.key,
        progress: 0,
        isComplete: false,
        sessionId: session.id
      });
    }

    const phaseIdx = SESSION_PHASES.findIndex((p) => p.id === session.phase);
    const phase = SESSION_PHASES[phaseIdx];
    const stepIdx = session.phase_index;
    const currentStep = phase.steps[stepIdx];

    const responses = { ...session.responses };
    if (message && currentStep) {
      responses[currentStep.processKey] = message;
    }

    let lens = session.lens;
    if (responses.lens_preference && !lens) {
      const lp = responses.lens_preference.toLowerCase();
      if (lp.includes('a') || lp.includes('speak') || lp.includes('stage') || lp.includes('podcast')) lens = 'Paid to Speak';
      else if (lp.includes('b') || lp.includes('consult') || lp.includes('strateg')) lens = 'Paid to Think';
      else if (lp.includes('c') || lp.includes('system') || lp.includes('organ')) lens = 'Paid to Organize';
      else if (lp.includes('d') || lp.includes('execut') || lp.includes('deliver')) lens = 'Paid to Do';
    }

    let nextPhaseIdx = phaseIdx;
    let nextStepIdx = stepIdx + 1;
    let isComplete = false;

    if (nextStepIdx >= phase.steps.length) {
      nextPhaseIdx = phaseIdx + 1;
      nextStepIdx = 0;
    }

    if (nextPhaseIdx >= SESSION_PHASES.length) {
      isComplete = true;
    }

    const nextPhase = isComplete
      ? SESSION_PHASES[SESSION_PHASES.length - 1]
      : SESSION_PHASES[nextPhaseIdx];

    await updateSession(session.id, {
      phase: isComplete ? session.phase : nextPhase.id,
      phase_index: nextStepIdx,
      responses,
      lens,
      completed: isComplete
    });

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: buildCoachSystem(`USER: ${user.name}, Streak: ${user.streak} days`),
        messages: [{ role: 'user', content: summaryPrompt }]
      });

      const finalText = extractAnthropicText(aiRes) || 'Lock in. Show up. Win. 🏆';

      return res.json({
        question: finalText,
        phase: 'complete',
        phaseName: 'Session Complete',
        step: 'done',
        progress: 100,
        isComplete: true,
        lens,
        sessionId: session.id,
        responses
      });
    }

    const nextPhaseObj = SESSION_PHASES[nextPhaseIdx];
    const nextStep = nextPhaseObj.steps[nextStepIdx];

    let question;
    const rawQuestion = nextStep.coachPrompt(user.name, responses);

    if (nextStepIdx === 0 && nextPhaseIdx > phaseIdx) {
      const bridgePrompt = `
The user ${user.name} just finished the "${phase.name}" phase of their coaching session.
Their key answers so far: ${JSON.stringify(responses, null, 2)}
Now smoothly transition into the "${nextPhaseObj.name}" phase by first acknowledging what they shared,
then asking this next question naturally: "${rawQuestion}"
Keep it warm, under 5 sentences, Luhv+ voice.
`;

      const aiRes = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 250,
        system: buildCoachSystem(`USER: ${user.name}`),
        messages: [{ role: 'user', content: bridgePrompt }]
      });

      question = extractAnthropicText(aiRes) || rawQuestion;
    } else {
      question = rawQuestion;
    }

    const totalSteps = SESSION_PHASES.reduce((acc, p) => acc + p.steps.length, 0);
    const completedSteps =
      SESSION_PHASES.slice(0, nextPhaseIdx).reduce((acc, p) => acc + p.steps.length, 0) + nextStepIdx;
    const progress = Math.round((completedSteps / totalSteps) * 100);

    if (message) {
      await db.query(
        'INSERT INTO conversations (user_id, role, content) VALUES ($1,$2,$3), ($1,$4,$5)',
        [req.user.id, 'user', message, 'assistant', question]
      );
    }

    res.json({
      question,
      phase: nextPhaseObj.id,
      phaseName: nextPhaseObj.name,
      step: nextStep.key,
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

// ── GET SESSION STATUS ───────────────────────────────────────────────────────
app.get('/api/coach/session', auth, async (req, res) => {
  try {
    const session = await getActiveSession(req.user.id);
    if (!session) return res.json({ hasActiveSession: false });

    const phaseObj = SESSION_PHASES.find((p) => p.id === session.phase);
    const totalSteps = SESSION_PHASES.reduce((acc, p) => acc + p.steps.length, 0);
    const phaseIdx = SESSION_PHASES.findIndex((p) => p.id === session.phase);
    const completedSteps =
      SESSION_PHASES.slice(0, phaseIdx).reduce((acc, p) => acc + p.steps.length, 0) + session.phase_index;

    res.json({
      hasActiveSession: true,
      sessionId: session.id,
      phase: session.phase,
      phaseName: phaseObj?.name,
      progress: Math.round((completedSteps / totalSteps) * 100),
      lens: session.lens,
      responses: session.responses
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not fetch session' });
  }
});

// ── RESET SESSION ────────────────────────────────────────────────────────────
app.post('/api/coach/session/reset', auth, async (req, res) => {
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

// ── FREE CHAT ────────────────────────────────────────────────────────────────
app.post('/api/coach/chat', auth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const {
      rows: [user]
    } = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);

    const { rows: goals } = await db.query(
      "SELECT title, progress, target FROM goals WHERE user_id=$1 AND status='active'",
      [req.user.id]
    );

    const {
      rows: [latest]
    } = await db.query(
      'SELECT content FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );

    const session = await getActiveSession(req.user.id);

    const userContext = `
USER CONTEXT:
- Name: ${user.name}
- Current streak: ${user.streak} days
- Active goals: ${goals.map((g) => `${g.title} (${Math.round((g.progress / g.target) * 100)}%)`).join(', ') || 'none yet'}
- Latest journal: "${latest?.content?.slice(0, 120) || 'No entries yet'}"
`;

    const sessionContext = session
      ? `
COACHING SESSION CONTEXT:
- Current phase: ${session.phase}
- Identified monetization lens: ${session.lens || 'not yet determined'}
- Key session responses: ${JSON.stringify(session.responses).slice(0, 400)}
`
      : '';

    const kbChunks = await getRelevantKbChunks(message);
    const retrievedKbContext = buildKbContext(kbChunks);

    console.log('KB chunks found:', kbChunks.length);
    console.log('KB sources:', kbChunks.map((c) => c.metadata?.book));

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: buildCoachSystem(userContext, sessionContext, retrievedKbContext),
      messages: [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message }
      ]
    });

    let reply = extractAnthropicText(response);

    if (!reply) {
      console.log('Anthropic raw response:', JSON.stringify(response, null, 2));
      reply = "Let's get this TRIUMPH 🏆 — I'm right here with you!";
    }

    await db.query(
      'INSERT INTO conversations (user_id, role, content) VALUES ($1,$2,$3), ($1,$4,$5)',
      [req.user.id, 'user', message, 'assistant', reply]
    );

    res.json({
      reply,
      sources: kbChunks.map((c) => ({
        book: c.metadata?.book || null,
        category: c.metadata?.category || null,
        similarity: c.similarity
      }))
    });
  } catch (e) {
    console.error('Coach chat error:', e);
    res.status(500).json({ error: 'Coach is temporarily unavailable' });
  }
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
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

  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { password_hash, ...user } = rows[0];
  res.json({ token: sign({ id: user.id }), user });
});

// ── QUOTES ───────────────────────────────────────────────────────────────────
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

// ── HABITS ───────────────────────────────────────────────────────────────────
app.get('/api/habits', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM habits WHERE user_id=$1 ORDER BY created_at',
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/habits', auth, async (req, res) => {
  const { name, time, icon } = req.body;
  const { rows } = await db.query(
    'INSERT INTO habits (user_id, name, time, icon) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, name, time, icon]
  );
  res.json(rows[0]);
});

app.patch('/api/habits/:id/check', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const existing = await db.query(
    'SELECT id FROM habit_completions WHERE habit_id=$1 AND user_id=$2 AND date=$3',
    [req.params.id, req.user.id, today]
  );

  if (existing.rows[0]) {
    await db.query('DELETE FROM habit_completions WHERE id=$1', [existing.rows[0].id]);
    return res.json({ done: false });
  }

  await db.query(
    'INSERT INTO habit_completions (habit_id, user_id, date) VALUES ($1,$2,$3)',
    [req.params.id, req.user.id, today]
  );

  await db.query('UPDATE users SET streak = streak + 1 WHERE id=$1', [req.user.id]);
  res.json({ done: true });
});

// ── GOALS ────────────────────────────────────────────────────────────────────
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

// ── JOURNAL ──────────────────────────────────────────────────────────────────
app.get('/api/journal', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
    [req.user.id]
  );
  res.json(rows);
});

app.post('/api/journal', auth, async (req, res) => {
  const { title, content, mood } = req.body;
  const { rows } = await db.query(
    'INSERT INTO journal_entries (user_id, title, content, mood) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, title, content, mood]
  );
  res.json(rows[0]);
});

app.get('/api/journal/prompt', auth, async (req, res) => {
  const prompts = [
    "What's one belief that's been holding you back, and how can you start rewriting it today?",
    'Describe your ideal life 5 years from now in vivid detail.',
    "What would you do today if you knew you couldn't fail?",
    'List 3 wins from this week, no matter how small.',
    'Who do you need to become to achieve your biggest goal?',
    "What's one habit the MVP version of you does every single day?",
    'Where are you playing small — and what would it look like to go all in?'
  ];

  const idx = Math.floor(Date.now() / 86400000) % prompts.length;
  res.json({ prompt: prompts[idx] });
});

// ── ADMIN ────────────────────────────────────────────────────────────────────
const adminAuth = async (req, res, next) => {
  auth(req, res, async () => {
    try {
      const {
        rows: [user]
      } = await db.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);

      if (!user?.is_admin) return res.status(403).json({ error: 'Admins only' });
      next();
    } catch (e) {
      res.status(500).json({ error: 'Admin auth failed' });
    }
  });
};

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const [users, active, convs, streak, sessions] = await Promise.all([
    db.query('SELECT COUNT(*) FROM users'),
    db.query("SELECT COUNT(*) FROM users WHERE last_active > NOW() - INTERVAL '1 day'"),
    db.query('SELECT COUNT(*) FROM conversations'),
    db.query('SELECT ROUND(AVG(streak)) FROM users'),
    db.query('SELECT COUNT(*) FROM coach_sessions WHERE completed = true')
  ]);

  res.json({
    totalUsers: +users.rows[0].count,
    activeToday: +active.rows[0].count,
    totalConvs: +convs.rows[0].count,
    avgStreak: +streak.rows[0].round,
    completedSessions: +sessions.rows[0].count
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
    SELECT c.*, u.name as user_name
    FROM conversations c
    JOIN users u ON c.user_id = u.id
    ORDER BY c.created_at DESC
    LIMIT 50
  `);
  res.json(rows);
});

app.get('/api/admin/sessions', adminAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT s.*, u.name as user_name
    FROM coach_sessions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC
    LIMIT 100
  `);
  res.json(rows);
});

// ── HEALTH ───────────────────────────────────────────────────────────────────
app.get('/health', async (_, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'Luhv+ API' });
  } catch (e) {
    res.status(500).json({ status: 'error', service: 'Luhv+ API' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏆 Luhv+ API running on port ${PORT}`);
});
