/**
 * Ticket Validation Utilities
 */

/**
 * Validates whether a provided ticket ID is valid.
 * - Must be non-empty string
 * - Length between 1 and 64 characters
 * - Trimmed to avoid whitespace bypass
 * @param {any} ticketId 
 * @returns {{ valid: boolean, error?: string, sanitizedId?: string }}
 */
function validateTicketId(ticketId) {
  if (ticketId === undefined || ticketId === null) {
    return { valid: false, error: "ticketId is required" };
  }

  if (typeof ticketId !== "string" && typeof ticketId !== "number") {
    return { valid: false, error: "ticketId must be a string or number" };
  }

  const sanitized = String(ticketId).trim();

  if (sanitized.length === 0) {
    return { valid: false, error: "ticketId cannot be empty" };
  }

  if (sanitized.length > 64) {
    return { valid: false, error: "ticketId exceeds maximum length of 64 characters" };
  }

  return { valid: true, sanitizedId: sanitized };
}

module.exports = {
  validateTicketId
};
