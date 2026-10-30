// Minimal Chrome DevTools Protocol driver for headless Edge (Node 22+ has a global WebSocket).
import { spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

export async function launch({ port = 9333, profile, width = 1280, height = 800, scale = 1.5 }) {
  const proc = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(200);
  }
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });

  const api = {
    send,
    async goto(url, wait = 2500) { await send("Page.navigate", { url }); await sleep(wait); },
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
      return r.result.value;
    },
    async waitFor(expr, timeout = 30000) {
      const t = Date.now();
      while (Date.now() - t < timeout) { if (await api.eval(`!!(${expr})`)) return true; await sleep(300); }
      throw new Error("timeout waiting for " + expr);
    },
    /** Screenshot the viewport, or the element matched by `selector` (with padding). */
    async shot(file, { selector, pad = 12, full = false } = {}) {
      let clip;
      if (selector) {
        await api.eval("window.__unstick ? (window.__unstick(), true) : true");
        const box = await api.eval(`(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({block:'start'}); const r = e.getBoundingClientRect(); return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height}; })()`);
        if (!box) throw new Error("no element for " + selector);
        await sleep(400);
        clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 };
      } else if (full) {
        const h = await api.eval("document.documentElement.scrollHeight");
        clip = { x: 0, y: 0, width, height: h, scale: 1 };
      }
      const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82, captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
      writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    },
    async close() { try { await send("Browser.close"); } catch {} proc.kill(); },
  };
  return api;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function ensureDir(d) { mkdirSync(d, { recursive: true }); }
