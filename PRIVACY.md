# Privacy

The Blogs Are Back desktop app collects a small amount of anonymous telemetry. This document describes exactly what is collected, why, and what we'll never do with it.

## What we collect

The app sends a single heartbeat to `blogsareback.com` once every 24 hours (and once on launch). The payload contains:

### App & environment info
- **Installation ID** — a random UUID generated locally, not tied to any account or identity
- **App version**, Electron version, platform (macOS/Windows/Linux), architecture (arm64/x64), OS version
- **Install date**
- **Heartbeat reason** — whether this was triggered by launch, an update, or the 24-hour interval

### Session metrics
- **Session duration** and **focus duration** — how long the app has been open and in the foreground
- **Memory usage** — heap size in MB
- **Crash count** — number of uncaught errors this session

### Usage statistics (aggregate counts, not content)
- **Operation counts** — how many feed fetches, page fetches, readability extractions, and TTS generations have occurred (today, last 7 days, last 30 days, lifetime)
- **Success/error rates** and error categories (network, timeout, server, etc.)
- **Engagement counters** — total counts of: notifications shown, notification clicks, posts saved, TTS generated, deep links opened, feeds refreshed

### Feature usage
- **Desktop settings** — which toggles are enabled (badge, notifications, background updates, tray, auto-updates, launch at login, etc.)
- **Blog counts** — number of followed blogs and custom blogs (just the count, not the blogs themselves)
- **Saved posts count** — just the number, not the content or URLs

## What we don't collect

- No account information, email addresses, or login credentials
- No feed URLs, blog names, or post content
- No browsing history or reading habits
- No IP-based location tracking or fingerprinting
- No third-party analytics or advertising SDKs

## What we use it for

- Understanding which platforms and versions are in active use, so we know what to support
- Spotting error spikes (e.g., "feed fetches started failing for Linux users after v0.1.3")
- Knowing which features are actually used vs. ignored
- Basic health metrics so we can catch regressions

## What we'll never do

- Sell or share this data with anyone
- Use it to identify individual users
- Use it to personalize or alter your experience
- Combine it with data from other sources

## Error reporting

The app uses [Sentry](https://sentry.io) for crash reporting in production builds. Sentry receives error stack traces and the installation ID (the same random UUID). It does not receive feed content, URLs, or personal information. Sentry is not active in development builds.

## Source code

The telemetry implementation is fully visible in the source:
- [`src/main/telemetry.ts`](src/main/telemetry.ts) — heartbeat payload and scheduling
- [`src/main/analytics.ts`](src/main/analytics.ts) — operation tracking
- [`src/main/engagement.ts`](src/main/engagement.ts) — engagement counters
- [`src/main/session-tracker.ts`](src/main/session-tracker.ts) — session metrics
