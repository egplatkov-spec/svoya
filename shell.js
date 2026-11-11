// Оболочка: показывает страницы сайта, который работает в фоновом потоке (worker.js).
// Адрес страницы хранится после «#»: …/svoya/#/schedule — так ссылки можно копировать и отправлять.
(function () {
  "use strict";

  const cfg = window.SVOYA;
  const BASE = new URL(".", location.href).href;
  const HOST = "https://svoya.local";
  const COOKIE_KEY = "svoya_cookies";

  const view = document.getElementById("view");
  const boot = document.getElementById("boot");
  const busy = document.getElementById("busy");
  const statusEl = document.getElementById("status");
  const progressEl = document.getElementById("progress");

  let current = "/";
  let seq = 0;
  const pending = new Map();

  // --- Cookies сайта (сессия входа, CSRF) — храним сами, у страницы в iframe своих нет ---
  function loadJar() {
    try { return JSON.parse(localStorage.getItem(COOKIE_KEY)) || {}; } catch (e) { return {}; }
  }
  let jar = loadJar();
  function saveJar() {
    try { localStorage.setItem(COOKIE_KEY, JSON.stringify(jar)); } catch (e) { /* только в памяти */ }
  }
  function cookieHeader() {
    return Object.entries(jar).map(([k, v]) => k + "=" + v).join("; ");
  }
  function storeCookie(line) {
    const parts = line.split(";").map((s) => s.trim());
    const eq = parts[0].indexOf("=");
    if (eq < 1) return;
    const name = parts[0].slice(0, eq);
    const value = parts[0].slice(eq + 1);
    const attrs = Object.fromEntries(parts.slice(1).map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? [p.toLowerCase(), true] : [p.slice(0, i).toLowerCase(), p.slice(i + 1)];
    }));
    const expired = (attrs["max-age"] !== undefined && Number(attrs["max-age"]) <= 0) ||
      (attrs.expires && Date.parse(attrs.expires) < Date.now()) || value === "" || value === '""' || value === "null";
    if (expired) delete jar[name]; else jar[name] = value;
  }

  // --- Связь с фоновым потоком ---
  const worker = new Worker("worker.js?v=" + cfg.version, { type: "module" });
  let readyResolve, readyReject;
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "progress") {
      progressEl.style.width = m.pct + "%";
      statusEl.textContent = m.text;
    } else if (m.type === "ready") {
      readyResolve();
    } else if (m.type === "fatal") {
      readyReject(new Error(m.error));
    } else if (m.type === "response") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) p(m);
    }
  };
  worker.onerror = (e) => readyReject(new Error(e.message || "worker error"));
  worker.postMessage({ type: "init", cfg: { ...cfg, base: BASE } });

  function send(method, url, body, extraHeaders) {
    const id = ++seq;
    const headers = [["cookie", cookieHeader()], ["referer", HOST + current], ["accept", "text/html"],
      ["user-agent", navigator.userAgent], ...(extraHeaders || [])];
    return new Promise((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ type: "request", id, method, url, headers, body: body || "" });
    });
  }

  // --- Переходы ---
  function localPath(url) {
    if (url.startsWith(HOST)) url = url.slice(HOST.length) || "/";
    return url;
  }

  async function go(url, opts) {
    opts = opts || {};
    let method = opts.method || "GET";
    let body = opts.body || "";
    let headers = opts.headers || [];
    url = localPath(url);
    const hashAt = url.indexOf("#");
    const frag = hashAt >= 0 ? url.slice(hashAt) : "";
    if (hashAt >= 0) url = url.slice(0, hashAt) || "/";
    if (frag && method === "GET" && url === current && view.contentDocument) { // якорь на этой же странице
      view.contentDocument.getElementById(frag.slice(1))?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    busy.classList.add("on");
    try {
      let res;
      for (let hop = 0; hop < 8; hop++) {
        res = await send(method, url, body, headers);
        res.headers.filter(([k]) => k.toLowerCase() === "set-cookie").forEach(([, v]) => storeCookie(v));
        saveJar();
        const loc = res.headers.find(([k]) => k.toLowerCase() === "location");
        if (res.status >= 300 && res.status < 400 && loc) {
          url = localPath(loc[1]);
          method = "GET"; body = ""; headers = [];
          continue;
        }
        break;
      }
      const type = (res.headers.find(([k]) => k.toLowerCase() === "content-type") || [, ""])[1];
      current = url;
      if (opts.push === false) history.replaceState({ url }, "", "#" + url);
      else history.pushState({ url }, "", "#" + url);
      show(type.includes("html") ? res.body : "<pre style='white-space:pre-wrap;padding:16px'>" +
        res.body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</pre>", url + frag);
    } finally {
      busy.classList.remove("on");
    }
  }

  function show(html, url) {
    // Статика (CSS, JS, фото) лежит рядом на GitHub Pages
    html = html.replace(/(href|src)="(?:https:\/\/svoya\.local)?\/static\//g, '$1="' + BASE + "static/")
      .replace(/(href|src|action)="https:\/\/svoya\.local\//g, '$1="/');
    // Подключаемся к странице сразу при разборе, не дожидаясь загрузки фото и шрифтов
    html = html.replace(/<head([^>]*)>/i, "<head$1><script>parent.__svoyaFrame(window)</script>");
    const frag = url.split("#")[1];
    window.__svoyaFrame = (win) => {
      hook(win, win.document);
      win.document.addEventListener("DOMContentLoaded", () => {
        document.title = win.document.title || document.title;
        if (frag) win.document.getElementById(frag)?.scrollIntoView();
        boot.classList.add("hidden");
      });
    };
    view.srcdoc = html;
  }

  function hook(win, doc) {
    doc.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (href.startsWith("#")) {
        e.preventDefault();
        if (href.length > 1) doc.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      if (href.startsWith("/") && !href.startsWith("//")) {
        e.preventDefault();
        if (a.target === "_blank" || e.ctrlKey || e.metaKey) window.open(BASE + "#" + href, "_blank");
        else go(href);
        return;
      }
      if (!a.target) a.target = /^https?:/.test(href) ? "_blank" : "_top"; // внешние ссылки, tel:, mailto:
    });

    // Отправка форм. Слушаем на window, чтобы сначала сработали обработчики сайта (подтверждения).
    win.addEventListener("submit", (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      submit(e.target, e.submitter);
    });
    const proto = win.HTMLFormElement.prototype;
    proto.submit = function () { submit(this, null); };
  }

  function submit(form, submitter) {
    let data;
    try { data = new FormData(form, submitter || undefined); } catch (err) { data = new FormData(form); }
    if (submitter && submitter.name && !data.has(submitter.name)) data.append(submitter.name, submitter.value);
    const method = ((submitter && submitter.getAttribute("formmethod")) || form.getAttribute("method") || "GET").toUpperCase();
    let action = (submitter && submitter.getAttribute("formaction")) || form.getAttribute("action") || current;
    action = localPath(action);
    const params = new URLSearchParams();
    for (const [k, v] of data.entries()) if (typeof v === "string") params.append(k, v);
    if (method === "GET") {
      go(action.split("?")[0] + (params.toString() ? "?" + params : ""));
    } else {
      go(action, { method: "POST", body: params.toString(),
                   headers: [["content-type", "application/x-www-form-urlencoded"]] });
    }
  }

  function urlFromHash() {
    const h = location.hash.slice(1); // уже в URL-кодировке — передаём приложению как есть
    return h.startsWith("/") ? h : "/";
  }

  window.addEventListener("popstate", () => { go(urlFromHash(), { push: false }); });

  ready.then(
    () => go(urlFromHash(), { push: false }),
    (err) => {
      console.error(err);
      statusEl.innerHTML = '<span class="err">Не удалось открыть сайт в этом браузере. ' +
        "Обновите страницу или откройте её в свежей версии Chrome, Safari или Firefox.</span>";
    },
  );
})();
