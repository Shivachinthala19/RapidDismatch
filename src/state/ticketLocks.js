/**
 * In-Memory Ticket Lock State Management
 * 
 * Authoritative source of truth for active ticket locks.
 * Stored entirely in memory via JavaScript Map().
 */

const ticketLocks = new Map();

/**
 * Attempts to acquire a lock on a ticket for a specific socket ID.
 * Synchronous check-and-set guarantees atomic execution in Node.js event loop.
 * 
 * @param {string} ticketId 
 * @param {string} socketId 
 * @returns {{ success: boolean, error?: string, lockedBy?: string }}
 */
function acquireLock(ticketId, socketId) {
  if (!ticketLocks.has(ticketId)) {
    ticketLocks.set(ticketId, socketId);
    return { success: true, ticketId, lockedBy: socketId };
  }

  const existingOwner = ticketLocks.get(ticketId);
  if (existingOwner === socketId) {
    return { success: true, ticketId, lockedBy: socketId, alreadyOwned: true };
  }

  return {
    success: false,
    error: "Ticket is already locked",
    ticketId,
    lockedBy: existingOwner
  };
}

/**
 * Releases a lock if owned by the requesting socket.
 * 
 * @param {string} ticketId 
 * @param {string} socketId 
 * @returns {{ success: boolean, error?: string, lockedBy?: string }}
 */
function releaseLock(ticketId, socketId) {
  if (!ticketLocks.has(ticketId)) {
    return {
      success: false,
      error: "Ticket is not locked",
      ticketId
    };
  }

  const currentOwner = ticketLocks.get(ticketId);
  if (currentOwner !== socketId) {
    return {
      success: false,
      error: "Unauthorized: Ticket is locked by another agent",
      ticketId,
      lockedBy: currentOwner
    };
  }

  ticketLocks.delete(ticketId);
  return { success: true, ticketId };
}

/**
 * Releases ALL tickets locked by a specific socket (Ghost Disconnect handler).
 * 
 * @param {string} socketId 
 * @returns {string[]} Array of ticket IDs released
 */
function releaseAllForSocket(socketId) {
  const releasedTicketIds = [];

  for (const [ticketId, lockedBy] of ticketLocks.entries()) {
    if (lockedBy === socketId) {
      ticketLocks.delete(ticketId);
      releasedTicketIds.push(ticketId);
    }
  }

  return releasedTicketIds;
}

/**
 * Returns all active locks as an object: { [ticketId]: socketId }
 * @returns {Record<string, string>}
 */
function getAllLocks() {
  return Object.fromEntries(ticketLocks);
}

/**
 * Returns the socket ID holding the lock for a given ticket, or null.
 * @param {string} ticketId 
 * @returns {string|null}
 */
function getLockOwner(ticketId) {
  return ticketLocks.get(ticketId) || null;
}

/**
 * Clears all locks in memory (primarily used for test isolation).
 */
function clearAllLocks() {
  ticketLocks.clear();
}

/**
 * Returns total count of active locks.
 * @returns {number}
 */
function getActiveLockCount() {
  return ticketLocks.size;
}

module.exports = {
  ticketLocks,
  acquireLock,
  releaseLock,
  releaseAllForSocket,
  getAllLocks,
  getLockOwner,
  clearAllLocks,
  getActiveLockCount
};
