/**
 * Service Worker for Scrap Yard
 * Intercepts requests to /local/{siteId}/ and serves from IndexedDB
 */

const CACHE_NAME = 'scrap-yard-v2';
const DB_NAME = 'scrap_yard_content';
const STORE_NAME = 'site_files';

// Files to cache for the app itself
const APP_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/persistence.js',
  '/catalog.js',
  '/sw.js'
];

// Install event - cache app files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_FILES);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

/**
 * Open IndexedDB connection
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('siteId', 'siteId', { unique: false });
      }
    };
  });
}

/**
 * Get a file from IndexedDB
 */
async function getFileFromDB(siteId, path) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const key = `${siteId}/${path}`;
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Get all files for a site from IndexedDB
 */
async function getAllFilesForSite(siteId) {
  const db = await openDB();
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
 * Handle requests to /local/{siteId}/...
 */
async function handleLocalRequest(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Expected format: /local/{siteId}/{path...}
  if (pathParts[0] !== 'local' || pathParts.length < 2) {
    return new Response('Not Found', { status: 404 });
  }

  const siteId = pathParts[1];
  let filePath = pathParts.slice(2).join('/') || 'index.html';

  // Handle paths ending with /
  if (filePath.endsWith('/')) {
    filePath += 'index.html';
  }

  // Try to get the file
  try {
    let file = await getFileFromDB(siteId, filePath);

    // If not found and requesting root, try to find any index.html
    if (!file && (filePath === 'index.html' || filePath === '')) {
      const allFiles = await getAllFilesForSite(siteId);
      // Look for index.html at root level (no slashes in path)
      file = allFiles.find(f =>
        f.path === 'index.html' ||
        f.path === 'Index.html' ||
        (!f.path.includes('/') && f.path.toLowerCase().endsWith('.html'))
      );
    }

    if (file && file.content) {
      return new Response(file.content, {
        status: 200,
        headers: {
          'Content-Type': file.contentType || 'application/octet-stream',
          'Content-Length': file.size?.toString() || '0',
          'X-Scrap-Yard': 'cached'
        }
      });
    }

    // Try with .html extension if no extension
    if (!filePath.includes('.')) {
      const htmlFile = await getFileFromDB(siteId, filePath + '.html');
      if (htmlFile && htmlFile.content) {
        return new Response(htmlFile.content, {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
            'X-Scrap-Yard': 'cached'
          }
        });
      }
    }

    // Try index.html in directory
    const indexFile = await getFileFromDB(siteId, filePath + '/index.html');
    if (indexFile && indexFile.content) {
      return new Response(indexFile.content, {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'X-Scrap-Yard': 'cached'
        }
      });
    }

    // Debug: return HTML page showing what's available
    const allFiles = await getAllFilesForSite(siteId);
    const fileList = allFiles.map(f => `<li>${f.path} (${f.size || 0} bytes)</li>`).join('\n');

    const debugHtml = `<!DOCTYPE html>
<html>
<head><title>Debug - File Not Found</title></head>
<body>
<h1>File not found: ${filePath}</h1>
<h2>Site ID: ${siteId}</h2>
<h2>Available files (${allFiles.length}):</h2>
<ul>${fileList || '<li>No files found</li>'}</ul>
</body>
</html>`;

    return new Response(debugHtml, {
      status: 404,
      headers: { 'Content-Type': 'text/html' }
    });
  } catch (error) {
    console.error('Error serving cached file:', error);
    return new Response('Error loading cached file', { status: 500 });
  }
}

// Fetch event - handle requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle /local/ requests from IndexedDB
  if (url.pathname.startsWith('/local/')) {
    event.respondWith(handleLocalRequest(event.request));
    return;
  }

  // For app files, try network first, fall back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Update cache with fresh response
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For everything else, just fetch
  event.respondWith(fetch(event.request));
});

// Message handling for communication with main app
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
