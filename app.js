/**
 * Scrap Yard - Main Application
 * P2P catalog for curating and serving static sites offline
 */

import {
  initCatalog,
  getMySites,
  getAvailableSites,
  getSite,
  addSite,
  removeSite,
  updateSiteFileStats,
  adoptSite,
  onCatalogChange,
  onPeerChange,
  getSyncStatus,
  isSyncAvailable,
  getNodeId,
  getRoomToken
} from './catalog.js';

import {
  initDB,
  storeFile,
  getFilesForSite,
  deleteFilesForSite,
  copyFilesToSite,
  formatBytes
} from './persistence.js';

import {
  initTransfer,
  importSiteFromPeer,
  getConnectedPeers,
  isConnectedToPeer,
  onTransferProgress
} from './transfer.js';

// DOM Elements
const addSiteBtn = document.getElementById('add-site-btn');
const addModal = document.getElementById('add-modal');
const addSiteForm = document.getElementById('add-site-form');
const modalClose = document.getElementById('modal-close');
const cancelAdd = document.getElementById('cancel-add');
const mySitesGrid = document.getElementById('my-sites-grid');
const emptyState = document.getElementById('empty-state');
const syncStatus = document.getElementById('sync-status');
const siteCardTemplate = document.getElementById('site-card-template');

// Peers section elements
const peersSection = document.getElementById('peers-section');
const peersList = document.getElementById('peers-list');
const peerCardTemplate = document.getElementById('peer-card-template');

// Available sites elements
const availableSection = document.getElementById('available-section');
const availableSitesGrid = document.getElementById('available-sites-grid');
const availableSiteCardTemplate = document.getElementById('available-site-card-template');

// Import modal elements
const importModal = document.getElementById('import-modal');
const importClose = document.getElementById('import-close');
const importCancel = document.getElementById('import-cancel');
const importConfirm = document.getElementById('import-confirm');
const importName = document.getElementById('import-name');
const importDescription = document.getElementById('import-description');
const importFiles = document.getElementById('import-files');
const importOwner = document.getElementById('import-owner');
const importProgress = document.getElementById('import-progress');
const importProgressFill = document.getElementById('import-progress-fill');
const importProgressText = document.getElementById('import-progress-text');

// Add modal elements
const dropZone = document.getElementById('drop-zone');
const folderInput = document.getElementById('site-folder');
const browseBtn = document.getElementById('browse-btn');
const dropHint = document.getElementById('drop-hint');
const submitAdd = document.getElementById('submit-add');
const siteNameInput = document.getElementById('site-name');

// Detail Modal Elements
const detailModal = document.getElementById('detail-modal');
const detailClose = document.getElementById('detail-close');
const detailName = document.getElementById('detail-name');
const detailUrl = document.getElementById('detail-url');
const detailDescription = document.getElementById('detail-description');
const detailCachedStatus = document.getElementById('detail-cached-status');
const detailAdded = document.getElementById('detail-added');
const detailCache = document.getElementById('detail-cache');
const detailBrowse = document.getElementById('detail-browse');
const detailDownload = document.getElementById('detail-download');
const detailRemove = document.getElementById('detail-remove');
const cacheProgress = document.getElementById('cache-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

let currentSiteId = null;
let pendingFiles = [];
let currentImportSite = null;

/**
 * Initialize the application
 */
async function init() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('Service worker registered');
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  }

  // Initialize stores
  await initDB();
  await initCatalog();

  // Initialize file transfer system (uses Ledger's existing connections)
  initTransfer();

  // Set up event listeners
  setupEventListeners();

  // Subscribe to catalog changes
  onCatalogChange(renderCatalog);

  // Subscribe to peer changes
  onPeerChange(renderPeers);

  // Initial render
  await renderCatalog();
  renderPeers();

  // Update sync status periodically
  updateSyncStatus();
  setInterval(updateSyncStatus, 5000);
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Add site modal
  addSiteBtn.addEventListener('click', openAddModal);
  modalClose.addEventListener('click', closeAddModal);
  cancelAdd.addEventListener('click', closeAddModal);
  addModal.querySelector('.modal-backdrop').addEventListener('click', closeAddModal);
  addSiteForm.addEventListener('submit', handleAddSite);

  // Folder upload
  browseBtn.addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', handleFolderSelect);

  // Drag and drop
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);

  // Detail modal
  detailClose.addEventListener('click', closeDetailModal);
  detailModal.querySelector('.modal-backdrop').addEventListener('click', closeDetailModal);
  detailCache.addEventListener('click', handleReupload);
  detailBrowse.addEventListener('click', handleBrowseSite);
  detailDownload.addEventListener('click', handleDownloadSite);
  detailRemove.addEventListener('click', handleRemoveSite);

  // Import modal
  importClose.addEventListener('click', closeImportModal);
  importCancel.addEventListener('click', closeImportModal);
  importModal.querySelector('.modal-backdrop').addEventListener('click', closeImportModal);
  // Note: importConfirm click handler is set dynamically in openImportModal

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAddModal();
      closeDetailModal();
      closeImportModal();
    }
  });
}

