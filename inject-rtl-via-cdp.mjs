import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 9333);
const timeoutMs = Number(process.argv[3] || 30000);
const runtimePath = path.join(__dirname, "rtl-runtime-fix.js");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`Invalid DevTools port: ${process.argv[2]}`);
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

async function waitForTargets() {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const injectable = targets.filter((target) => {
        if (!target.webSocketDebuggerUrl) return false;
        if (target.url?.startsWith("devtools://")) return false;
        return ["page", "webview", "other"].includes(target.type);
      });

      if (injectable.length > 0) return injectable;
      lastError = new Error("DevTools is open but no injectable Codex webview target is ready yet.");
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(
    `Could not reach Codex DevTools at 127.0.0.1:${port} within ${timeoutMs}ms. ` +
      `Make sure Codex was started with --remote-debugging-port=${port}. ` +
      `Last error: ${lastError?.message || "unknown"}`,
  );
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

async function injectTarget(target) {
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  try {
    await client.send("Runtime.enable").catch(() => {});
    await client.send("Page.enable").catch(() => {});
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: expression }).catch(() => {});
    await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: false,
      returnByValue: true,
    });
  } finally {
    client.close();
  }
}

try {
  const targets = await waitForTargets();
  let injected = 0;
  const errors = [];

  for (const target of targets) {
    try {
      await injectTarget(target);
      injected += 1;
      console.log(`Injected RTL fix into ${target.type}: ${target.title || target.url || "Codex target"}`);
    } catch (error) {
      errors.push(`${target.title || target.url || target.id}: ${error.message}`);
    }
  }

  if (injected === 0) {
    fail(`Could not inject RTL fix into any Codex target.\n${errors.join("\n")}`);
  }

  if (errors.length > 0) {
    console.warn(`Injected ${injected} target(s), with ${errors.length} non-fatal target error(s):`);
    for (const error of errors) console.warn(`- ${error}`);
  }
} catch (error) {
  fail(error.message);
}
