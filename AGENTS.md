# Scrap Yard - Agent Guide

## Project Overview

Scrap Yard is a P2P static site catalog. Users upload site folders locally, metadata syncs via CRDT, and files transfer explicitly on import.

## Key Architecture Decisions

### Two-Layer Sync Model
- **Catalog (metadata)**: Syncs automatically via Ledger CRDT - all peers see all sites
- **Files (content)**: Never auto-sync. Only transfer when user explicitly imports from a peer

### Ledger Integration
- Uses `@drifting-ink/ledger` (local build in `ledger.js`) for P2P SQLite CRDT
- Custom messages added for file transfer: `ledger.sendCustom(peerId, 'file-transfer', data)`
- Database versioned as `scrap_yard_v{N}` - increment `DB_VERSION` when schema changes

### File Transfer Protocol
Messages on the `file-transfer` channel:
- `file-list-request` / `file-list` - Get list of files for a site
- `file-request` / `file-start` / `file-chunk` / `file-end` - Transfer individual files
- Files chunked at 64KB, base64 encoded for JSON transport

## File Structure

```
index.html      - UI with modals for add/import/detail
app.js          - Main app logic, event handlers
catalog.js      - Ledger setup, site CRUD, peer events
transfer.js     - File transfer via Ledger custom messages
persistence.js  - IndexedDB for file storage
sw.js           - Service worker for /local/{siteId}/ serving
ledger.js       - Built Ledger with custom message support
```

## Database Schema

```sql
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT,
  url TEXT,
  description TEXT,
  thumbnail TEXT,
  owner_id TEXT,      -- Node ID of creator
  file_count INTEGER,
  file_size INTEGER,
  added_at TEXT,
  updated_at TEXT
)
```

## Common Tasks

### Adding a new catalog field
1. Add to SCHEMA in `catalog.js`
2. Increment `DB_VERSION`
3. Update relevant queries and UI

### Modifying file transfer
- All logic in `transfer.js`
- Uses `getLedger().sendCustom()` for messaging
- Handle new message types in `handleTransferMessage()`

### Rebuilding Ledger
```bash
cd ../rtc_battery && npm run build
cp dist/ledger.js ../scrap_yard/
```
