import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 9333);
const timeoutMs = Number(process.argv[3] || 30000);
const settleMs = Number(process.argv[4] || 5000);
const runtimePath = path.join(__dirname, "rtl-runtime-fix.js");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`Invalid DevTools port: ${process.argv[2]}`);
}

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
  fail(`Invalid timeout: ${process.argv[3]}`);
}

if (!Number.isInteger(settleMs) || settleMs < 0) {
  fail(`Invalid settle time: ${process.argv[4]}`);
}

if (!fs.existsSync(runtimePath)) {
  fail(`Could not find runtime script at ${runtimePath}`);
}

const runtimeSource = fs.readFileSync(runtimePath, "utf8");
const expression = `${runtimeSource}\n//# sourceURL=codex-rtl-runtime-fix.js`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function isInjectableTarget(target) {
  if (!target.webSocketDebuggerUrl) return false;
  if (target.url?.startsWith("devtools://")) return false;
  if (target.url === "about:blank" && !target.title) return false;
  return ["page", "webview", "other"].includes(target.type);
}

async function listInjectableTargets() {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  return targets.filter(isInjectableTarget);
}

function targetKey(target) {
  return target.id || target.webSocketDebuggerUrl || `${target.type}:${target.url}`;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!payload.id || !this.pending.has(payload.id)) return;
      const { resolve, reject } = this.pending.get(payload.id);
      this.pending.delete(payload.id);

      if (payload.error) {
        reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      } else {
        resolve(payload.result || {});
      }
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${this.url}`)), 10000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`Could not connect to ${this.url}`));
      }, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // Best effort.
    }
  }
}

async function injectTarget(target, { registerNewDocuments }) {
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  try {
    await client.send("Runtime.enable").catch(() => {});
    await client.send("Page.enable").catch(() => {});
    if (registerNewDocuments) {
      await client.send("Page.addScriptToEvaluateOnNewDocument", { source: expression }).catch(() => {});
    }
    await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: false,
      returnByValue: true,
    });
    const verification = await client.send("Runtime.evaluate", {
      expression: `(() => {
        window.__codexRtlRuntimeFix?.scan?.();
        return {
          runtime: Boolean(window.__codexRtlRuntimeFix),
          style: Boolean(document.getElementById("codex-rtl-runtime-fix-style")),
          fixedCount: document.querySelectorAll("[data-codex-rtl-fixed]").length,
          readyState: document.readyState
        };
      })()`,
      awaitPromise: false,
      returnByValue: true,
    }).catch(() => null);

    return verification?.result?.value || null;
  } finally {
    client.close();
  }
}

try {
  const startedAt = Date.now();
  const registeredTargets = new Set();
  const injectedTargets = new Set();
  let injected = 0;
  const errors = [];
  let lastError = null;
  let lastChangeAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    let targets = [];
    try {
      targets = await listInjectableTargets();
      if (targets.length === 0) {
        lastError = new Error("DevTools is open but no injectable Codex webview target is ready yet.");
      }
    } catch (error) {
      lastError = error;
    }

    for (const target of targets) {
      const key = targetKey(target);
      const registerNewDocuments = !registeredTargets.has(key);

      try {
        const verification = await injectTarget(target, { registerNewDocuments });
        registeredTargets.add(key);

        if (!injectedTargets.has(key)) {
          injectedTargets.add(key);
          injected += 1;
          lastChangeAt = Date.now();
          const status = verification
            ? ` runtime=${verification.runtime} style=${verification.style} fixed=${verification.fixedCount} ready=${verification.readyState}`
            : "";
          console.log(`Injected RTL fix into ${target.type}: ${target.title || target.url || "Codex target"}${status}`);
        }
      } catch (error) {
        const message = `${target.title || target.url || target.id}: ${error.message}`;
        if (!errors.includes(message)) errors.push(message);
      }
    }

    if (injected > 0 && Date.now() - lastChangeAt >= settleMs) break;
    await sleep(500);
  }

  if (injected === 0) {
    fail(
      `Could not inject RTL fix into any Codex target within ${timeoutMs}ms.\n` +
        `Last DevTools error: ${lastError?.message || "unknown"}\n` +
        errors.join("\n"),
    );
  }

  if (errors.length > 0) {
    console.warn(`Injected ${injected} target(s), with ${errors.length} non-fatal target error(s):`);
    for (const error of errors) console.warn(`- ${error}`);
  }
} catch (error) {
  fail(error.message);
}