/**
 * Handle drag over
 */
function handleDragOver(e) {
  e.preventDefault();
  dropZone.classList.add('drag-over');
}

/**
 * Handle drag leave
 */
function handleDragLeave(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
}

/**
 * Handle drop
 */
async function handleDrop(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  const items = e.dataTransfer.items;
  if (!items) return;

  const files = [];
  let rootFolderName = null;

  // Process dropped items
  for (const item of items) {
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        if (entry.isDirectory && !rootFolderName) {
          rootFolderName = entry.name;
        }
        await readEntry(entry, '', files);
      }
    }
  }

  if (files.length > 0) {
    // Strip root folder from paths (like file input does)
    const processedFiles = files.map(f => {
      const parts = f.path.split('/');
      // If path starts with root folder name, remove it
      if (parts[0] === rootFolderName && parts.length > 1) {
        return { path: parts.slice(1).join('/'), file: f.file };
      }
      return f;
    });
    setPendingFiles(processedFiles);

    // Auto-fill name from folder
    if (rootFolderName && !siteNameInput.value) {
      siteNameInput.value = rootFolderName;
    }
  }
}

/**
 * Recursively read directory entries
 */
async function readEntry(entry, path, files) {
  if (entry.isFile) {
    const file = await new Promise((resolve) => entry.file(resolve));
    const filePath = path ? `${path}/${entry.name}` : entry.name;
    files.push({ path: filePath, file });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await new Promise((resolve) => reader.readEntries(resolve));
    const dirPath = path ? `${path}/${entry.name}` : entry.name;
    for (const subEntry of entries) {
      await readEntry(subEntry, dirPath, files);
    }
  }
}

/**
 * Handle folder selection via input
 */
function handleFolderSelect(e) {
  const fileList = e.target.files;
  if (!fileList || fileList.length === 0) return;

  const files = [];
  for (const file of fileList) {
    // webkitRelativePath includes the folder name
    const path = file.webkitRelativePath;
    // Remove the root folder name from path
    const pathParts = path.split('/');
    const relativePath = pathParts.slice(1).join('/');
    files.push({ path: relativePath, file });
  }

  if (files.length > 0) {
    setPendingFiles(files);
    // Auto-fill name from folder
    const folderName = fileList[0].webkitRelativePath.split('/')[0];
    if (!siteNameInput.value) {
      siteNameInput.value = folderName;
    }
  }
}

/**
 * Set pending files and update UI
 */
function setPendingFiles(files) {
  pendingFiles = files;
  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
  dropHint.textContent = `${files.length} files selected (${formatBytes(totalSize)})`;
  submitAdd.disabled = false;
}

/**
 * Render the catalog grid
 */
async function renderCatalog() {
  // Render my sites
  const mySites = await getMySites();
  emptyState.classList.toggle('hidden', mySites.length > 0);
  mySitesGrid.innerHTML = '';

  for (const site of mySites) {
    const card = createSiteCard(site);
    mySitesGrid.appendChild(card);
  }

  // Render available sites from peers
  const availableSites = await getAvailableSites();
  availableSection.classList.toggle('hidden', availableSites.length === 0);
  availableSitesGrid.innerHTML = '';

  for (const site of availableSites) {
    const card = createAvailableSiteCard(site);
    availableSitesGrid.appendChild(card);
  }
}

/**
 * Create a site card element (for my sites)
 */
function createSiteCard(site) {
  const template = siteCardTemplate.content.cloneNode(true);
  const card = template.querySelector('.site-card');

  card.dataset.siteId = site.id;
  card.querySelector('.site-name').textContent = site.name || 'Unnamed Site';
  card.querySelector('.site-url').textContent = site.description || '';

  const badge = card.querySelector('.cache-badge');
  badge.textContent = 'Stored';
  badge.classList.add('cached');

  card.addEventListener('click', () => openDetailModal(site.id));

  return card;
}

/**
 * Create an available site card (for peer sites)
 */
function createAvailableSiteCard(site) {
  const template = availableSiteCardTemplate.content.cloneNode(true);
  const card = template.querySelector('.site-card');

  card.dataset.siteId = site.id;
  card.dataset.ownerId = site.owner_id;
  card.querySelector('.site-name').textContent = site.name || 'Unnamed Site';
  card.querySelector('.site-description').textContent = site.description || '';

  // Show file count if available
  const badge = card.querySelector('.cache-badge');
  if (site.file_count) {
    badge.textContent = `${site.file_count} files`;
  }

  // Show owner (shortened)
  const ownerBadge = card.querySelector('.owner-badge');
  ownerBadge.textContent = `from ${site.owner_id?.slice(0, 8) || 'unknown'}`;

  card.addEventListener('click', () => openImportModal(site));

  return card;
}

