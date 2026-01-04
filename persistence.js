/**
 * IndexedDB persistence for site files (local only, not synced)
 */

const DB_NAME = 'scrap_yard_content';
const DB_VERSION = 1;
const STORE_NAME = 'site_files';

let db = null;

/**
 * Initialize the IndexedDB database
 */
export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('siteId', 'siteId', { unique: false });
        store.createIndex('path', 'path', { unique: false });
      }
    };
  });
}

/**
 * Store a file for a site
 * @param {string} siteId - The site ID
 * @param {string} path - The file path (e.g., "index.html", "css/style.css")
 * @param {Blob} content - The file content
 * @param {string} contentType - The MIME type
 */
export async function storeFile(siteId, path, content, contentType) {
  await initDB();

  const key = `${siteId}/${path}`;
  const file = {
    key,
    siteId,
    path,
    contentType,
    content,
    size: content.size,
    cachedAt: new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(file);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(file);
  });
}

/**
 * Get a file for a site
 * @param {string} siteId - The site ID
 * @param {string} path - The file path
 * @returns {Promise<Object|null>} The file object or null
 */
export async function getFile(siteId, path) {
  await initDB();

  const key = `${siteId}/${path}`;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

/**
 * Get all files for a site
 * @param {string} siteId - The site ID
 * @returns {Promise<Array>} Array of file objects
 */
export async function getFilesForSite(siteId) {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('siteId');
    const request = index.getAll(siteId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

/**
 * Delete all files for a site
 * @param {string} siteId - The site ID
 */
export async function deleteFilesForSite(siteId) {
  await initDB();

  const files = await getFilesForSite(siteId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    let completed = 0;
    const total = files.length;

    if (total === 0) {
      resolve();
      return;
    }

    files.forEach(file => {
      const request = store.delete(file.key);
      request.onsuccess = () => {
        completed++;
        if (completed === total) resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Get total storage used by a site
 * @param {string} siteId - The site ID
 * @returns {Promise<number>} Total bytes used
 */
export async function getSiteStorageSize(siteId) {
  const files = await getFilesForSite(siteId);
  return files.reduce((total, file) => total + (file.size || 0), 0);
}

/**
 * Get total storage used across all sites
 * @returns {Promise<number>} Total bytes used
 */
export async function getTotalStorageSize() {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const files = request.result || [];
      const total = files.reduce((sum, file) => sum + (file.size || 0), 0);
      resolve(total);
    };
  });
}

/**
 * Check if a site has cached files
 * @param {string} siteId - The site ID
 * @returns {Promise<boolean>}
 */
export async function isSiteCached(siteId) {
  const files = await getFilesForSite(siteId);
  return files.length > 0;
}

/**
 * Copy all files from one site to another
 * @param {string} fromSiteId - Source site ID
 * @param {string} toSiteId - Destination site ID
 */
export async function copyFilesToSite(fromSiteId, toSiteId) {
  const files = await getFilesForSite(fromSiteId);
  for (const file of files) {
    await storeFile(toSiteId, file.path, file.content, file.contentType);
  }
}

/**
 * Format bytes to human readable string
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
