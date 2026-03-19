# Luhv+ Backend API

Node.js + Express backend for the Luhv+ motivational app.

## Stack
- **Runtime**: Node.js 18+
- **Framework**: Express
- **Database**: PostgreSQL via Supabase
- **AI**: Claude API (Anthropic) — with coach personality built in
- **Auth**: JWT + bcrypt
- **Deploy**: Render.com

---

## Deploy in 5 steps

### 1. Set up Supabase (database)
1. Go to [supabase.com](https://supabase.com) → New project
2. Open **SQL Editor** → paste contents of `schema.sql` → Run
3. Copy your **Connection String** from Settings → Database

### 2. Get your Anthropic API key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. API Keys → Create new key

### 3. Push to GitHub
```bash
git init
git add .
git commit -m "Luhv+ API initial commit"
gh repo create luhv-plus-api --public --push
```

### 4. Deploy on Render
1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Build command**: `npm install`
   - **Start command**: `npm start`
4. Environment variables (paste from `.env.example`):
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `ANTHROPIC_API_KEY`
5. Click **Deploy** — done in ~2 minutes ✅

### 5. Test it
```bash
curl https://your-app.onrender.com/health
# → {"status":"ok","service":"Luhv+ API"}
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | — | Register new user |
| POST | `/api/auth/login` | — | Login → returns JWT |
| GET | `/api/quotes/today` | — | Daily quote |
| GET | `/api/habits` | ✅ | User's habits |
| PATCH | `/api/habits/:id/check` | ✅ | Toggle habit done |
| GET | `/api/goals` | ✅ | User's goals |
| POST | `/api/goals` | ✅ | Create goal |
| GET | `/api/journal` | ✅ | Journal entries |
| POST | `/api/journal` | ✅ | New entry |
| POST | `/api/coach/chat` | ✅ | AI Coach message |
| GET | `/api/admin/stats` | 🔐 | Platform stats |
| GET | `/api/admin/users` | 🔐 | All users |
| POST | `/api/quotes` | 🔐 | Add quote |
| DELETE | `/api/quotes/:id` | 🔐 | Delete quote |

✅ = requires `Authorization: Bearer <token>` header  
🔐 = requires admin JWT

---

## Coach Personality

The AI Coach is powered by Claude with a custom system prompt that captures the coach's voice. Edit the `COACH_VOICE` constant in `server.js` to add more signature phrases as you learn the coach's style. When ready, this becomes the **Knowledge Base** — just expand the system prompt with more content, transcripts, or examples.