/**
 * Render connected peers
 */
function renderPeers() {
  const status = getSyncStatus();
  const peers = status.peers || [];

  peersSection.classList.toggle('hidden', peers.length === 0);

  if (peers.length === 0) {
    peersList.innerHTML = '<p class="no-peers">No peers connected</p>';
    return;
  }

  peersList.innerHTML = '';
  for (const peerId of peers) {
    const template = peerCardTemplate.content.cloneNode(true);
    const card = template.querySelector('.peer-card');
    card.dataset.peerId = peerId;
    card.querySelector('.peer-id').textContent = peerId.slice(0, 8) + '...';
    peersList.appendChild(card);
  }
}

/**
 * Open import modal for a peer's site
 */
async function openImportModal(site) {
  currentImportSite = site;

  importName.textContent = site.name || 'Unnamed Site';
  importDescription.textContent = site.description || 'No description';
  importFiles.textContent = site.file_count ? `${site.file_count} files (${formatBytes(site.file_size || 0)})` : 'Unknown size';
  importOwner.textContent = `Owner: ${site.owner_id?.slice(0, 8) || 'unknown'}`;

  importProgress.classList.add('hidden');

  // Check if files are already cached locally
  const localFiles = await getFilesForSite(site.id);
  if (localFiles.length > 0) {
    importConfirm.textContent = 'Browse Offline';
    importConfirm.onclick = () => {
      window.open(`/local/${site.id}/`, '_blank');
      closeImportModal();
    };
  } else {
    importConfirm.textContent = 'Import Site';
    importConfirm.onclick = handleImportSite;
  }
  importConfirm.disabled = false;

  importModal.classList.remove('hidden');
}

/**
 * Close import modal
 */
function closeImportModal() {
  importModal.classList.add('hidden');
  currentImportSite = null;
}

/**
 * Handle importing a site from a peer
 */
async function handleImportSite() {
  if (!currentImportSite) return;

  const site = currentImportSite;
  const ownerId = site.owner_id;

  // Check if peer is connected
  if (!isConnectedToPeer(ownerId)) {
    alert('Owner peer is not connected. Cannot transfer files.');
    return;
  }

  importConfirm.disabled = true;
  importConfirm.textContent = 'Importing...';
  importProgress.classList.remove('hidden');

  try {
    // Import files from peer via WebRTC (stored under original site ID temporarily)
    await importSiteFromPeer(ownerId, site.id, (completed, total, path) => {
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      importProgressFill.style.width = `${percent}%`;
      importProgressText.textContent = `${percent}% - ${path || 'Starting...'}`;
    });

    // Create our own copy of the site (new ID, our ownership)
    const { newSite } = await adoptSite(site.id);

    // Copy files from original site ID to our new site ID
    await copyFilesToSite(site.id, newSite.id);

    // Clean up files under original ID (we have our own copy now)
    await deleteFilesForSite(site.id);

    closeImportModal();
    await renderCatalog();
  } catch (error) {
    console.error('Error importing site:', error);
    alert(`Failed to import site: ${error.message}`);
  } finally {
    importConfirm.disabled = false;
    importConfirm.textContent = 'Import Site';
    importProgress.classList.add('hidden');
    importProgressFill.style.width = '0%';
  }
}

/**
 * Open the add site modal
 */
function openAddModal() {
  addModal.classList.remove('hidden');
  siteNameInput.focus();
}

/**
 * Close the add site modal
 */
function closeAddModal() {
  addModal.classList.add('hidden');
  addSiteForm.reset();
  pendingFiles = [];
  dropHint.textContent = '';
  submitAdd.disabled = true;
}

/**
 * Handle add site form submission
 */
async function handleAddSite(e) {
  e.preventDefault();

  const name = siteNameInput.value.trim();
  const description = document.getElementById('site-description').value.trim();

  if (!name || pendingFiles.length === 0) return;

  submitAdd.disabled = true;
  submitAdd.textContent = 'Uploading...';

  try {
    // Create site entry
    const site = await addSite({
      url: '',
      name,
      description,
      thumbnail: ''
    });

    // Store all files and track total size
    let stored = 0;
    let totalSize = 0;
    for (const { path, file } of pendingFiles) {
      const content = await file.arrayBuffer().then(buf => new Blob([buf], { type: file.type }));
      const contentType = file.type || guessContentType(path);
      await storeFile(site.id, path, content, contentType);
      stored++;
      totalSize += file.size;
      submitAdd.textContent = `Uploading... ${Math.round((stored / pendingFiles.length) * 100)}%`;
    }

    // Update file stats for P2P sharing
    await updateSiteFileStats(site.id, pendingFiles.length, totalSize);

    closeAddModal();
    await renderCatalog();
  } catch (error) {
    console.error('Error adding site:', error);
    alert('Failed to add site.');
  } finally {
    submitAdd.disabled = false;
    submitAdd.textContent = 'Add Site';
  }
}

