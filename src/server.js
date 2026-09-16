require("dotenv").config();
const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const healthRoutes = require("./routes/health");
const { registerTicketSocketHandlers } = require("./socket/ticketSocket");

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for Express REST endpoints
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"]
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend client demo
app.use(express.static(path.join(__dirname, "../public")));

// REST API routes
app.use("/api", healthRoutes);

// Create HTTP server attached to Express
const httpServer = http.createServer(app);

// Integrate Socket.IO with the shared HTTP server
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Register real-time event handlers
registerTicketSocketHandlers(io);

// Start server if executed directly
if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Ticket Locking Server is running on port ${PORT}`);
    console.log(`🌐 Dashboard UI: http://localhost:${PORT}`);
    console.log(`🩺 Health API:   http://localhost:${PORT}/api/health`);
    console.log(`🔒 Locks State:  http://localhost:${PORT}/api/ticket-locks`);
    console.log(`=======================================================`);
  });
}

module.exports = {
  app,
  httpServer,
  io
};
