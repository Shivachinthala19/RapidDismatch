/**
 * Ticket Locking System - Real-time Dashboard Frontend
 */

// Global State
const state = {
  socket: null,
  socketId: null,
  isManuallyDisconnected: false,
  ticketLocks: {}, // Map of ticketId -> lockedBy (socket.id)
  ticketIds: new Set(["TICKET-101", "TICKET-102", "TICKET-103", "TICKET-104", "TICKET-105"])
};

// DOM Elements
const elements = {
  statusChip: document.getElementById("connection-status"),
  statusText: document.getElementById("status-text"),
  mySocketId: document.getElementById("my-socket-id"),
  copySocketBtn: document.getElementById("copy-socket-btn"),
  simulateDropBtn: document.getElementById("simulate-drop-btn"),
  totalTicketsCount: document.getElementById("total-tickets-count"),
  availableTicketsCount: document.getElementById("available-tickets-count"),
  lockedTicketsCount: document.getElementById("locked-tickets-count"),
  myLocksCount: document.getElementById("my-locks-count"),
  ticketsGrid: document.getElementById("tickets-grid"),
  customTicketForm: document.getElementById("custom-ticket-form"),
  customTicketInput: document.getElementById("custom-ticket-input"),
  eventStream: document.getElementById("event-stream"),
  clearLogsBtn: document.getElementById("clear-logs-btn"),
  toastContainer: document.getElementById("toast-container")
};

// ================= INITIALIZATION =================
function initializeSocket() {
  if (typeof io === "undefined") {
    console.error("Socket.IO client library not loaded!");
    showToast("Socket.IO library failed to load.", "error");
    return;
  }

  // Connect to the same origin server
  state.socket = io({
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  });

  setupSocketListeners();
}

function setupSocketListeners() {
  const socket = state.socket;

  // On Connect
  socket.on("connect", () => {
    state.socketId = socket.id;
    state.isManuallyDisconnected = false;

    updateConnectionUI(true, socket.id);
    logEvent("CONNECT", `Connected with ID: ${socket.id}`, "event-join");

    // REQUIREMENT 1 & 4: Join dashboard and fetch current lock state
    socket.emit("join_dashboard");
    logEvent("JOIN_DASHBOARD", `Emitted join_dashboard`, "event-join");
  });

  // On Disconnect
  socket.on("disconnect", (reason) => {
    updateConnectionUI(false, null, reason);
    logEvent("DISCONNECT", `Disconnected (${reason})`, "event-error");
    renderDashboard();
  });

  // REQUIREMENT 4: Synchronize snapshot on join
  socket.on("current_ticket_locks", (data) => {
    state.ticketLocks = data.locks || {};
    
    // Ensure all locked tickets are present in our ticket set
    Object.keys(state.ticketLocks).forEach((id) => state.ticketIds.add(id));
    
    logEvent("SYNC_LOCKS", `Synced ${Object.keys(state.ticketLocks).length} active locks`, "event-join");
    renderDashboard();
  });

  // REQUIREMENT 2: Broadcast when any ticket is locked
  socket.on("ticket_locked", (data) => {
    state.ticketLocks[data.ticketId] = data.lockedBy;
    state.ticketIds.add(data.ticketId);

    const isMine = data.lockedBy === state.socketId;
    logEvent(
      "TICKET_LOCKED",
      `Ticket [${data.ticketId}] locked by ${isMine ? "YOU" : data.lockedBy}`,
      "event-locked"
    );

    renderDashboard();
  });

  // REQUIREMENT 2 & 3: Broadcast when any ticket is unlocked (manual or ghost)
  socket.on("ticket_unlocked", (data) => {
    delete state.ticketLocks[data.ticketId];

    const isGhost = data.reason === "agent_disconnected";
    const eventBadge = isGhost ? "event-ghost" : "event-unlocked";
    const desc = isGhost
      ? `🚨 GHOST RELEASE: [${data.ticketId}] released (Agent ${data.previousOwner || "unknown"} disconnected)`
      : `Ticket [${data.ticketId}] unlocked (${data.reason || "manual"})`;

    logEvent("TICKET_UNLOCKED", desc, eventBadge);
    
    if (isGhost) {
      showToast(`Ghost cleanup: ${data.ticketId} is now available!`, "success");
    }

    renderDashboard();
  });

  // Error responses
  socket.on("lock_error", (data) => {
    showToast(data.error || "Failed to lock ticket", "error");
    logEvent("LOCK_ERROR", `[${data.ticketId}] ${data.error}`, "event-error");
  });

  socket.on("unlock_error", (data) => {
    showToast(data.error || "Failed to unlock ticket", "error");
    logEvent("UNLOCK_ERROR", `[${data.ticketId}] ${data.error}`, "event-error");
  });
}

