const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

const COACH_VOICE = `
You are the Luhv+ AI Coach — you speak EXACTLY like this coach:

SIGNATURE PHRASES (use them naturally, don't force all of them):
- "You are the MVP in your life"
- "You're the cream of the crop"
- "Let's get this TRIUMPH 🏆"
- "I don't remember a version of you that quit — and I never will"
- "That's LUHV+ energy right there 🔥"
- "Step into your next level"
- "No more waiting — it's YOUR time"
- "Lock in. Show up. Win."

TONE RULES:
- High energy, direct, like a hype coach talking to a friend
- Use 🔥 🏆 💪 ⚡ emojis naturally (1-2 per message max)
- Short punchy sentences mixed with deeper insight
- Always end with a challenge or question to keep them moving
- Never robotic, never generic — always personal

CONTEXT:
- You know the user's name, streak, goals and recent journal entries
- Reference their data when relevant
- Keep responses under 4 sentences unless they ask for a detailed plan
`;

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
  const { rows } = await db.query('INSERT INTO quotes (text, author) VALUES ($1,$2) RETURNING *', [text, author]);
  res.json(rows[0]);
});

app.delete('/api/quotes/:id', auth, async (req, res) => {
  await db.query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/habits', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM habits WHERE user_id=$1 ORDER BY created_at', [req.user.id]);
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
    res.json({ done: false });
  } else {
    await db.query('INSERT INTO habit_completions (habit_id, user_id, date) VALUES ($1,$2,$3)', [req.params.id, req.user.id, today]);
    await db.query('UPDATE users SET streak = streak + 1 WHERE id=$1', [req.user.id]);
    res.json({ done: true });
  }
});

app.get('/api/goals', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM goals WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
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

app.post('/api/coach/chat', auth, async (req, res) => {
  const { message, history = [] } = req.body;
  const { rows: [user] }   = await db.query('SELECT name, streak FROM users WHERE id=$1', [req.user.id]);
  const { rows: goals }    = await db.query("SELECT title, progress, target FROM goals WHERE user_id=$1 AND status='active'", [req.user.id]);
  const { rows: [latest] } = await db.query('SELECT content FROM journal_entries WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);

  const userContext = `
USER CONTEXT:
- Name: ${user.name}
- Current streak: ${user.streak} days
- Active goals: ${goals.map(g => `${g.title} (${Math.round((g.progress/g.target)*100)}%)`).join(', ') || 'none yet'}
- Latest journal: "${latest?.content?.slice(0, 120) || 'No entries yet'}"
`;

  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message }
  ];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: COACH_VOICE + '\n\n' + userContext,
      messages,
    });
    const reply = response.content[0].text;
    await db.query(
      'INSERT INTO conversations (user_id, role, content) VALUES ($1,$2,$3), ($1,$4,$5)',
      [req.user.id, 'user', message, 'assistant', reply]
    );
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Coach is temporarily unavailable' });
  }
});

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only' });
    next();
  });
};

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const [users, active, convs, streak] = await Promise.all([
    db.query('SELECT COUNT(*) FROM users'),
    db.query("SELECT COUNT(*) FROM users WHERE last_active > NOW() - INTERVAL '1 day'"),
    db.query('SELECT COUNT(*) FROM conversations'),
    db.query('SELECT ROUND(AVG(streak)) FROM users'),
  ]);
  res.json({
    totalUsers:  +users.rows[0].count,
    activeToday: +active.rows[0].count,
    totalConvs:  +convs.rows[0].count,
    avgStreak:   +streak.rows[0].round,
  });
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  const { rows } = await db.query('SELECT id, name, email, streak, last_active, created_at FROM users ORDER BY created_at DESC');
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

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'Luhv+ API' }));

app.listen(PORT, '0.0.0.0', () => console.log(`🏆 Luhv+ API running on port ${PORT}`));
