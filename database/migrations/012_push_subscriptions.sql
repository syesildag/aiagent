-- Web Push subscriptions – one row per browser/device that opted in
CREATE TABLE IF NOT EXISTS ai_agent_push_subscriptions (
  id         SERIAL PRIMARY KEY,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notifications scheduled by the XMLTV viewer to fire at a future time.
-- A server-side job reads this table every minute and sends the push message,
-- then deletes the row.
CREATE TABLE IF NOT EXISTS ai_agent_scheduled_push_notifications (
  id         TEXT        PRIMARY KEY,
  endpoint   TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  icon       TEXT,
  url        TEXT,
  fire_at    TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_push_fire_at
  ON ai_agent_scheduled_push_notifications (fire_at);
