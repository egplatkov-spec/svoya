// Фоновый поток: запускает Python (Pyodide) и FastAPI-приложение клуба прямо в браузере.
import { loadPyodide } from "./pyodide/pyodide.mjs";

let py = null;
let handler = null;
let queue = Promise.resolve(); // запросы выполняются по одному — SQLite так надёжнее

const progress = (pct, text) => postMessage({ type: "progress", pct, text });

function syncFs(populate) {
  return new Promise((resolve) => {
    try {
      py.FS.syncfs(populate, () => resolve());
    } catch (e) {
      resolve(); // хранилище браузера недоступно (например, приватный режим) — работаем в памяти
    }
  });
}

async function init(cfg) {
  const base = cfg.base;
  progress(10, "Загружаем движок…");
  py = await loadPyodide({ indexURL: base + "pyodide/" });

  progress(40, "Загружаем библиотеки…");
  await py.loadPackage(cfg.packages, { messageCallback: () => {} });
  await py.loadPackage(cfg.extra.map((f) => base + "pyodide/extra/" + f), { messageCallback: () => {} });

  progress(65, "Загружаем сайт…");
  const zip = await (await fetch(base + "app.zip?v=" + cfg.version)).arrayBuffer();
  py.unpackArchive(zip, "zip", { extractDir: "/home/pyodide" });

  py.FS.mkdirTree("/data");
  try {
    py.FS.mount(py.FS.filesystems.IDBFS, {}, "/data");
  } catch (e) { /* без постоянного хранилища */ }
  await syncFs(true);

  progress(80, "Готовим расписание и абонементы…");
  py.globals.set("cfg", py.toPy({ siteUrl: cfg.siteUrl, adminPhone: cfg.adminPhone, adminHash: cfg.adminHash }));
  const created = await py.runPythonAsync(`
import os, secrets, sys
sys.path.insert(0, "/home/pyodide")
from app import browser

key_path = "/data/secret.txt"
if os.path.exists(key_path):
    key = open(key_path).read().strip()
else:
    key = secrets.token_urlsafe(32)
    with open(key_path, "w") as f:
        f.write(key)
browser.configure(cfg["siteUrl"], key)
created = browser.boot(cfg["adminPhone"], cfg["adminHash"])


async def browser_handle(method, url, headers, body):
    status, out_headers, data = await browser.handle(method, url, headers, body.encode("utf-8"))
    return [status, [list(h) for h in out_headers], data.decode("utf-8", "replace")]

created
`);
  if (created) await syncFs(false);
  handler = py.globals.get("browser_handle");
  progress(100, "Готово");
}

async function request(msg) {
  const result = await handler(msg.method, msg.url, py.toPy(msg.headers), msg.body || "");
  const [status, headers, body] = result.toJs();
  result.destroy();
  if (msg.method !== "GET") await syncFs(false); // сохраняем изменения в хранилище браузера
  return { status, headers, body };
}

onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    init(msg.cfg).then(
      () => postMessage({ type: "ready" }),
      (err) => postMessage({ type: "fatal", error: String(err && err.stack || err) }),
    );
    return;
  }
  if (msg.type === "request") {
    queue = queue.then(() => request(msg)).then(
      (res) => postMessage({ type: "response", id: msg.id, ...res }),
      (err) => postMessage({ type: "response", id: msg.id, status: 500, headers: [["content-type", "text/plain"]],
                             body: "Ошибка: " + String(err && err.message || err) }),
    );
  }
};
