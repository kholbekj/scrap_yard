/**
 * P2P File Transfer via Ledger's custom messages
 * Uses the existing WebRTC connections from Ledger instead of creating new ones
 */

import { getFilesForSite, storeFile } from './persistence.js';
import { getLedger, getNodeId } from './catalog.js';

// Chunk size for file transfer (64KB)
const CHUNK_SIZE = 64 * 1024;

// Pending file requests
const pendingRequests = new Map();

// Current incoming transfer state
const incomingTransfers = new Map();

// Transfer progress callbacks
let progressCallbacks = [];

/**
 * Initialize file transfer system
 * Sets up custom message handler on Ledger
 */
export function initTransfer() {
  const ledger = getLedger();
  if (!ledger) {
    console.warn('[Transfer] Ledger not available');
    return;
  }

  ledger.onCustomMessage((fromPeerId, channel, data) => {
    if (channel === 'file-transfer') {
      handleTransferMessage(fromPeerId, data);
    }
  });

  console.log('[Transfer] Initialized on Ledger custom channel');
}

/**
 * Send a transfer message to a peer
 */
function sendTransferMessage(peerId, data) {
  const ledger = getLedger();
  if (!ledger) return false;
  return ledger.sendCustom(peerId, 'file-transfer', data);
}

/**
 * Handle incoming transfer messages
 */
async function handleTransferMessage(fromPeerId, msg) {
  switch (msg.type) {
    case 'file-list-request':
      await sendFileList(fromPeerId, msg.siteId);
      break;

    case 'file-list':
      const listRequest = pendingRequests.get(`list:${msg.siteId}`);
      if (listRequest) {
        listRequest.resolve(msg.files);
        pendingRequests.delete(`list:${msg.siteId}`);
      }
      break;

    case 'file-request':
      await sendFile(fromPeerId, msg.siteId, msg.path);
      break;

    case 'file-start':
      incomingTransfers.set(`${fromPeerId}:${msg.siteId}:${msg.path}`, {
        siteId: msg.siteId,
        path: msg.path,
        contentType: msg.contentType,
        totalSize: msg.size,
        receivedSize: 0,
        chunks: []
      });
      break;

    case 'file-chunk':
      await handleFileChunk(fromPeerId, msg);
      break;

    case 'file-end':
      await finalizeIncomingFile(fromPeerId, msg.siteId, msg.path);
      break;
  }
}

/**
 * Handle incoming file chunk
 */
async function handleFileChunk(fromPeerId, msg) {
  const key = `${fromPeerId}:${msg.siteId}:${msg.path}`;
  const transfer = incomingTransfers.get(key);
  if (transfer) {
    // Decode base64 chunk back to bytes
    const binary = atob(msg.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    transfer.chunks.push(bytes);
    transfer.receivedSize += bytes.length;
    notifyProgress(transfer.siteId, transfer.path, transfer.receivedSize, transfer.totalSize);
  }
}

/**
 * Finalize an incoming file transfer
 */
async function finalizeIncomingFile(fromPeerId, siteId, path) {
  const key = `${fromPeerId}:${siteId}:${path}`;
  const transfer = incomingTransfers.get(key);

  if (transfer) {
    const blob = new Blob(transfer.chunks, { type: transfer.contentType });
    await storeFile(siteId, path, blob, transfer.contentType);
    incomingTransfers.delete(key);
    console.log(`[Transfer] Received file: ${path}`);

    // Resolve pending file request
    const fileKey = `file:${siteId}:${path}`;
    const fileRequest = pendingRequests.get(fileKey);
    if (fileRequest) {
      fileRequest.resolve(true);
      pendingRequests.delete(fileKey);
    }
  }
}

/**
 * Send file list for a site to a peer
 */
async function sendFileList(peerId, siteId) {
  const files = await getFilesForSite(siteId);
  const fileList = files.map(f => ({
    path: f.path,
    size: f.size,
    contentType: f.contentType
  }));

  sendTransferMessage(peerId, {
    type: 'file-list',
    siteId,
    files: fileList
  });
}

/**
 * Send a file to a peer
 */
async function sendFile(peerId, siteId, path) {
  const files = await getFilesForSite(siteId);
  const file = files.find(f => f.path === path);

  if (!file) {
    console.error(`[Transfer] File not found: ${path}`);
    return;
  }

  // Send file start
  sendTransferMessage(peerId, {
    type: 'file-start',
    siteId,
    path,
    contentType: file.contentType,
    size: file.size
  });

  // Send file in chunks (base64 encoded for JSON transport)
  const blob = file.content;
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
    // Convert to base64 for JSON transport
    let binary = '';
    for (let i = 0; i < chunk.length; i++) {
      binary += String.fromCharCode(chunk[i]);
    }
    const base64 = btoa(binary);

    sendTransferMessage(peerId, {
      type: 'file-chunk',
      siteId,
      path,
      data: base64
    });

    // Small delay to prevent overwhelming
    await new Promise(r => setTimeout(r, 10));
  }

  // Send file end
  sendTransferMessage(peerId, {
    type: 'file-end',
    siteId,
    path
  });
}

/**
 * Request file list from a peer for a site
 */
export function requestFileList(peerId, siteId) {
  return new Promise((resolve, reject) => {
    pendingRequests.set(`list:${siteId}`, { resolve, reject });

    sendTransferMessage(peerId, {
      type: 'file-list-request',
      siteId
    });

    setTimeout(() => {
      if (pendingRequests.has(`list:${siteId}`)) {
        pendingRequests.delete(`list:${siteId}`);
        reject(new Error('Request timed out'));
      }
    }, 30000);
  });
}

/**
 * Import a site from a peer (request all files)
 */
export async function importSiteFromPeer(peerId, siteId, onProgress = () => {}) {
  // First get the file list
  const files = await requestFileList(peerId, siteId);
  const totalFiles = files.length;
  let completedFiles = 0;

  // Request each file
  for (const file of files) {
    onProgress(completedFiles, totalFiles, file.path);

    await new Promise((resolve, reject) => {
      const key = `file:${siteId}:${file.path}`;
      pendingRequests.set(key, { resolve, reject });

      sendTransferMessage(peerId, {
        type: 'file-request',
        siteId,
        path: file.path
      });

      setTimeout(() => {
        if (pendingRequests.has(key)) {
          pendingRequests.delete(key);
          reject(new Error(`File transfer timed out: ${file.path}`));
        }
      }, 60000);
    });

    completedFiles++;
    onProgress(completedFiles, totalFiles, file.path);
  }

  return true;
}

/**
 * Get list of connected peers (uses Ledger's peers)
 */
export function getConnectedPeers() {
  const ledger = getLedger();
  return ledger?.getPeers() || [];
}

/**
 * Check if connected to a specific peer
 */
export function isConnectedToPeer(peerId) {
  const peers = getConnectedPeers();
  return peers.includes(peerId);
}

/**
 * Subscribe to transfer progress
 */
export function onTransferProgress(callback) {
  progressCallbacks.push(callback);
  return () => {
    progressCallbacks = progressCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Notify progress callbacks
 */
function notifyProgress(siteId, path, received, total) {
  progressCallbacks.forEach(cb => cb(siteId, path, received, total));
}