// ================= UI UPDATES =================
function updateConnectionUI(isConnected, socketId, reason) {
  if (isConnected) {
    elements.statusChip.className = "status-chip";
    elements.statusText.textContent = "Live Connected";
    elements.mySocketId.textContent = socketId;
    elements.simulateDropBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
        <line x1="12" y1="2" x2="12" y2="12"></line>
      </svg>
      <span>Simulate Ghost Drop</span>
    `;
    elements.simulateDropBtn.className = "btn btn-warning";
  } else {
    elements.statusChip.className = "status-chip disconnected";
    elements.statusText.textContent = state.isManuallyDisconnected ? "Simulated Drop" : "Disconnected";
    elements.mySocketId.textContent = "(Disconnected)";
    elements.simulateDropBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 4v6h-6"></path>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </svg>
      <span>Reconnect Client</span>
    `;
    elements.simulateDropBtn.className = "btn btn-primary";
  }
}

function renderDashboard() {
  const ticketList = Array.from(state.ticketIds).sort();
  const total = ticketList.length;
  let lockedCount = 0;
  let myLocksCount = 0;

  elements.ticketsGrid.innerHTML = "";

  ticketList.forEach((ticketId) => {
    const lockedBy = state.ticketLocks[ticketId];
    const isLocked = Boolean(lockedBy);
    const isLockedByMe = isLocked && state.socket && lockedBy === state.socket.id;
    const isLockedByOther = isLocked && !isLockedByMe;

    if (isLocked) lockedCount++;
    if (isLockedByMe) myLocksCount++;

    const card = document.createElement("div");
    let statusClass = "status-available";
    let badgeHtml = `<span class="ticket-badge badge-available">Available</span>`;
    let metaHtml = `<div class="ticket-meta"><p>Ready for dispatch / processing</p></div>`;
    let buttonHtml = `
      <button class="btn btn-primary" onclick="handleLock('${ticketId}')" ${!state.socket?.connected ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span>Lock Ticket</span>
      </button>
    `;

    if (isLockedByMe) {
      statusClass = "status-locked-me";
      badgeHtml = `<span class="ticket-badge badge-locked-me">Locked by You</span>`;
      metaHtml = `
        <div class="ticket-meta">
          <p>You have exclusive access</p>
          <span class="owner-chip">Owner: YOU (${lockedBy})</span>
        </div>
      `;
      buttonHtml = `
        <button class="btn btn-unlock" onclick="handleUnlock('${ticketId}')" ${!state.socket?.connected ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
          </svg>
          <span>Unlock Ticket</span>
        </button>
      `;
    } else if (isLockedByOther) {
      statusClass = "status-locked-other";
      badgeHtml = `<span class="ticket-badge badge-locked-other">Locked</span>`;
      metaHtml = `
        <div class="ticket-meta">
          <p>Locked by another agent</p>
          <span class="owner-chip">Owner: ${lockedBy}</span>
        </div>
      `;
      buttonHtml = `
        <button class="btn btn-locked" disabled title="Locked by another agent (${lockedBy})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <span>Locked</span>
        </button>
      `;
    }

    card.className = `ticket-card ${statusClass}`;
    card.innerHTML = `
      <div>
        <div class="ticket-top">
          <span class="ticket-id">${escapeHtml(ticketId)}</span>
          ${badgeHtml}
        </div>
        ${metaHtml}
      </div>
      <div class="ticket-actions">
        ${buttonHtml}
      </div>
    `;

    elements.ticketsGrid.appendChild(card);
  });

  // Update Ribbon Metrics
  elements.totalTicketsCount.textContent = total;
  elements.availableTicketsCount.textContent = total - lockedCount;
  elements.lockedTicketsCount.textContent = lockedCount;
  elements.myLocksCount.textContent = myLocksCount;
}

