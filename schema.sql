-- ============================================================
--  LUHV+ DATABASE SCHEMA
--  Run this in Supabase SQL editor (or any Postgres)
-- ============================================================

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  streak        INTEGER DEFAULT 0,
  coins         INTEGER DEFAULT 0,
  is_admin      BOOLEAN DEFAULT FALSE,
  last_active   TIMESTAMP DEFAULT NOW(),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- QUOTES  (coach manages these from admin panel)
CREATE TABLE IF NOT EXISTS quotes (
  id         SERIAL PRIMARY KEY,
  text       TEXT NOT NULL,
  author     VARCHAR(100) DEFAULT '— Luhv+ Coach',
  active     BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed with coach's signature phrases
INSERT INTO quotes (text, author) VALUES
  ('You are the MVP in your life — act like it. 🏆', '— Luhv+ Coach'),
  ('You''re the cream of the crop. Now go prove it.', '— Luhv+ Coach'),
  ('I don''t remember a version of you that quit — and I never will. 🔥', '— Luhv+ Coach'),
  ('Step into your next level. No more waiting — it''s YOUR time. ⚡', '— Luhv+ Coach'),
  ('The secret of getting ahead is getting started.', '— Mark Twain'),
  ('Lock in. Show up. Win.', '— Luhv+ Coach'),
  ('You don''t have to be great to start, but you have to start to be great.', '— Zig Ziglar');

-- HABITS
CREATE TABLE IF NOT EXISTS habits (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  time       VARCHAR(20),
  icon       VARCHAR(10) DEFAULT '⚡',
  created_at TIMESTAMP DEFAULT NOW()
);

-- HABIT COMPLETIONS  (one row per day per habit)
CREATE TABLE IF NOT EXISTS habit_completions (
  id       SERIAL PRIMARY KEY,
  habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
  user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date     DATE NOT NULL,
  UNIQUE(habit_id, user_id, date)
);

-- GOALS
CREATE TABLE IF NOT EXISTS goals (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(150) NOT NULL,
  target     INTEGER DEFAULT 100,
  progress   INTEGER DEFAULT 0,
  unit       VARCHAR(30) DEFAULT '%',
  deadline   DATE,
  status     VARCHAR(20) DEFAULT 'active',  -- active | done | paused
  created_at TIMESTAMP DEFAULT NOW()
);

-- JOURNAL ENTRIES
CREATE TABLE IF NOT EXISTS journal_entries (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(200),
  content    TEXT NOT NULL,
  mood       VARCHAR(30) DEFAULT 'neutral',  -- energized | focused | grateful | reflective | neutral
  created_at TIMESTAMP DEFAULT NOW()
);

-- CONVERSATIONS  (AI Coach chat history)
CREATE TABLE IF NOT EXISTS conversations (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(10) NOT NULL,  -- user | assistant
  content    TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- INDEX for fast conversation lookups
CREATE INDEX idx_conversations_user ON conversations(user_id, created_at DESC);
CREATE INDEX idx_journal_user ON journal_entries(user_id, created_at DESC);
