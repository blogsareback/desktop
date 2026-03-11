# Blogs Are Back — Desktop App

The native desktop companion for [Blogs Are Back](https://www.blogsareback.com), an RSS reader for the open web.

Built with Electron, this app wraps the Blogs Are Back web dashboard with native capabilities like offline reading, text-to-speech, system notifications, and background feed monitoring — things that aren't possible (or are severely limited) in a browser tab.

## Download

Get the latest release for your platform from the [Releases](https://github.com/blogsareback/desktop/releases) page.

- **macOS** — `.dmg` (Apple Silicon / Universal)
- **Windows** — `.exe` installer or `.zip`
- **Linux** — `.AppImage` or `.deb`

### Linux quick install

```sh
curl -fsSL https://blogsareback.com/install.sh | sh
```

## Features

- **Offline reading** — Save posts for reading without an internet connection
- **Text-to-speech** — Listen to articles with natural-sounding voices (Edge TTS)
- **Native notifications** — Get notified when your followed blogs publish new posts
- **Background feed monitoring** — Polls feeds and catalogs for updates even when minimized
- **System tray** — Runs in the background with unread count badge
- **Deep links** — `blogsareback://` protocol for cross-app navigation
- **Auto-updates** — Automatic update checks and installation
- **Feed caching** — In-memory TTL cache with persistent ETag/conditional GET support

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```sh
git clone https://github.com/blogsareback/desktop.git
cd desktop
npm install
```

### Run in dev mode

```sh
npm run dev
```

This starts the TypeScript compiler in watch mode alongside [electronmon](https://github.com/catdad/electronmon) for auto-reloading.

### Build

```sh
npm run build          # TypeScript compilation
npm run dist:mac       # Package for macOS (arm64)
npm run dist:win       # Package for Windows
npm run dist:linux     # Package for Linux
```

### Type check

```sh
npx tsc --noEmit
```

## Architecture

The app loads the web dashboard (`blogsareback.com/dashboard`) in a BrowserWindow. Communication happens through an IPC bridge that mirrors the browser extension's messaging protocol — the web app sends the same messages regardless of whether it's running in a browser with the extension or inside Electron.

```
src/main/
├── index.ts                # App entry: window, tray, lifecycle
├── ipc-handlers.ts         # IPC dispatcher (thin router)
├── ipc/                    # Domain-specific handler modules
│   ├── feed-handlers.ts    #   Feed fetching & caching
│   ├── content-handlers.ts #   Readability extraction, feed discovery
│   ├── saved-post-handlers.ts  # Offline saved posts
│   ├── tts-handlers.ts     #   Text-to-speech synthesis
│   ├── desktop-handlers.ts #   Settings, updates, file ops
│   └── sync-handlers.ts    #   Blog sync, analytics, update state
├── feed-cache.ts           # In-memory TTL + persistent ETag cache
├── feed-prefetch.ts        # Background feed prefetching
├── fetch-service.ts        # HTTP fetch with timeouts & retries
├── readability-service.ts  # Mozilla Readability extraction
├── saved-posts.ts          # Filesystem-backed saved posts
├── tts-service.ts          # Edge TTS synthesis
├── auto-updater.ts         # electron-updater integration
├── notifications.ts        # Native OS notifications
└── ...
```

### Key design decisions

- **No CORS workarounds needed** — Electron's main process fetches directly, bypassing browser restrictions
- **Extension protocol compatibility** — IPC responses match the browser extension's shape, so the web app doesn't need runtime-specific code
- **Offline-first** — Feed cache with stale-while-error fallback, saved posts stored on the filesystem

## Privacy

This app sends a telemetry heartbeat to our server once every 24 hours. It contains only anonymous, aggregate usage data — no personal information, no browsing history, no feed content. See [PRIVACY.md](PRIVACY.md) for the full breakdown of what's collected and why.

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