/**
 * Guess content type from file path
 */
function guessContentType(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  const types = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'txt': 'text/plain',
    'xml': 'application/xml',
    'pdf': 'application/pdf'
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Open the detail modal for a site
 */
async function openDetailModal(siteId) {
  currentSiteId = siteId;
  const site = await getSite(siteId);
  if (!site) return;

  detailName.textContent = site.name || 'Unnamed Site';
  detailUrl.textContent = ''; // No URL for uploaded sites
  detailDescription.textContent = site.description || 'No description';
  detailAdded.textContent = `Added ${formatDate(site.added_at)}`;

  const files = await getFilesForSite(siteId);
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
  detailCachedStatus.textContent = `${files.length} files (${formatBytes(totalSize)})`;

  detailCache.textContent = 'Re-upload';
  detailBrowse.disabled = files.length === 0;
  detailDownload.disabled = files.length === 0;

  cacheProgress.classList.add('hidden');
  detailModal.classList.remove('hidden');
}

/**
 * Close the detail modal
 */
function closeDetailModal() {
  detailModal.classList.add('hidden');
  currentSiteId = null;
}

/**
 * Handle re-upload (open file picker for current site)
 */
async function handleReupload() {
  // Create a temporary file input for re-upload
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.multiple = true;

  input.onchange = async (e) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    detailCache.disabled = true;
    detailCache.textContent = 'Uploading...';
    cacheProgress.classList.remove('hidden');

    try {
      // Clear existing files
      await deleteFilesForSite(currentSiteId);

      // Store new files
      let stored = 0;
      for (const file of fileList) {
        const pathParts = file.webkitRelativePath.split('/');
        const relativePath = pathParts.slice(1).join('/');
        const content = await file.arrayBuffer().then(buf => new Blob([buf], { type: file.type }));
        const contentType = file.type || guessContentType(relativePath);
        await storeFile(currentSiteId, relativePath, content, contentType);
        stored++;
        const percent = Math.round((stored / fileList.length) * 100);
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `${percent}% - ${stored}/${fileList.length} files`;
      }

      // Refresh detail modal
      await openDetailModal(currentSiteId);
      await renderCatalog();
    } catch (error) {
      console.error('Error re-uploading:', error);
      alert('Failed to re-upload files.');
    } finally {
      detailCache.disabled = false;
      detailCache.textContent = 'Re-upload';
      cacheProgress.classList.add('hidden');
      progressFill.style.width = '0%';
    }
  };

  input.click();
}

/**
 * Handle browse offline button click
 */
function handleBrowseSite() {
  if (!currentSiteId) return;
  window.open(`/local/${currentSiteId}/`, '_blank');
}

/**
 * Handle download ZIP button click
 */
async function handleDownloadSite() {
  if (!currentSiteId) return;

  const site = await getSite(currentSiteId);
  const files = await getFilesForSite(currentSiteId);

  if (files.length === 0) {
    alert('No files stored for this site.');
    return;
  }

  detailDownload.disabled = true;
  detailDownload.textContent = 'Creating ZIP...';

  try {
    const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
    const zip = new JSZip();

    for (const file of files) {
      zip.file(file.path, file.content);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${site.name || 'site'}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error creating ZIP:', error);
    alert('Failed to create ZIP file.');
  } finally {
    detailDownload.disabled = false;
    detailDownload.textContent = 'Download ZIP';
  }
}

/**
 * Handle remove site button click
 */
async function handleRemoveSite() {
  if (!currentSiteId) return;

  if (!confirm('Are you sure you want to remove this site? All files will be deleted.')) {
    return;
  }

  try {
    await deleteFilesForSite(currentSiteId);
    await removeSite(currentSiteId);
    closeDetailModal();
    await renderCatalog();
  } catch (error) {
    console.error('Error removing site:', error);
    alert('Failed to remove site.');
  }
}

/**
 * Update the sync status indicator
 */
function updateSyncStatus() {
  if (isSyncAvailable()) {
    const status = getSyncStatus();
    if (status.connected) {
      const peerCount = status.peers?.length || 0;
      syncStatus.textContent = `Online (${peerCount} peer${peerCount !== 1 ? 's' : ''})`;
      syncStatus.classList.add('online');
    } else {
      syncStatus.textContent = 'Connecting...';
      syncStatus.classList.remove('online');
    }
  } else {
    syncStatus.textContent = 'Local Only';
    syncStatus.classList.remove('online');
  }
}

/**
 * Format a date string
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Initialize on load
init().catch(console.error);
