const roomInput = document.getElementById('roomId');
const usernameInput = document.getElementById('username');
const authTokenInput = document.getElementById('authToken');
const joinBtn = document.getElementById('joinBtn');
const logoutBtn = document.getElementById('logoutBtn');
const statusField = document.getElementById('status');
const peerList = document.getElementById('peerList');
const chatPanel = document.querySelector('.chat-layout');
const chatLog = document.getElementById('chatLog');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const imageInput = document.getElementById('imageInput');
const uploadBtn = document.getElementById('uploadBtn');
const roomTitle = document.getElementById('roomTitle');
const usernameDisplay = document.getElementById('usernameDisplay');
const yourFingerprint = document.getElementById('yourFingerprint');
const previewPanel = document.getElementById('previewPanel');
const previewImage = document.getElementById('previewImage');
const previewInfo = document.getElementById('previewInfo');
const clearPreviewBtn = document.getElementById('clearPreviewBtn');

const SUPPORTED_CRYPTO_CURVE = 'P-256';
let socket;
let roomId;
let myId;
let myName;
let myKeyPair;
let myPublicKeyBase64;
let cryptoCurve = SUPPORTED_CRYPTO_CURVE;
const sharedKeys = new Map();
const peers = new Map();
const peerVerification = new Map();

function appendMessage(content, sender = 'System') {
  const item = document.createElement('div');
  item.className = 'message';
  if (sender === 'You') {
    item.classList.add('message--self');
  } else if (sender === 'System') {
    item.classList.add('message--system');
  } else {
    item.classList.add('message--peer');
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = sender;
  item.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'message-body';
  if (typeof content === 'string') {
    body.textContent = content;
  } else if (content?.type === 'image') {
    const img = document.createElement('img');
    img.src = content.data;
    img.alt = content.name || 'Shared image';
    body.appendChild(img);
    if (content.name) {
      const caption = document.createElement('div');
      caption.textContent = content.name;
      caption.className = 'image-caption';
      body.appendChild(caption);
    }
  } else if (content?.type === 'text') {
    body.textContent = content.text;
  } else {
    body.textContent = typeof content === 'object' ? JSON.stringify(content) : String(content);
  }
  item.appendChild(body);
  chatLog.appendChild(item);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function updateStatus(text, type = 'info') {
  statusField.textContent = text;
  statusField.className = `status ${type}`;
}

function setFormEnabled(enabled) {
  if (joinBtn) joinBtn.disabled = !enabled;
  roomInput.disabled = !enabled;
  usernameInput.disabled = !enabled;
  authTokenInput.disabled = !enabled;
  if (logoutBtn) logoutBtn.classList.toggle('hidden', enabled);
}

function setChatEnabled(enabled) {
  sendBtn.disabled = !enabled;
  messageInput.disabled = !enabled;
  imageInput.disabled = !enabled;
  uploadBtn.disabled = !enabled;
}

function clearChatHistory() {
  chatLog.innerHTML = '';
  clearPeerList();
  sharedKeys.clear();
  peers.clear();
  peerVerification.clear();
}

function ensureSecureContext() {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Web Crypto API is unavailable. Open this page in a modern browser over http:// or https://.');
  }
}

function encodeBase64(arrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function formatHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function computeFingerprint(publicKeyBase64) {
  const rawPublicKey = decodeBase64(publicKeyBase64);
  const digest = await crypto.subtle.digest('SHA-256', rawPublicKey);
  return formatHex(digest);
}

function clearPeerList() {
  peerList.innerHTML = '';
  peerVerification.clear();
}

function updateVerificationStatus() {
  const hasPeers = peers.size > 0;
  const verifiedCount = Array.from(peerVerification.values()).filter(Boolean).length;
  const allVerified = hasPeers && verifiedCount === peers.size;

  if (!hasPeers) {
    updateStatus('Waiting for another peer to join. Share the room link and verify when they arrive.', 'info');
    setChatEnabled(false);
    return;
  }

  if (allVerified) {
    updateStatus('All connected peers are verified. You may now chat securely.', 'success');
    setChatEnabled(true);
    return;
  }

  updateStatus('Verify your peer fingerprint before sending messages.', 'warning');
  setChatEnabled(false);
}

function markPeerVerified(peerId) {
  peerVerification.set(peerId, true);
  updateVerificationStatus();
}

function addPeerEntry(peerId, peerName, fingerprint) {
  const entry = document.createElement('div');
  entry.id = `peer-${peerId}`;
  entry.className = 'peer-entry';
  entry.innerHTML = `
    <div class="peer-info">
      <span class="peer-name">${peerName}</span>
      <span class="fingerprint">${fingerprint}</span>
    </div>
    <button class="verify-btn" data-peer-id="${peerId}">Verify</button>
  `;
  peerList.appendChild(entry);

  const verifyBtn = entry.querySelector('.verify-btn');
  verifyBtn.addEventListener('click', () => {
    if (confirm(`Verify ${peerName}'s fingerprint: ${fingerprint}\n\nClick OK if it matches what they provided out-of-band.`)) {
      verifyBtn.textContent = 'Verified';
      verifyBtn.disabled = true;
      entry.classList.add('verified');
      markPeerVerified(peerId);
    }
  });
}

function removePeerEntry(peerId) {
  const entry = document.getElementById(`peer-${peerId}`);
  if (entry) {
    entry.remove();
  }
  peerVerification.delete(peerId);
  updateVerificationStatus();
}

function showImagePreview(file, dataUrl) {
  previewImage.src = dataUrl;
  previewInfo.textContent = `${file.name} • ${(file.size / 1024).toFixed(1)} KB`;
  previewPanel.classList.remove('hidden');
}

function hideImagePreview() {
  if (!previewPanel) return;
  previewImage.src = '';
  previewInfo.textContent = '';
  previewPanel.classList.add('hidden');
}

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (!file) {
    hideImagePreview();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => showImagePreview(file, reader.result);
  reader.readAsDataURL(file);
});

clearPreviewBtn.addEventListener('click', () => {
  imageInput.value = '';
  hideImagePreview();
});

async function createIdentity() {
  ensureSecureContext();

  myKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: cryptoCurve },
    true,
    ['deriveKey']
  );

  const rawPublicKey = await crypto.subtle.exportKey('raw', myKeyPair.publicKey);
  myPublicKeyBase64 = encodeBase64(rawPublicKey);
  const fingerprint = await computeFingerprint(myPublicKeyBase64);
  if (yourFingerprint) {
    yourFingerprint.textContent = fingerprint;
  }
}

