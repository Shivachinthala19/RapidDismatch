/**
 * Automated Test Suite for Real-time Ticket Locking System
 * 
 * Verifies:
 * 1. Successful lock
 * 2. Duplicate lock rejection (concurrency & mutual exclusion)
 * 3. Successful unlock by lock owner
 * 4. Unauthorized unlock rejection by non-owner
 * 5. Disconnect releases single ticket (Ghost Disconnect cleanup)
 * 6. Disconnect releases multiple tickets owned by the same socket
 * 7. Multiple clients receiving real-time broadcasts
 * 8. Dashboard synchronization on join_dashboard
 * 9. Input validation (empty / invalid ticketId)
 * 10. Simultaneous lock contention (race condition prevention)
 */

const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const ioClient = require("socket.io-client");
const assert = require("assert");

const { registerTicketSocketHandlers } = require("../src/socket/ticketSocket");
const { clearAllLocks, getAllLocks, acquireLock } = require("../src/state/ticketLocks");
const healthRoutes = require("../src/routes/health");

// Helper to create a test server on a free port
function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api", healthRoutes);

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  registerTicketSocketHandlers(io);

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const port = httpServer.address().port;
      resolve({ httpServer, io, port });
    });
  });
}

// Helper to create a connected client socket
function connectClient(port) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false
    });

    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

