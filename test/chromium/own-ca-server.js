// Serves https://localhost:9443/ with a certificate the image's own CA signed,
// runs the command it is given, and exits with that command's code. Usage:
// node own-ca-server.js <command> [args...]
// Loopback never reaches the proxy, so only the step's own NSS database can
// make Chromium trust this server.
const https = require("https");
const fs = require("fs");
const { spawn } = require("child_process");

const [command, ...args] = process.argv.slice(2);
const server = https.createServer(
  {
    key: fs.readFileSync("/opt/own-ca/server.key"),
    cert: fs.readFileSync("/opt/own-ca/server.pem"),
  },
  (_, res) => res.end("own CA"),
);
server.listen(9443, "127.0.0.1", () => {
  // Async so the server keeps answering while the command runs.
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("exit", (code) => {
    server.close();
    process.exit(code ?? 1);
  });
});