async function deriveSharedKey(peerPublicBase64) {
  const rawPublicKey = decodeBase64(peerPublicBase64);
  const peerPublicKey = await crypto.subtle.importKey(
    'raw',
    rawPublicKey,
    { name: 'ECDH', namedCurve: cryptoCurve },
    false,
    []
  );

  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    myKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptForPeer(key, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = typeof payload === 'string' ? JSON.stringify({ type: 'text', text: payload }) : JSON.stringify(payload);
  const encoded = new TextEncoder().encode(body);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const buffer = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  buffer.set(iv, 0);
  buffer.set(new Uint8Array(ciphertext), iv.byteLength);
  return encodeBase64(buffer.buffer);
}

async function decryptFromPeer(key, encodedPayload) {
  const raw = new Uint8Array(decodeBase64(encodedPayload));
  const iv = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const text = new TextDecoder().decode(decrypted);
  try {
    return JSON.parse(text);
  } catch {
    return { type: 'text', text };
  }
}

async function handlePeer(peerId, peerName, peerPublicKey) {
  if (peerId === myId || sharedKeys.has(peerId)) return;

  try {
    const sharedKey = await deriveSharedKey(peerPublicKey);
    sharedKeys.set(peerId, sharedKey);
    peers.set(peerId, peerName);
    const fingerprint = await computeFingerprint(peerPublicKey);
    addPeerEntry(peerId, peerName, fingerprint);
    updateVerificationStatus();
    appendMessage(
      `Secure session established with ${peerName}. Verify their fingerprint out of band: ${fingerprint}`,
      'System'
    );
  } catch (error) {
    console.error('Key derivation failed', error);
    appendMessage(`Failed to establish encryption with ${peerName}.`, 'System');
  }
}

async function handleJoined(payload) {
  myId = payload.clientId;
  roomTitle.textContent = payload.roomId;
  usernameDisplay.textContent = myName;
  clearPeerList();
  appendMessage(`Joined room ${payload.roomId} as ${myName}.`, 'System');

  for (const peer of payload.peers) {
    await handlePeer(peer.clientId, peer.username, peer.publicKey);
  }

  updateVerificationStatus();
  setFormEnabled(false);
}

let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    appendMessage('No activity detected for 10 minutes. Closing session for security.', 'System');
    logoutRoom();
  }, 10 * 60 * 1000);
}

