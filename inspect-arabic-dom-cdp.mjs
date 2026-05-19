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
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.connect();
try {
  const expression = `(() => {
    const arabic = /[\\u0600-\\u06ff]/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!arabic.test(node.nodeValue || "")) return NodeFilter.FILTER_REJECT;
        if ((node.nodeValue || "").trim().length < 4) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const out = [];
    while (out.length < 16) {
      const node = walker.nextNode();
      if (!node) break;
      const chain = [];
      let el = node.parentElement;
      while (el && chain.length < 8) {
        chain.push({
          tag: el.tagName,
          cls: String(el.className || "").slice(0, 140),
          role: el.getAttribute("role"),
          testid: el.getAttribute("data-testid"),
          dir: el.getAttribute("dir"),
          fixed: el.getAttribute("data-codex-rtl-fixed"),
          text: (el.innerText || el.textContent || "").replace(/\\s+/g, " ").slice(0, 120)
        });
        el = el.parentElement;
      }
      out.push({ text: node.nodeValue.replace(/\\s+/g, " ").slice(0, 160), chain });
    }
    return out;
  })()`;
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  console.log(JSON.stringify(result.result.value, null, 2));
} finally {
  client.close();
}