// Helper to wait for a specific socket event
function waitForEvent(socket, eventName, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${eventName}" (${timeoutMs}ms)`));
    }, timeoutMs);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Small sleep helper
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function runTests() {
  console.log("\n=======================================================");
  console.log("🧪 RUNNING REAL-TIME TICKET LOCKING AUTOMATED TESTS");
  console.log("=======================================================\n");

  const { httpServer, io, port } = await createTestServer();
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    clearAllLocks();
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}\n`, err.stack);
    }
  }

  try {
    // TEST 1: Successful Lock
    await test("1. Successful lock acquires lock and broadcasts ticket_locked", async () => {
      const clientA = await connectClient(port);
      const clientB = await connectClient(port);

      const broadcastPromise = waitForEvent(clientB, "ticket_locked");

      const response = await new Promise((resolve) => {
        clientA.emit("lock_ticket", { ticketId: "TICKET-101" }, resolve);
      });

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.ticketId, "TICKET-101");
      assert.strictEqual(response.lockedBy, clientA.id);

      const broadcastData = await broadcastPromise;
      assert.strictEqual(broadcastData.ticketId, "TICKET-101");
      assert.strictEqual(broadcastData.lockedBy, clientA.id);

      clientA.disconnect();
      clientB.disconnect();
    });

    // TEST 2: Duplicate Lock Rejection
    await test("2. Duplicate lock attempt by another agent is rejected", async () => {
      const clientA = await connectClient(port);
      const clientB = await connectClient(port);

      // Client A acquires lock
      await new Promise((resolve) => {
        clientA.emit("lock_ticket", { ticketId: "TICKET-102" }, resolve);
      });

      // Client B tries to lock the same ticket
      const rejectResponse = await new Promise((resolve) => {
        clientB.emit("lock_ticket", { ticketId: "TICKET-102" }, resolve);
      });

      assert.strictEqual(rejectResponse.success, false);
      assert.strictEqual(rejectResponse.error, "Ticket is already locked");
      assert.strictEqual(rejectResponse.lockedBy, clientA.id);

      clientA.disconnect();
      clientB.disconnect();
    });

    // TEST 3: Successful Unlock by Owner
    await test("3. Successful unlock releases lock and broadcasts ticket_unlocked", async () => {
      const clientA = await connectClient(port);
      const clientB = await connectClient(port);

      // Lock ticket
      await new Promise((resolve) => {
        clientA.emit("lock_ticket", { ticketId: "TICKET-103" }, resolve);
      });

      const unlockBroadcastPromise = waitForEvent(clientB, "ticket_unlocked");

      // Unlock ticket
      const unlockResponse = await new Promise((resolve) => {
        clientA.emit("unlock_ticket", { ticketId: "TICKET-103" }, resolve);
      });

      assert.strictEqual(unlockResponse.success, true);
      assert.strictEqual(unlockResponse.ticketId, "TICKET-103");

      const unlockBroadcast = await unlockBroadcastPromise;
      assert.strictEqual(unlockBroadcast.ticketId, "TICKET-103");
      assert.strictEqual(unlockBroadcast.unlockedBy, clientA.id);

      clientA.disconnect();
      clientB.disconnect();
    });

    // TEST 4: Unauthorized Unlock Rejection
    await test("4. Unauthorized unlock attempt by non-owner is rejected", async () => {
      const clientA = await connectClient(port);
      const clientB = await connectClient(port);

      // Client A locks ticket
      await new Promise((resolve) => {
        clientA.emit("lock_ticket", { ticketId: "TICKET-104" }, resolve);
      });

      // Client B attempts to unlock Client A's ticket
      const unlockResponse = await new Promise((resolve) => {
        clientB.emit("unlock_ticket", { ticketId: "TICKET-104" }, resolve);
      });

      assert.strictEqual(unlockResponse.success, false);
      assert.ok(unlockResponse.error.includes("Unauthorized"));

      // Verify lock is still active and owned by A
      const locks = getAllLocks();
      assert.strictEqual(locks["TICKET-104"], clientA.id);

      clientA.disconnect();
      clientB.disconnect();
    });

    // TEST 5: Ghost Disconnect Single Ticket Release
    await test("5. Ghost Disconnect: Abrupt disconnect releases single locked ticket", async () => {
      const clientA = await connectClient(port);
      const clientB = await connectClient(port);

      const agentAId = clientA.id;

      // Client A locks ticket
      await new Promise((resolve) => {
        clientA.emit("lock_ticket", { ticketId: "TICKET-105" }, resolve);
      });

      const ghostUnlockPromise = waitForEvent(clientB, "ticket_unlocked");

      // Client A crashes / abruptly closes tab
      clientA.disconnect();

      const ghostEvent = await ghostUnlockPromise;
      assert.strictEqual(ghostEvent.ticketId, "TICKET-105");
      assert.strictEqual(ghostEvent.reason, "agent_disconnected");
      assert.strictEqual(ghostEvent.previousOwner, agentAId);

      // Verify in-memory map no longer has the lock
      const locks = getAllLocks();
      assert.strictEqual(locks["TICKET-105"], undefined);

      // Verify Client B can now lock it successfully
      const lockResponse = await new Promise((resolve) => {
        clientB.emit("lock_ticket", { ticketId: "TICKET-105" }, resolve);
      });
      assert.strictEqual(lockResponse.success, true);

      clientB.disconnect();
    });

    // TEST 6: Ghost Disconnect Multiple Tickets Release
    await test("6. Ghost Disconnect: Disconnecting socket releases ALL its held tickets", async () => {
      const clientA = await connectClient(port);
      const clientB = await connectClient(port);

      // Client A locks 3 tickets
      await new Promise((res) => clientA.emit("lock_ticket", { ticketId: "TICKET-201" }, res));
      await new Promise((res) => clientA.emit("lock_ticket", { ticketId: "TICKET-202" }, res));
      await new Promise((res) => clientA.emit("lock_ticket", { ticketId: "TICKET-203" }, res));

      assert.strictEqual(Object.keys(getAllLocks()).length, 3);

      const receivedUnlocks = [];
      clientB.on("ticket_unlocked", (data) => {
        receivedUnlocks.push(data);
      });

      // Disconnect Client A
      clientA.disconnect();

      // Give event loop time to emit disconnect events
      await delay(200);

      assert.strictEqual(receivedUnlocks.length, 3);
      assert.ok(receivedUnlocks.some((e) => e.ticketId === "TICKET-201" && e.reason === "agent_disconnected"));
      assert.ok(receivedUnlocks.some((e) => e.ticketId === "TICKET-202" && e.reason === "agent_disconnected"));
      assert.ok(receivedUnlocks.some((e) => e.ticketId === "TICKET-203" && e.reason === "agent_disconnected"));

      // In-memory state must be empty
      assert.strictEqual(Object.keys(getAllLocks()).length, 0);

      clientB.disconnect();
    });

    // TEST 7: Multiple Clients Receiving Real-Time Broadcasts
    await test("7. All connected clients receive real-time lock/unlock broadcasts", async () => {
      const clients = await Promise.all([
        connectClient(port),
        connectClient(port),
        connectClient(port),
        connectClient(port)
      ]);

      const [sender, ...receivers] = clients;

      const promises = receivers.map((c) => waitForEvent(c, "ticket_locked"));

      sender.emit("lock_ticket", { ticketId: "TICKET-BROADCAST" });

      const results = await Promise.all(promises);
      for (const res of results) {
        assert.strictEqual(res.ticketId, "TICKET-BROADCAST");
        assert.strictEqual(res.lockedBy, sender.id);
      }

      clients.forEach((c) => c.disconnect());
    });

    // TEST 8: Dashboard Synchronization on join_dashboard
    await test("8. join_dashboard returns current snapshot of all active locks", async () => {
      // Pre-seed some locks
      acquireLock("TICKET-SYNC-1", "mock-socket-1");
      acquireLock("TICKET-SYNC-2", "mock-socket-2");

      const client = await connectClient(port);

      const snapshotPromise = waitForEvent(client, "current_ticket_locks");
      client.emit("join_dashboard");

      const snapshot = await snapshotPromise;
      assert.strictEqual(snapshot.locks["TICKET-SYNC-1"], "mock-socket-1");
      assert.strictEqual(snapshot.locks["TICKET-SYNC-2"], "mock-socket-2");

      client.disconnect();
    });

    // TEST 9: Validation and Error Handling
    await test("9. Rejects invalid or missing ticketId payloads gracefully", async () => {
      const client = await connectClient(port);

      // Missing ticketId
      const res1 = await new Promise((res) => client.emit("lock_ticket", {}, res));
      assert.strictEqual(res1.success, false);
      assert.ok(res1.error.includes("ticketId is required"));

      // Empty string ticketId
      const res2 = await new Promise((res) => client.emit("lock_ticket", { ticketId: "   " }, res));
      assert.strictEqual(res2.success, false);
      assert.ok(res2.error.includes("ticketId cannot be empty"));

      // Non-existent unlock
      const res3 = await new Promise((res) => client.emit("unlock_ticket", { ticketId: "TICKET-DOES-NOT-EXIST" }, res));
      assert.strictEqual(res3.success, false);
      assert.ok(res3.error.includes("Ticket is not locked"));

      client.disconnect();
    });

    // TEST 10: Race Condition / Concurrency Lock Safety
    await test("10. Server authoritatively resolves simultaneous race condition for same ticket", async () => {
      const client1 = await connectClient(port);
      const client2 = await connectClient(port);

      // Both clients fire lock_ticket at the exact same instant
      const [res1, res2] = await Promise.all([
        new Promise((res) => client1.emit("lock_ticket", { ticketId: "TICKET-RACE" }, res)),
        new Promise((res) => client2.emit("lock_ticket", { ticketId: "TICKET-RACE" }, res))
      ]);

      // Exactly one must succeed, exactly one must fail
      const successes = [res1, res2].filter((r) => r.success === true);
      const failures = [res1, res2].filter((r) => r.success === false);

      assert.strictEqual(successes.length, 1, "Exactly one client should succeed in acquiring lock");
      assert.strictEqual(failures.length, 1, "Exactly one client should be rejected");
      assert.strictEqual(failures[0].error, "Ticket is already locked");

      client1.disconnect();
      client2.disconnect();
    });

  } finally {
    // Cleanup HTTP server
    httpServer.close();
  }

  console.log("\n=======================================================");
  console.log(`📊 TEST SUMMARY: ${passed} / ${total} Tests Passed (${Math.round((passed / total) * 100)}%)`);
  console.log("=======================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

// Run test suite
runTests().catch((err) => {
  console.error("Test suite runtime failure:", err);
  process.exit(1);
});
