/**
 * Catalog management using Ledger for P2P sync
 * Stores site metadata in SQLite CRDT, synced between peers
 */

import { Ledger } from '@drifting-ink/ledger';

let ledger = null;
let changeCallbacks = [];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT DEFAULT '',
    url TEXT DEFAULT '',
    description TEXT DEFAULT '',
    thumbnail TEXT DEFAULT '',
    cached INTEGER DEFAULT 0,
    added_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )
`;

/**
 * Generate a unique ID
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Get current ISO timestamp
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Notify all change listeners
 */
function notifyChange() {
  changeCallbacks.forEach(cb => cb());
}

/**
 * Initialize the catalog with Ledger
 * @param {object} options - { signalingUrl, token }
 */
export async function initCatalog(options = {}) {
  const {
    signalingUrl = 'wss://drifting.ink/ws/signal',
    token = getOrCreateToken()
  } = options;

  ledger = new Ledger({
    dbName: 'scrap_yard',
    signalingUrl
  });

  // Subscribe to sync events
  ledger.on('sync', (count, peerId) => {
    console.log(`Synced ${count} changes from ${peerId}`);
    notifyChange();
  });

  ledger.on('peer-ready', (peerId) => {
    console.log('Peer connected:', peerId);
    notifyChange();
  });

  ledger.on('peer-leave', (peerId) => {
    console.log('Peer disconnected:', peerId);
    notifyChange();
  });

  // Initialize database
  await ledger.init();

  // Create schema
  await ledger.exec(SCHEMA);

  // Enable CRDT sync on sites table
  await ledger.enableSync('sites');

  // Connect to P2P network
  await ledger.connect(signalingUrl, token);

  console.log('Catalog initialized with P2P sync, token:', token);
  return true;
}

/**
 * Get or create a room token from URL hash
 */
function getOrCreateToken() {
  let token = location.hash.slice(1);
  if (!token) {
    token = crypto.randomUUID().slice(0, 8);
    location.hash = token;
  }
  return token;
}

/**
 * Subscribe to catalog changes
 * @param {function} callback
 * @returns {function} Unsubscribe function
 */
export function onCatalogChange(callback) {
  changeCallbacks.push(callback);
  return () => {
    changeCallbacks = changeCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Convert query result rows to site objects
 */
function rowsToSites(result) {
  if (!result || !result.rows) return [];
  const cols = result.columns;
  return result.rows.map(row => {
    const site = {};
    cols.forEach((col, i) => {
      site[col] = row[i];
    });
    return site;
  });
}

/**
 * Get all sites from the catalog
 * @returns {Promise<Array>}
 */
export async function getAllSites() {
  if (!ledger) return [];
  const result = await ledger.exec('SELECT * FROM sites ORDER BY added_at DESC');
  return rowsToSites(result);
}

/**
 * Get a site by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getSite(id) {
  if (!ledger) return null;
  const result = await ledger.exec('SELECT * FROM sites WHERE id = ?', [id]);
  const sites = rowsToSites(result);
  return sites[0] || null;
}

/**
 * Add a new site to the catalog
 * @param {Object} site - Site data {url, name?, description?, thumbnail?}
 * @returns {Promise<Object>} The created site
 */
export async function addSite(site) {
  if (!ledger) throw new Error('Catalog not initialized');

  const now = timestamp();
  const newSite = {
    id: generateId(),
    name: site.name || '',
    url: site.url || '',
    description: site.description || '',
    thumbnail: site.thumbnail || '',
    cached: 0,
    added_at: now,
    updated_at: now
  };

  await ledger.exec(
    `INSERT INTO sites (id, name, url, description, thumbnail, cached, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newSite.id, newSite.name, newSite.url, newSite.description,
     newSite.thumbnail, newSite.cached, newSite.added_at, newSite.updated_at]
  );

  notifyChange();
  return newSite;
}

/**
 * Update a site in the catalog
 * @param {string} id
 * @param {Object} updates
 * @returns {Promise<Object|null>}
 */
export async function updateSite(id, updates) {
  if (!ledger) return null;

  const site = await getSite(id);
  if (!site) return null;

  const now = timestamp();
  const updated = { ...site, ...updates, updated_at: now };

  await ledger.exec(
    `UPDATE sites SET name = ?, url = ?, description = ?, thumbnail = ?,
     cached = ?, updated_at = ? WHERE id = ?`,
    [updated.name, updated.url, updated.description, updated.thumbnail,
     updated.cached, updated.updated_at, id]
  );

  notifyChange();
  return updated;
}

/**
 * Mark a site as cached
 * @param {string} id
 * @param {boolean} cached
 */
export async function setSiteCached(id, cached) {
  return updateSite(id, { cached: cached ? 1 : 0 });
}

/**
 * Remove a site from the catalog
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function removeSite(id) {
  if (!ledger) return false;

  await ledger.exec('DELETE FROM sites WHERE id = ?', [id]);
  notifyChange();
  return true;
}

/**
 * Get sync status
 * @returns {Object} {connected: boolean, peers: number, nodeId: string}
 */
export function getSyncStatus() {
  if (!ledger) {
    return { connected: false, peers: 0, nodeId: null };
  }
  return {
    connected: ledger.isConnected(),
    peers: ledger.getPeers().length,
    nodeId: ledger.getNodeId()
  };
}

/**
 * Check if P2P sync is available
 */
export function isSyncAvailable() {
  return !!ledger;
}

/**
 * Get the current room token
 */
export function getRoomToken() {
  return location.hash.slice(1) || null;
}

/**
 * Disconnect from P2P network
 */
export function disconnect() {
  if (ledger) {
    ledger.disconnect();
  }
}
