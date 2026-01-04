# Scrap Yard

P2P catalog for curating and serving static sites offline.

## Features

- **Upload static sites** - Drop a folder to add a site to your local catalog
- **P2P catalog sync** - Site metadata syncs automatically between peers via CRDT
- **Explicit file transfer** - Files only transfer when you explicitly import from a peer
- **Offline browsing** - Service worker serves cached sites at `/local/{siteId}/`
- **Download as ZIP** - Export any cached site as a ZIP file

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
├─────────────────────────────────────────────────────────────┤
│  app.js          │  catalog.js        │  transfer.js        │
│  (UI)            │  (Ledger/CRDT)     │  (File Transfer)    │
├──────────────────┼────────────────────┼─────────────────────┤
│                  │     Ledger         │                     │
│                  │  ┌──────────────┐  │                     │
│  persistence.js  │  │ cr-sqlite    │  │  Custom Messages    │
│  (IndexedDB)     │  │ WebRTC Sync  │◄─┼──(file-transfer)    │
│                  │  └──────────────┘  │                     │
├──────────────────┴────────────────────┴─────────────────────┤
│                      Service Worker                          │
│                   (serves /local/{id}/)                      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Catalog (metadata)** - Syncs via Ledger's CRDT. All peers see all sites.
2. **Files (content)** - Stored locally in IndexedDB. Only transferred on explicit import.
3. **Custom messages** - File transfer uses Ledger's WebRTC channels for P2P requests.

## Usage

1. Start a local server: `npx serve .`
2. Open in browser, note the URL hash (room token)
3. Share URL with peers to sync catalogs
4. Add sites by dropping folders
5. Import sites from peers by clicking "Available from Peers"

## Files

- `index.html` - Main UI
- `app.js` - Application logic
- `catalog.js` - Ledger integration for P2P catalog sync
- `transfer.js` - P2P file transfer via Ledger custom messages
- `persistence.js` - IndexedDB storage for site files
- `sw.js` - Service worker for offline site serving
- `ledger.js` - Built Ledger library with custom message support

## Dependencies

- [@drifting-ink/ledger](../rtc_battery) - P2P SQLite CRDT sync
- [@vlcn.io/crsqlite-wasm](https://github.com/vlcn-io/cr-sqlite) - CRDT-enabled SQLite

## Schema Versioning

Database is versioned (`scrap_yard_v{N}`). Increment `DB_VERSION` in `catalog.js` when changing schema.
