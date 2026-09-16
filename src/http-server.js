import { createServer } from "node:http";

const port = Number(process.env.PORT || 3000);
const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("hello\n");
  } else {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found\n");
  }
});

server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, process.env.HOST || "0.0.0.0");
