/**
 * Catalog management using Ledger for P2P sync
 * Stores site metadata in SQLite CRDT, synced between peers
 * Files are stored locally - must be explicitly requested from peers
 */

import { Ledger } from '@drifting-ink/ledger';

// Database version - increment when schema changes
const DB_VERSION = 3;

let ledger = null;
let changeCallbacks = [];
let peerCallbacks = [];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT DEFAULT '',
    url TEXT DEFAULT '',
    description TEXT DEFAULT '',
    thumbnail TEXT DEFAULT '',
    owner_id TEXT DEFAULT '',
    content_hash TEXT DEFAULT '',
    file_count INTEGER DEFAULT 0,
    file_size INTEGER DEFAULT 0,
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
 * Notify peer change listeners
 */
function notifyPeerChange() {
  peerCallbacks.forEach(cb => cb());
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
    dbName: `scrap_yard_v${DB_VERSION}`,
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
    notifyPeerChange();
  });

  ledger.on('peer-leave', (peerId) => {
    console.log('Peer disconnected:', peerId);
    notifyChange();
    notifyPeerChange();
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
  console.log('Node ID:', ledger.getNodeId());
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
 * Subscribe to peer changes (connect/disconnect)
 * @param {function} callback
 * @returns {function} Unsubscribe function
 */
export function onPeerChange(callback) {
  peerCallbacks.push(callback);
  return () => {
    peerCallbacks = peerCallbacks.filter(cb => cb !== callback);
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
 * Get all sites from the catalog (both mine and peers')
 * @returns {Promise<Array>}
 */
export async function getAllSites() {
  if (!ledger) return [];
  const result = await ledger.exec('SELECT * FROM sites ORDER BY added_at DESC');
  return rowsToSites(result);
}

/**
 * Get only my sites (sites I own)
 * @returns {Promise<Array>}
 */
export async function getMySites() {
  if (!ledger) return [];
  const myId = ledger.getNodeId();
  const result = await ledger.exec(
    'SELECT * FROM sites WHERE owner_id = ? ORDER BY added_at DESC',
    [myId]
  );
  return rowsToSites(result);
}

/**
 * Get available sites from peers (sites I don't own)
 * @returns {Promise<Array>}
 */
export async function getAvailableSites() {
  if (!ledger) return [];
  const myId = ledger.getNodeId();
  const result = await ledger.exec(
    "SELECT * FROM sites WHERE owner_id != ? AND owner_id != '' ORDER BY added_at DESC",
    [myId]
  );
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
 * Add a new site to the catalog (owned by me)
 * @param {Object} site - Site data {name, description?, fileCount?, fileSize?, contentHash?}
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
    owner_id: ledger.getNodeId(),
    content_hash: site.contentHash || '',
    file_count: site.fileCount || 0,
    file_size: site.fileSize || 0,
    added_at: now,
    updated_at: now
  };

  await ledger.exec(
    `INSERT INTO sites (id, name, url, description, thumbnail, owner_id, content_hash, file_count, file_size, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newSite.id, newSite.name, newSite.url, newSite.description,
     newSite.thumbnail, newSite.owner_id, newSite.content_hash, newSite.file_count, newSite.file_size,
     newSite.added_at, newSite.updated_at]
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
     owner_id = ?, content_hash = ?, file_count = ?, file_size = ?, updated_at = ? WHERE id = ?`,
    [updated.name, updated.url, updated.description, updated.thumbnail,
     updated.owner_id, updated.content_hash || '', updated.file_count, updated.file_size, updated.updated_at, id]
  );

  notifyChange();
  return updated;
}

/**
 * Update file stats for a site
 * @param {string} id
 * @param {number} fileCount
 * @param {number} fileSize
 */
export async function updateSiteFileStats(id, fileCount, fileSize) {
  return updateSite(id, { file_count: fileCount, file_size: fileSize });
}

/**
 * Find a site I own with a specific content hash
 * @param {string} contentHash
 * @returns {Promise<Object|null>}
 */
export async function findMySiteByHash(contentHash) {
  if (!ledger || !contentHash) return null;
  const myId = ledger.getNodeId();
  const result = await ledger.exec(
    'SELECT * FROM sites WHERE owner_id = ? AND content_hash = ? LIMIT 1',
    [myId, contentHash]
  );
  const sites = rowsToSites(result);
  return sites[0] || null;
}

/**
 * Adopt a site (create your own copy so you can propagate it further)
 * @param {string} originalId - The original site ID (used for file storage reference)
 * @returns {Promise<Object>} The new site record you own
 */
export async function adoptSite(originalId) {
  if (!ledger) throw new Error('Catalog not initialized');

  const original = await getSite(originalId);
  if (!original) throw new Error('Site not found');

  // Create a new site record with our ownership
  const newSite = await addSite({
    name: original.name,
    url: original.url,
    description: original.description,
    thumbnail: original.thumbnail,
    contentHash: original.content_hash,
    fileCount: original.file_count,
    fileSize: original.file_size
  });

  return { newSite, originalId };
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
 * Check if a site is owned by me
 * @param {string} siteId
 * @returns {Promise<boolean>}
 */
export async function isMySite(siteId) {
  const site = await getSite(siteId);
  if (!site) return false;
  return site.owner_id === ledger.getNodeId();
}

/**
 * Get sync status
 * @returns {Object} {connected: boolean, peers: string[], nodeId: string}
 */
export function getSyncStatus() {
  if (!ledger) {
    return { connected: false, peers: [], nodeId: null };
  }
  return {
    connected: ledger.isConnected(),
    peers: ledger.getPeers(),
    nodeId: ledger.getNodeId()
  };
}

/**
 * Get the Ledger instance (for file transfer)
 */
export function getLedger() {
  return ledger;
}

/**
 * Get my node ID
 */
export function getNodeId() {
  return ledger?.getNodeId() || null;
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

/**
 * Debug: dump raw sites table
 */
export async function dumpSites() {
  if (!ledger) return console.log('No ledger');
  const result = await ledger.exec('SELECT * FROM sites');
  console.log('My node:', ledger.getNodeId());
  console.log('Columns:', result.columns);
  console.log('Rows:', result.rows);
  return result;
}

