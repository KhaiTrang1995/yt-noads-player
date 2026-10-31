// Chèn nút đĩa than nổi + khung mini player (iframe mini.html) vào trang YouTube.
// Shadow DOM đóng để CSS của YouTube và của mình không đè nhau.
(() => {
  if (window.top !== window || window.__ytpNoAds) return;
  window.__ytpNoAds = true;

  const MINI_URL = chrome.runtime.getURL("mini.html");
  const EXT_ORIGIN = new URL(MINI_URL).origin;
  const PANEL_W = 360;
  const MARGIN = 12;

  const host = document.createElement("div");
  host.id = "ytp-noads-root";
  host.style.cssText = "all: initial; position: fixed; inset: auto; z-index: 2147483000;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .fab {
        position: fixed; right: 24px; bottom: 24px; width: 54px; height: 54px;
        border-radius: 50%; border: 0; padding: 0; cursor: pointer;
        background: repeating-radial-gradient(circle, #141518 0 1.5px, #1b1c20 1.5px 3px);
        box-shadow: 0 8px 26px rgba(0,0,0,.55), inset 0 0 0 3px #0c0d0f;
        display: grid; place-items: center;
        transition: transform .2s, box-shadow .3s, opacity .2s;
      }
      .fab:hover { transform: scale(1.08); }
      .fab .dot {
        width: 20px; height: 20px; border-radius: 50%;
        background: linear-gradient(135deg, #7ddc8a, #5fcfc4);
        box-shadow: inset 0 0 0 7px transparent;
        display: grid; place-items: center;
      }
      .fab .dot::after { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #0c0d0f; }
      .fab.playing { animation: spin 2.4s linear infinite, glow 1.6s ease-in-out infinite; }
      .fab.open:not(.playing) { opacity: .75; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes glow {
        0%, 100% { box-shadow: 0 8px 26px rgba(0,0,0,.55), inset 0 0 0 3px #0c0d0f, 0 0 0 0 rgba(125,220,138,.55); }
        50% { box-shadow: 0 8px 26px rgba(0,0,0,.55), inset 0 0 0 3px #0c0d0f, 0 0 0 10px rgba(125,220,138,0); }
      }
      .panel {
        position: fixed; width: ${PANEL_W}px; height: min(640px, calc(100vh - 120px));
        border-radius: 20px; overflow: hidden;
        box-shadow: 0 24px 70px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08);
        background: #121418;
        transform-origin: bottom right;
        opacity: 0; transform: translateY(14px) scale(.92); visibility: hidden; pointer-events: none;
        transition: opacity .22s ease, transform .28s cubic-bezier(.2,.9,.3,1.2), visibility 0s .28s;
      }
      .panel.open { opacity: 1; transform: none; visibility: visible; pointer-events: auto; transition-delay: 0s; }
      .panel.dragging { transition: none; }
      iframe { width: 100%; height: 100%; border: 0; display: block; color-scheme: dark; }
      .shield { position: fixed; inset: 0; cursor: grabbing; display: none; }
      .shield.on { display: block; }
      :host([data-fullscreen]) .fab { display: none; }
    </style>
    <div class="panel" part="panel"></div>
    <div class="shield"></div>
    <button class="fab" title="YT NoAds — nghe không quảng cáo" aria-label="Mở YT NoAds"><span class="dot"></span></button>
  `;
  const fab = root.querySelector(".fab");
  const panel = root.querySelector(".panel");
  const shield = root.querySelector(".shield");
  let iframe = null;
  let miniPlaying = false;
  let pos = null; // {left, top} khi người dùng đã kéo

  // ---------- vị trí khung ----------
  function clamp(p) {
    const h = panel.getBoundingClientRect().height || 600;
    return {
      left: Math.min(Math.max(MARGIN, p.left), window.innerWidth - PANEL_W - MARGIN),
      top: Math.min(Math.max(MARGIN, p.top), window.innerHeight - h - MARGIN),
    };
  }

  function applyPos() {
    if (pos) {
      const p = clamp(pos);
      Object.assign(panel.style, { left: `${p.left}px`, top: `${p.top}px`, right: "auto", bottom: "auto" });
    } else {
      Object.assign(panel.style, { right: "24px", bottom: "92px", left: "auto", top: "auto" });
    }
  }

  // ---------- mở / đóng ----------
  function ensureFrame() {
    if (iframe) return;
    iframe = document.createElement("iframe");
    iframe.src = MINI_URL;
    iframe.allow = "autoplay; fullscreen";
    iframe.title = "YT NoAds mini player";
    panel.append(iframe);
  }

  function setOpen(open) {
    if (open) ensureFrame();
    panel.classList.toggle("open", open);
    fab.classList.toggle("open", open);
    chrome.storage.local.set({ ytpOpen: open });
    if (open) applyPos();
  }

  fab.addEventListener("click", () => setOpen(!panel.classList.contains("open")));

  // ---------- gửi thông tin trang cho mini ----------
  const post = (msg) => iframe?.contentWindow?.postMessage({ source: "ytp-host", ...msg }, EXT_ORIGIN);
  const pageTitle = () => document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube( Music)?$/, "");
  let lastPage = "";
  function sendPage(force = false) {
    const key = location.href + "|" + document.title;
    if (!force && key === lastPage) return;
    lastPage = key;
    post({ type: "page", url: location.href, title: pageTitle() });
  }
  document.addEventListener("yt-navigate-finish", () => sendPage());
  setInterval(() => iframe && sendPage(), 1500);

  // Mini đang phát mà video YouTube tự chạy (autoplay, quảng cáo) → dừng video YouTube.
  document.addEventListener("play", (e) => {
    if (miniPlaying && e.target instanceof HTMLMediaElement) e.target.pause();
  }, true);

  // ---------- kéo khung ----------
  let drag = null;
  function startDrag(sx, sy) {
    const r = panel.getBoundingClientRect();
    drag = { sx, sy, left: r.left, top: r.top };
    panel.classList.add("dragging");
    shield.classList.add("on");
  }
  shield.addEventListener("mousemove", (e) => {
    if (!drag) return;
    pos = { left: drag.left + e.screenX - drag.sx, top: drag.top + e.screenY - drag.sy };
    applyPos();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    panel.classList.remove("dragging");
    shield.classList.remove("on");
    if (pos) chrome.storage.local.set({ ytpPos: clamp(pos) });
  };
  shield.addEventListener("mouseup", endDrag);
  shield.addEventListener("mouseleave", endDrag);
  window.addEventListener("resize", () => panel.classList.contains("open") && applyPos());

  // ---------- tin nhắn từ mini ----------
  window.addEventListener("message", (e) => {
    if (!iframe || e.source !== iframe.contentWindow || e.origin !== EXT_ORIGIN) return;
    const msg = e.data || {};
    if (msg.source !== "ytp-mini") return;
    if (msg.type === "ready") sendPage(true);
    else if (msg.type === "hide") setOpen(false);
    else if (msg.type === "drag-start") startDrag(msg.x, msg.y);
    else if (msg.type === "playing") {
      miniPlaying = Boolean(msg.playing);
      fab.classList.toggle("playing", miniPlaying);
      if (miniPlaying) document.querySelectorAll("video").forEach((v) => !v.paused && v.pause());
    }
  });

  // Popup trên thanh công cụ có nút bật/tắt khung.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "ytp-toggle") setOpen(!panel.classList.contains("open"));
  });

  document.addEventListener("fullscreenchange", () => {
    host.toggleAttribute("data-fullscreen", Boolean(document.fullscreenElement));
  });

  (document.body || document.documentElement).append(host);
  chrome.storage.local.get(["ytpPos", "ytpOpen"]).then(({ ytpPos, ytpOpen }) => {
    pos = ytpPos || null;
    if (ytpOpen) setOpen(true);
  });
})();
