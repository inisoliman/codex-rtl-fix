const port = Number(process.argv[2] || 9333);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
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
      const payload = JSON.parse(event.data);
      if (!payload.id || !this.pending.has(payload.id)) return;
      const callbacks = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      payload.error ? callbacks.reject(new Error(payload.error.message)) : callbacks.resolve(payload.result || {});
    });

    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`Could not connect to ${this.url}`)), { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 10000);
    });
  }

  close() {
    this.ws.close();
  }
}

const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!target) throw new Error("No Codex page target found.");

const client = new CdpClient(target.webSocketDebuggerUrl);
await client.connect();
try {
  const expression = `(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const arabic = /[\\u0600-\\u06ff]/;
    const textEls = all
      .filter((el) => arabic.test(el.innerText || el.textContent || ""))
      .slice(0, 30)
      .map((el) => ({
        tag: el.tagName,
        cls: String(el.className || "").slice(0, 160),
        role: el.getAttribute("role"),
        testid: el.getAttribute("data-testid"),
        dir: el.getAttribute("dir"),
        fixed: el.getAttribute("data-codex-rtl-fixed"),
        text: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").slice(0, 180)
      }));
    return {
      href: location.href,
      title: document.title,
      runtime: Boolean(window.__codexRtlRuntimeFix),
      style: Boolean(document.getElementById("codex-rtl-runtime-fix-style")),
      fixedCount: document.querySelectorAll("[data-codex-rtl-fixed]").length,
      textEls
    };
  })()`;
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  console.log(JSON.stringify(result.result.value, null, 2));
} finally {
  client.close();
}
