import { createServer } from "node:http";

// Encode once, before readiness. Request handlers do no JSON generation.
const records = Array.from({ length: 1000 }, (_, id) => ({
  id,
  name: `item-${id}`,
  amount: id % 100,
  active: id % 2 === 0,
}));
const body = JSON.stringify(records);
let requests = 0;
const server = createServer((req, res) => {
  if (req.method !== "GET" || req.url !== "/data") {
    res.writeHead(404).end();
    return;
  }
  requests++;
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
});
server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
server.listen(31337, "127.0.0.1", () => process.send?.({ ready: true }));
process.on("message", (message) => {
  if (message === "stats") process.send?.({ requests });
});
// If the supervisor exits unexpectedly, do not leave an orphan fixture server.
process.on("disconnect", () => process.exit(0));