async function connectRoom() {
  if (!roomInput.value.trim() || !usernameInput.value.trim()) {
    updateStatus('Enter a room ID and username.', 'error');
    return;
  }

  try {
    setFormEnabled(false);
    setChatEnabled(false);
    roomId = roomInput.value.trim();
    myName = usernameInput.value.trim();
    roomTitle.textContent = roomId;
    usernameDisplay.textContent = myName;
    updateStatus('Creating secure identity and connecting…', 'info');

    await createIdentity();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.addEventListener('open', () => {
      const joinPayload = {
        type: 'join',
        roomId,
        username: myName,
        publicKey: myPublicKeyBase64
      };
      if (authTokenInput.value.trim()) {
        joinPayload.authToken = authTokenInput.value.trim();
      }
      socket.send(JSON.stringify(joinPayload));
      resetIdleTimer();
    });

    socket.addEventListener('message', async (event) => {
      resetIdleTimer();
      const payload = JSON.parse(event.data);

      if (payload.type === 'error') {
        appendMessage(payload.message, 'System');
        updateStatus(payload.message, 'error');
        setFormEnabled(true);
        setChatEnabled(false);
        return;
      }

      if (payload.type === 'joined') {
        await handleJoined(payload);
        return;
      }

      if (payload.type === 'peer-joined') {
        await handlePeer(payload.clientId, payload.username, payload.publicKey);
        appendMessage(`${payload.username} joined the room.`, 'System');
        return;
      }

      if (payload.type === 'peer-left') {
        sharedKeys.delete(payload.clientId);
        peers.delete(payload.clientId);
        removePeerEntry(payload.clientId);
        appendMessage(`${payload.username} left the room.`, 'System');
        return;
      }

      if (payload.type === 'room-closed') {
        appendMessage(payload.message || 'Room closed due to inactivity.', 'System');
        logoutRoom();
        return;
      }

      if (payload.type === 'message') {
        const directPayload = payload.payloads.find((item) => item.recipientId === myId);
        if (!directPayload) return;

        const sharedKey = sharedKeys.get(payload.senderId);
        if (!sharedKey) {
          appendMessage('Unable to decrypt a message from an unknown peer.', 'System');
          return;
        }

        try {
          const decrypted = await decryptFromPeer(sharedKey, directPayload.data);
          appendMessage(decrypted, payload.senderName || 'Peer');
        } catch (error) {
          appendMessage('Decryption failed. Check that the other participant is using the same room.', 'System');
        }
      }
    });

    socket.addEventListener('close', () => {
      updateStatus('Disconnected. Refresh to reconnect.', 'error');
      setChatEnabled(false);
    });

    socket.addEventListener('error', () => {
      updateStatus('WebSocket connection failed. Ensure the server is running and the page is opened from localhost.', 'error');
      setFormEnabled(true);
      setChatEnabled(false);
    });
  } catch (error) {
    console.error(error);
    updateStatus(error.message || 'Unable to join room.', 'error');
    setFormEnabled(true);
    setChatEnabled(false);
  }
}

function logoutRoom() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'leave' }));
    socket.close();
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  clearChatHistory();
  myId = null;
  myName = null;
  myKeyPair = null;
  myPublicKeyBase64 = null;
  roomId = null;
  hideImagePreview();
  updateStatus('Logged out. Chat cleared for security.', 'success');
  setFormEnabled(true);
  setChatEnabled(false);
}

async function uploadImage() {
  const file = imageInput.files?.[0];
  if (!file || socket?.readyState !== WebSocket.OPEN) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const imageData = reader.result;
    const payload = {
      type: 'image',
      mime: file.type,
      data: imageData,
      name: file.name
    };

    const payloads = [];
    for (const [peerId, key] of sharedKeys.entries()) {
      const encrypted = await encryptForPeer(key, payload);
      payloads.push({ recipientId: peerId, data: encrypted });
    }

    if (payloads.length === 0) {
      appendMessage('No peers available yet. Wait for someone else to join.', 'System');
      return;
    }

    socket.send(JSON.stringify({ type: 'message', payloads }));
    appendMessage(payload, 'You');
    imageInput.value = '';
    hideImagePreview();
    resetIdleTimer();
  };
  reader.readAsDataURL(file);
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || socket?.readyState !== WebSocket.OPEN) return;

  const payloads = [];
  for (const [peerId, key] of sharedKeys.entries()) {
    const encrypted = await encryptForPeer(key, text);
    payloads.push({ recipientId: peerId, data: encrypted });
  }

  if (payloads.length === 0) {
    appendMessage('No peers available yet. Wait for someone else to join.', 'System');
    return;
  }

  socket.send(JSON.stringify({ type: 'message', payloads }));
  appendMessage({ type: 'text', text }, 'You');
  messageInput.value = '';
  resetIdleTimer();
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    room: params.get('roomId') || '',
    username: params.get('username') || '',
    authToken: params.get('authToken') || ''
  };
}

async function initializeFromUrl() {
  const params = parseUrlParams();
  if (!params.room || !params.username) {
    updateStatus('Room ID and username are required. Return to the join page.', 'error');
    setChatEnabled(false);
    return;
  }
  roomInput.value = params.room;
  usernameInput.value = params.username;
  authTokenInput.value = params.authToken;
  roomTitle.textContent = params.room;
  usernameDisplay.textContent = params.username;
  await connectRoom();
}

if (joinBtn) {
  joinBtn.addEventListener('click', connectRoom);
}
logoutBtn.addEventListener('click', logoutRoom);
uploadBtn.addEventListener('click', uploadImage);
setChatEnabled(false);

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendMessage();
  }
});

window.addEventListener('beforeunload', () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'leave' }));
    socket.close();
  }
});

window.addEventListener('DOMContentLoaded', initializeFromUrl);
