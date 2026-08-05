import { startRefreshLoop, startServer } from "./lib/server.js";

const port = Number(process.env.VIBE_DECK_PORT || 17823);

const server = startServer(port);
// Collection runs on its own cadence so /status is always a cache read.
startRefreshLoop();
console.log(
  `[vibe-deck-bridge] listening on http://127.0.0.1:${port} demo=${process.env.VIBE_DECK_DEMO === "1"}`,
);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
