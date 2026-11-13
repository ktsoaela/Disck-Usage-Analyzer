"use strict";

const fs = require("node:fs");
const path = require("node:path");

const webDir = path.resolve(__dirname, "..");
const standalone = path.join(webDir, ".next", "standalone");
const dest = path.join(webDir, "studio-bundle");
let source = standalone;

if (!fs.existsSync(path.join(source, "server.js")) && fs.existsSync(path.join(standalone, "web", "server.js"))) {
  source = path.join(standalone, "web");
}

if (!fs.existsSync(path.join(source, "server.js"))) {
  console.error("The studio build is missing. Run npm run build first.");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(source, dest, { recursive: true });
fs.cpSync(path.join(webDir, ".next", "static"), path.join(dest, ".next", "static"), { recursive: true });

const pub = path.join(webDir, "public");
if (fs.existsSync(pub)) {
  fs.cpSync(pub, path.join(dest, "public"), { recursive: true });
}

console.log("Staged the studio for the desktop package.");
