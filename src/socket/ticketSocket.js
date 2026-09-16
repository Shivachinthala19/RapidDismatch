/**
 * Socket.IO Ticket Locking Event Handlers
 */

const {
  acquireLock,
  releaseLock,
  releaseAllForSocket,
  getAllLocks
} = require("../state/ticketLocks");
const { validateTicketId } = require("../utils/validation");

/**
 * Initializes ticket locking socket event listeners.
 * 
 * @param {import("socket.io").Server} io 
 */
function registerTicketSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`[CONNECT] Socket connected: ${socket.id}`);

    // Helper to safely invoke client acknowledgement callbacks
    const respond = (callback, data) => {
      if (typeof callback === "function") {
        try {
          callback(data);
        } catch (err) {
          console.error(`[ERROR] Failed to invoke callback for socket ${socket.id}:`, err);
        }
      }
    };

    /**
     * 1. JOIN DASHBOARD
     * Client announces presence on dashboard and requests current lock state.
     */
    socket.on("join_dashboard", (payload, callback) => {
      // Support invocation with or without payload argument: socket.emit("join_dashboard", ackCallback)
      const ack = typeof payload === "function" ? payload : callback;

      console.log(`[JOIN] Socket ${socket.id} joined dashboard`);

      const locks = getAllLocks();

      // Send initial snapshot to the newly connected client
      socket.emit("current_ticket_locks", {
        locks,
        timestamp: new Date().toISOString()
      });

      respond(ack, {
        success: true,
        locks
      });
    });

    /**
     * 2. LOCK TICKET
     * Request to acquire a lock on a specific ticket.
     */
    socket.on("lock_ticket", (payload, callback) => {
      const ack = typeof payload === "function" ? payload : callback;
      const data = typeof payload === "object" && payload !== null ? payload : {};
      const rawTicketId = data.ticketId;

      const validation = validateTicketId(rawTicketId);
      if (!validation.valid) {
        const errorResponse = {
          success: false,
          error: validation.error,
          ticketId: rawTicketId
        };
        socket.emit("lock_error", errorResponse);
        respond(ack, errorResponse);
        return;
      }

      const ticketId = validation.sanitizedId;
      const lockResult = acquireLock(ticketId, socket.id);

      if (!lockResult.success) {
        console.log(`[LOCK REJECTED] Ticket ${ticketId} requested by ${socket.id} is already locked by ${lockResult.lockedBy}`);
        const errorResponse = {
          success: false,
          error: "Ticket is already locked",
          ticketId,
          lockedBy: lockResult.lockedBy
        };
        socket.emit("lock_error", errorResponse);
        respond(ack, errorResponse);
        return;
      }

      console.log(`[LOCK] Ticket ${ticketId} locked by ${socket.id}`);

      // Broadcast the lock acquisition to ALL connected clients
      io.emit("ticket_locked", {
        ticketId,
        lockedBy: socket.id,
        timestamp: new Date().toISOString()
      });

      const successResponse = {
        success: true,
        ticketId,
        lockedBy: socket.id
      };

      socket.emit("lock_success", successResponse);
      respond(ack, successResponse);
    });

    /**
     * 3. UNLOCK TICKET
     * Request to release a lock currently held by this socket.
     */
    socket.on("unlock_ticket", (payload, callback) => {
      const ack = typeof payload === "function" ? payload : callback;
      const data = typeof payload === "object" && payload !== null ? payload : {};
      const rawTicketId = data.ticketId;

      const validation = validateTicketId(rawTicketId);
      if (!validation.valid) {
        const errorResponse = {
          success: false,
          error: validation.error,
          ticketId: rawTicketId
        };
        socket.emit("unlock_error", errorResponse);
        respond(ack, errorResponse);
        return;
      }

      const ticketId = validation.sanitizedId;
      const unlockResult = releaseLock(ticketId, socket.id);

      if (!unlockResult.success) {
        console.log(`[UNLOCK REJECTED] Socket ${socket.id} failed to unlock ${ticketId}: ${unlockResult.error}`);
        const errorResponse = {
          success: false,
          error: unlockResult.error,
          ticketId,
          lockedBy: unlockResult.lockedBy
        };
        socket.emit("unlock_error", errorResponse);
        respond(ack, errorResponse);
        return;
      }

      console.log(`[UNLOCK] Ticket ${ticketId} unlocked by ${socket.id}`);

      // Broadcast release to ALL connected clients
      io.emit("ticket_unlocked", {
        ticketId,
        reason: "manual_unlock",
        unlockedBy: socket.id,
        timestamp: new Date().toISOString()
      });

      const successResponse = {
        success: true,
        ticketId
      };

      socket.emit("unlock_success", successResponse);
      respond(ack, successResponse);
    });

    /**
     * 4. GHOST DISCONNECT HANDLING
     * Automatically release all locks held by this socket when connection drops abruptly.
     */
    socket.on("disconnect", (reason) => {
      console.log(`[DISCONNECT] Socket ${socket.id} disconnected (reason: ${reason})`);

      const releasedTicketIds = releaseAllForSocket(socket.id);

      if (releasedTicketIds.length > 0) {
        for (const ticketId of releasedTicketIds) {
          console.log(`[GHOST RELEASE] Ticket ${ticketId} released because socket ${socket.id} disconnected`);

          // Broadcast ticket release to all remaining connected clients
          io.emit("ticket_unlocked", {
            ticketId,
            reason: "agent_disconnected",
            previousOwner: socket.id,
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    /**
     * Error boundary for socket errors
     */
    socket.on("error", (err) => {
      console.error(`[SOCKET ERROR] Socket ${socket.id} error:`, err);
    });
  });
}

module.exports = {
  registerTicketSocketHandlers
};
