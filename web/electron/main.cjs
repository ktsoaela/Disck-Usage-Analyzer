"use strict";

const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const webDir = path.resolve(__dirname, "..");
const iconPath = path.join(__dirname, "icon.ico");
let server = null;
let ownsServer = false;

function probe(hostname, port, family) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ready);
    };
    const options = { hostname, port, path: "/" };
    if (family) options.family = family;
    const req = http.get(options, (res) => {
      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        chunks.push(chunk);
        if (chunks.join("").length > 200_000) res.destroy();
      });
      res.on("end", () => finish(chunks.join("").includes("Disk Usage Analyzer")));
      res.on("error", () => finish(false));
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish(false);
    }, 2000);
    req.on("error", () => finish(false));
  });
}

async function studioReady(port) {
  if (await probe("::1", port, 6)) return true;
  if (await probe("127.0.0.1", port, 4)) return true;
  return probe("localhost", port);
}

function waitFor(port, limitMs) {
  const deadline = Date.now() + limitMs;
  return new Promise((resolve) => {
    const tick = async () => {
      if (await studioReady(port)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

function launch(command, args, options) {
  let log = "";
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const keep = (chunk) => {
    log = (log + chunk.toString()).slice(-1500);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  child.logTail = () => log.trim();
  return child;
}

function stopServer() {
  if (!ownsServer || !server || server.killed) return;
  const pid = server.pid;
  ownsServer = false;
  if (process.platform === "win32" && pid) {
    spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" });
  } else {
    server.kill();
  }
  server = null;
}

function watchServer(child) {
  server = child;
  ownsServer = true;
  child.on("exit", () => {
    if (server === child) server = null;
  });
}

async function startOwned(child, port, limitMs) {
  watchServer(child);
  if (await waitFor(port, limitMs)) return;
  const detail = child.logTail?.();
  stopServer();
  throw new Error(detail ? `The 3D studio did not start.\n\n${detail}` : "The 3D studio did not start.");
}

async function startBundled() {
  const dir = path.join(process.resourcesPath, "studio");
  const entry = path.join(dir, "server.js");
  if (!fs.existsSync(entry)) {
    throw new Error("The studio files are missing from this install.");
  }
  const port = 3847;
  const child = launch(process.execPath, [entry], {
    cwd: dir,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
  });
  await startOwned(child, port, 45_000);
  return `http://127.0.0.1:${port}`;
}

async function startDev() {
  const port = 3000;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = launch(npm, ["run", "dev", "--", "-p", String(port)], {
    cwd: webDir,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  await startOwned(child, port, 90_000);
  return `http://localhost:${port}`;
}

async function prepare() {
  if (app.isPackaged) return startBundled();
  if (await studioReady(3000)) return "http://localhost:3000";
  return startDev();
}

function openWindow(url) {
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    x: 40,
    y: 40,
    minWidth: 820,
    minHeight: 500,
    title: "Disk Usage Analyzer 3D",
    icon: iconPath,
    backgroundColor: "#07080b",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.loadURL(url);
}

app.setAppUserModelId("com.khotso.disk-usage-analyzer");

app.whenReady().then(async () => {
  try {
    const url = await prepare();
    console.log(`Opening ${url}`);
    openWindow(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The studio did not open.";
    console.error(message);
    dialog.showErrorBox("Disk Usage Analyzer 3D", message);
    app.quit();
  }
});

app.on("before-quit", stopServer);
app.on("window-all-closed", () => app.quit());
