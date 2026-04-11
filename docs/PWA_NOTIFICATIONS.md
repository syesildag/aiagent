# PWA Notifications

## Overview

The XMLTV viewer supports programme reminder notifications that fire even when the browser is backgrounded or the device is locked. This is achieved through a two-layer architecture:

| Layer | When it fires | Requires |
|---|---|---|
| **Web Push (server-side)** | Always — app can be fully closed | VAPID keys in `.env` |
| **SW setTimeout (client-side)** | Page is open or browser keeps SW alive | Nothing extra |

The Web Push layer is the Android fix. Android Chrome aggressively kills service workers after a few minutes of inactivity, which destroys any pending `setTimeout` callbacks. Web Push routes messages through Google's FCM infrastructure, which can wake the service worker at the correct moment regardless of app state.

On desktop (macOS, Windows, Linux) both layers are active. The SW timeout typically fires first; the server push acts as a safety net.

## Architecture

```
User enables notification
  ├─ Frontend: PushManager.subscribe() → POST /xmltv/push-subscribe (store subscription)
  ├─ Frontend: POST /xmltv/push-schedule (store scheduled row in DB)
  └─ Frontend: SW postMessage SCHEDULE_NOTIFICATION (local setTimeout fallback)

Every minute (server)
  └─ XmltvPushNotificationJob
       └─ SELECT due notifications → web-push.sendNotification() → DELETE row

Service Worker (push event)
  └─ self.registration.showNotification()
```

## Setup

### 1. Generate VAPID Keys

Run once. The script generates a key pair and writes all three variables directly into `.env`:

```bash
npm run vapid:generate
```

Options:

| Flag | Description |
|---|---|
| `--subject <uri>` | Override `VAPID_SUBJECT` (default: `mailto:admin@example.com`) |
| `--force` | Regenerate even if keys already exist — existing browsers must re-subscribe |
| `--env <path>` | Path to `.env` file (default: `.env` in project root) |

Example with a custom subject:

```bash
npm run vapid:generate -- --subject mailto:ops@yoursite.com
```

The resulting `.env` entries:

```bash
VAPID_PUBLIC_KEY=BExamplePublicKey...
VAPID_PRIVATE_KEY=ExamplePrivateKey...
VAPID_SUBJECT=mailto:ops@yoursite.com
```

`VAPID_SUBJECT` must be a `mailto:` or `https:` URI. Push services use it to contact you if your subscription causes problems.

> **Warning:** Regenerating keys (`--force`) invalidates all existing push subscriptions. Users must re-enable notifications in the XMLTV viewer.

### 3. Run Migration

```bash
npm run migrate
```

This creates two tables:

| Table | Purpose |
|---|---|
| `ai_agent_push_subscriptions` | One row per subscribed browser/device |
| `ai_agent_scheduled_push_notifications` | Pending notifications; rows deleted after delivery |

### 4. Build and Start

```bash
npm run build:all && npm start
```

## How It Works

### Subscription Flow

On page load the frontend calls `GET /xmltv/vapid-public-key`. If VAPID is configured, it calls `PushManager.subscribe()` and posts the resulting endpoint + encryption keys to `POST /xmltv/push-subscribe`. The subscription is stored once and reused for all future notifications from that browser.

### Scheduling Flow

When the user enables a reminder for a programme:

1. The frontend POSTs `{ id, endpoint, title, body, fireAt }` to `POST /xmltv/push-schedule`.
2. `XmltvPushNotificationJob` runs every minute and queries:
   ```sql
   SELECT * FROM ai_agent_scheduled_push_notifications WHERE fire_at <= NOW()
   ```
3. For each due row the job calls `webPush.sendNotification()`, then deletes the row.
4. The service worker's `push` event handler calls `self.registration.showNotification()`.

### Cancellation

Cancelling a reminder calls `DELETE /xmltv/push-schedule/:id` on the server and also sends a `CANCEL_NOTIFICATION` postMessage to the SW to clear the local timeout.

### Stale Subscription Cleanup

When a push delivery returns HTTP 410 (Gone) or 404, the subscription has been revoked by the user or expired. The job automatically deletes it from `ai_agent_push_subscriptions`.

## Graceful Degradation

If `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are not set:

- `GET /xmltv/vapid-public-key` returns `{ "publicKey": null }`
- The frontend skips `PushManager.subscribe()` entirely
- `XmltvPushNotificationJob` skips all work silently
- The existing SW `setTimeout` approach remains active (works on desktop)

No error is thrown and no functionality is broken on platforms where the SW lifecycle is permissive.

## API Reference

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/xmltv/vapid-public-key` | — | Returns `{ publicKey: string \| null }` |
| `POST` | `/xmltv/push-subscribe` | `{ endpoint, p256dh, auth }` | Upsert a push subscription |
| `POST` | `/xmltv/push-schedule` | `{ id, endpoint, title, body, icon?, url?, fireAt }` | Schedule a notification |
| `DELETE` | `/xmltv/push-schedule/:id` | — | Cancel a scheduled notification |

`fireAt` must be an ISO 8601 timestamp string.

## Key Files

| File | Role |
|---|---|
| `src/jobs/xmltvPushNotificationJob.ts` | Minute-interval job that delivers due push notifications |
| `src/entities/ai-agent-push-subscription.ts` | Entity + repository for browser subscriptions |
| `src/entities/ai-agent-scheduled-push-notification.ts` | Entity + repository with `findDue(now)` query |
| `src/routes/xmltv.ts` | Push-related API endpoints |
| `src/frontend/pwa/sw.js` | Service worker `push` event handler |
| `src/frontend/xmltv/XmltvViewer.tsx` | Push subscription + schedule/cancel logic |
| `database/migrations/012_push_subscriptions.sql` | Creates the two push tables |

## Related Documentation

- [Configuration](CONFIGURATION.md) — VAPID environment variables
- [Job System](JOB_SYSTEM.md) — How scheduled jobs work
- [DB Job System](DB_JOB_SYSTEM.md) — DB-backed jobs and runtime toggling