// ================= USER ACTIONS =================
function handleLock(ticketId) {
  if (!state.socket || !state.socket.connected) {
    showToast("Socket is disconnected. Reconnect first.", "error");
    return;
  }

  // REQUIREMENT 2: Emit lock_ticket
  state.socket.emit("lock_ticket", { ticketId }, (res) => {
    if (res && !res.success) {
      showToast(res.error || "Could not lock ticket", "error");
    }
  });
}

function handleUnlock(ticketId) {
  if (!state.socket || !state.socket.connected) {
    showToast("Socket is disconnected. Reconnect first.", "error");
    return;
  }

  // REQUIREMENT 2: Emit unlock_ticket
  state.socket.emit("unlock_ticket", { ticketId }, (res) => {
    if (res && !res.success) {
      showToast(res.error || "Could not unlock ticket", "error");
    }
  });
}

// Custom ticket form
elements.customTicketForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const rawValue = elements.customTicketInput.value.trim();
  if (!rawValue) return;

  const ticketId = rawValue.toUpperCase();
  state.ticketIds.add(ticketId);
  elements.customTicketInput.value = "";

  // Immediately attempt lock
  handleLock(ticketId);
});

// Ghost Drop simulation button
elements.simulateDropBtn.addEventListener("click", () => {
  if (state.socket.connected) {
    state.isManuallyDisconnected = true;
    state.socket.disconnect();
    logEvent("SIMULATION", "Client abruptly disconnected (simulating crash/network loss)", "event-ghost");
    showToast("Disconnected! Check your other browser tab to see ghost lock cleanup.", "warning");
  } else {
    state.isManuallyDisconnected = false;
    state.socket.connect();
    logEvent("SIMULATION", "Client reconnected", "event-join");
    showToast("Reconnected to server.", "success");
  }
});

// Copy Socket ID
elements.copySocketBtn.addEventListener("click", () => {
  if (state.socketId) {
    navigator.clipboard.writeText(state.socketId).then(() => {
      showToast("Socket ID copied to clipboard!", "success");
    });
  }
});

// Clear Logs
elements.clearLogsBtn.addEventListener("click", () => {
  elements.eventStream.innerHTML = `<div class="stream-empty">No events yet</div>`;
});

// ================= EVENT LOGGING =================
function logEvent(type, text, badgeClass) {
  const emptyPlaceholder = elements.eventStream.querySelector(".stream-empty");
  if (emptyPlaceholder) {
    emptyPlaceholder.remove();
  }

  const item = document.createElement("div");
  item.className = "event-item";

  const timeStr = new Date().toLocaleTimeString();

  item.innerHTML = `
    <div class="event-item-header">
      <span class="event-type-badge ${badgeClass}">${escapeHtml(type)}</span>
      <span class="event-time">${timeStr}</span>
    </div>
    <div class="event-details">${escapeHtml(text)}</div>
  `;

  elements.eventStream.insertBefore(item, elements.eventStream.firstChild);

  // Keep max 50 items
  while (elements.eventStream.children.length > 50) {
    elements.eventStream.removeChild(elements.eventStream.lastChild);
  }
}

// Toast helper
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Global exposure for onclick handlers
window.handleLock = handleLock;
window.handleUnlock = handleUnlock;

// Kick off
document.addEventListener("DOMContentLoaded", () => {
  renderDashboard();
  initializeSocket();
});
