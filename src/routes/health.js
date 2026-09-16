const express = require("express");
const { getAllLocks, getActiveLockCount } = require("../state/ticketLocks");

const router = express.Router();

/**
 * Health check endpoint
 * GET /api/health
 */
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Real-time ticket server is running",
    timestamp: new Date().toISOString()
  });
});

/**
 * Inspection endpoint for debugging in-memory lock state
 * GET /api/ticket-locks
 */
router.get("/ticket-locks", (req, res) => {
  const locks = getAllLocks();
  res.status(200).json({
    success: true,
    activeLocksCount: getActiveLockCount(),
    locks,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
