# Scrap Yard

A P2P catalog for curating and serving static sites offline.

## Vision

A static web app that acts as a "site manager" for the Scrappy ecosystem. Users can add sites to their catalog, download full copies for offline access, and serve them locally via service worker. The catalog syncs between peers using Ledger.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Scrap Yard                         │
├─────────────────────────────────────────────────────────┤
│  UI Layer (index.html)                                  │
│  - Catalog browser                                      │
│  - Add/edit site entries                                │
│  - Download/serve controls                              │
├─────────────────────────────────────────────────────────┤
│  Catalog Store (Ledger + SQLite CRDT)                   │
│  - Site metadata (name, url, description, thumbnail)    │
│  - P2P sync between peers                               │
├─────────────────────────────────────────────────────────┤
│  Content Store (IndexedDB)                              │
│  - Full site files (HTML, CSS, JS, images)              │
│  - Stored per-site with file paths as keys              │
├─────────────────────────────────────────────────────────┤
│  Service Worker                                         │
│  - Intercepts requests to cached site URLs              │
│  - Serves content from IndexedDB                        │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### Catalog (Ledger/SQLite - synced via P2P)

```sql
CREATE TABLE sites (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT DEFAULT '',
  url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  thumbnail TEXT DEFAULT '',
  cached INTEGER DEFAULT 0,
  added_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);
```

### Content Store (IndexedDB - local only)

```javascript
// Object store: site_files
{
  key: "{site_id}/{file_path}",  // e.g. "abc123/index.html"
  siteId: "abc123",
  path: "index.html",
  contentType: "text/html",
  content: Blob,
  size: 1234,
  cachedAt: "2024-01-01T00:00:00Z"
}
```

## MVP Features

1. **Browse Catalog** - View list of sites with name, URL, description
2. **Add Site** - Enter URL, scrape metadata (title, description)
3. **Remove Site** - Delete from catalog
4. **Cache Site** - Download all files to IndexedDB
5. **Serve Locally** - Service worker serves cached sites at `/local/{site_id}/`
6. **Download ZIP** - Export cached site as downloadable ZIP
7. **P2P Sync** - Catalog metadata syncs between peers via Ledger

## File Structure

```
scrap_yard/
├── index.html          # Main UI
├── app.js              # Application logic
├── persistence.js      # IndexedDB for site files
├── catalog.js          # Ledger integration for catalog
├── scraper.js          # Site downloading logic
├── sw.js               # Service worker for local serving
├── styles.css          # Styling
└── PROJECT.md          # This file
```

## Dependencies

- `@drifting-ink/ledger` - P2P SQLite sync
- `jszip` - ZIP file generation for downloads
- No build step - vanilla JS with ES modules

## Getting Started

```bash
# Serve locally (any static server works)
python3 -m http.server 8080

# Or with npx
npx serve .
```

## Implementation Order

1. Basic HTML/CSS scaffold with catalog UI
2. IndexedDB persistence for site files
3. Site scraping/downloading logic
4. Service worker for local serving
5. Ledger integration for P2P catalog sync
6. ZIP export functionality

## Open Questions

- How deep to crawl when caching? (same-origin only? configurable depth?)
- Handle dynamic sites? (probably just static assets)
- Thumbnail generation? (screenshot API or just favicon?)
- Storage quota management?
