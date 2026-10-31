// Mini player nổi trên YouTube (chạy trong iframe do content.js chèn vào trang).
// Hiệu ứng: đĩa than xoay + vòng visualizer theo nhạc (Web Audio), nền ambient từ ảnh bìa, chữ chạy.
import { api } from "./api.js";

const $ = (id) => document.getElementById(id);
const el = {
  ambient: $("ambient"), status: $("status"), drag: $("drag"), expand: $("expand"), hide: $("hide"),
  stage: $("stage"), viz: $("viz"), vinyl: $("vinyl"), cover: $("cover"), media: $("media"),
  meta: document.querySelector(".meta"), titleWrap: document.querySelector(".title-wrap"),
  title: $("title"), artist: $("artist"), cur: $("cur"), dur: $("dur"), progress: $("progress"),
  play: $("play"), playIcon: $("playIcon"), prev: $("prev"), next: $("next"),
  autoplay: $("autoplay"), volume: $("volume"),
  here: $("here"), hereThumb: $("hereThumb"), hereTitle: $("hereTitle"), hereBar: $("hereBar"),
  hereFill: $("hereFill"), hereActions: $("hereActions"), addAudio: $("addAudio"), addVideo: $("addVideo"),
  herePlay: $("herePlay"), msg: $("msg"), count: $("count"), filter: $("filter"), list: $("list"),
  offline: $("offline"),
};

const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
const ICON_PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
const PARENT_ORIGIN = location.ancestorOrigins?.[0] || "*";

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("ytpm." + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("ytpm." + key, JSON.stringify(value)); } catch { /* bỏ qua */ }
  },
};

const state = {
  tracks: [],
  currentId: store.get("currentId", null),
  libraryVersion: -1,
  seeking: false,
  page: { url: null, videoId: null, title: "" },
  watchJob: null,      // job do nút Nghe/Xem tạo
  playWhenDone: false, // tải xong thì phát luôn
  pollTimer: null,
};

const toParent = (msg) => window.parent.postMessage({ source: "ytp-mini", ...msg }, PARENT_ORIGIN);

// ---------- tiện ích ----------
function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host !== "youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|live)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function showMsg(text, isError = false) {
  el.msg.textContent = text;
  el.msg.classList.toggle("error", isError);
}

const current = () => state.tracks.find((t) => t.id === state.currentId) || null;
const isPlaying = () => !el.media.paused && !el.media.ended;

// ---------- Web Audio visualizer ----------
// Media có header CORS cho origin extension → đọc được phổ âm thanh. Nếu lỗi thì bỏ crossorigin, chỉ mất hiệu ứng.
el.media.crossOrigin = "anonymous";
let audioCtx = null, analyser = null, freq = null, corsBroken = false;

function ensureAudioGraph() {
  if (audioCtx || corsBroken) { audioCtx?.resume(); return; }
  try {
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(el.media);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
  } catch (err) {
    console.warn("YT NoAds: không bật được visualizer", err);
  }
}

const BARS = 72;
const levels = new Float32Array(BARS);
const vctx = el.viz.getContext("2d");
let pulse = 0;

function drawViz(t) {
  requestAnimationFrame(drawViz);
  if (document.hidden || el.stage.classList.contains("video")) return;
  const playing = isPlaying();
  if (analyser && playing) analyser.getByteFrequencyData(freq);

  const W = el.viz.width, c = W / 2, r0 = 170, maxLen = 78;
  vctx.clearRect(0, 0, W, W);
  vctx.lineCap = "round";
  vctx.lineWidth = 5;

  let bass = 0;
  for (let i = 0; i < BARS; i++) {
    // Đối xứng trái/phải: nửa vòng dùng dải tần thấp → cao, nửa còn lại soi gương.
    const k = i < BARS / 2 ? i : BARS - 1 - i;
    let target;
    if (analyser && playing) {
      const bin = Math.floor(2 + (k / (BARS / 2)) ** 1.3 * 70);
      target = (freq[bin] / 255) ** 1.6;
    } else {
      target = playing ? 0.18 + 0.12 * Math.sin(t / 260 + i * 0.6) : 0.04 + 0.03 * Math.sin(t / 700 + i * 0.5);
    }
    levels[i] = target > levels[i] ? target : levels[i] * 0.88 + target * 0.12;
    if (k < 6) bass += levels[i];

    const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
    const len = 3 + levels[i] * maxLen;
    const cos = Math.cos(a), sin = Math.sin(a);
    vctx.strokeStyle = `hsla(${150 - 25 * Math.sin(a + t / 2000)}, 70%, ${55 + levels[i] * 20}%, ${0.35 + levels[i] * 0.65})`;
    vctx.beginPath();
    vctx.moveTo(c + cos * r0, c + sin * r0);
    vctx.lineTo(c + cos * (r0 + len), c + sin * (r0 + len));
    vctx.stroke();
  }
  pulse = pulse * 0.7 + Math.min(1, bass / 12) * 0.3;
  document.documentElement.style.setProperty("--pulse", pulse.toFixed(3));
}
requestAnimationFrame(drawViz);

// ---------- phát ----------
function load(track, { autoplay = false, resumeAt = 0 } = {}) {
  state.currentId = track ? track.id : null;
  store.set("currentId", state.currentId);
  if (!track) {
    el.media.removeAttribute("src");
    el.media.load();
  } else {
    el.media.src = api.mediaUrl(track.id);
    store.set("position", resumeAt);
    if (resumeAt > 0) el.media.currentTime = resumeAt;
    if (autoplay) play();
  }
  renderNowPlaying();
  renderList();
}

function play() {
  if (!current()) {
    if (state.tracks.length) load(state.tracks[0], { autoplay: true });
    return;
  }
  ensureAudioGraph();
  el.media.play().catch(() => {});
}

function togglePlay() { isPlaying() ? el.media.pause() : play(); }

function step(delta) {
  if (!state.tracks.length) return;
  if (delta < 0 && el.media.currentTime > 3) { el.media.currentTime = 0; return; }
  const n = state.tracks.length;
  const i = state.tracks.findIndex((t) => t.id === state.currentId);
  load(state.tracks[((i < 0 ? 0 : i + delta) % n + n) % n], { autoplay: true });
}

function setAmbient(url) {
  if (url && /^https:\/\/[^"'()\s]+$/.test(url)) el.ambient.style.backgroundImage = `url("${url}")`;
  else el.ambient.style.removeProperty("background-image");
}

function setTitle(text) {
  el.title.textContent = text;
  el.title.classList.remove("marquee");
  requestAnimationFrame(() => {
    const overflow = el.title.scrollWidth - el.titleWrap.clientWidth;
    if (overflow > 4) {
      el.title.style.setProperty("--marquee-shift", `${-(overflow + 20)}px`);
      el.title.style.setProperty("--marquee-time", `${Math.max(6, overflow / 22)}s`);
      el.title.classList.add("marquee");
    }
  });
}

let lastShownId;
function renderNowPlaying() {
  const t = current();
  if (t?.id !== lastShownId) {
    el.meta.classList.remove("swap");
    void el.meta.offsetWidth; // chạy lại animation đổi bài
    el.meta.classList.add("swap");
    lastShownId = t?.id;
  }
  setTitle(t ? t.title : "Chưa có bài nào");
  el.artist.textContent = t ? (t.artist || "Không rõ nghệ sĩ") : "Thêm video YouTube đang xem bên dưới";
  el.stage.classList.toggle("video", t?.mode === "video");
  if (t?.thumbnail) el.cover.src = t.thumbnail; else el.cover.removeAttribute("src");
  setAmbient(t?.thumbnail);
  el.dur.textContent = fmt(t?.duration);
}

function renderPlayState() {
  const playing = isPlaying();
  el.playIcon.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  el.play.setAttribute("aria-label", playing ? "Tạm dừng" : "Phát");
  el.vinyl.classList.toggle("spinning", playing);
  el.list.classList.toggle("paused", !playing);
  toParent({ type: "playing", playing });
}

function renderProgress() {
  const d = el.media.duration || current()?.duration || 0;
  const c = el.media.currentTime || 0;
  el.cur.textContent = fmt(c);
  if (Number.isFinite(el.media.duration)) el.dur.textContent = fmt(el.media.duration);
  if (!state.seeking) el.progress.value = d ? Math.round((c / d) * 1000) : 0;
  el.progress.style.setProperty("--pct", `${el.progress.value / 10}%`);
}

el.media.addEventListener("play", renderPlayState);
el.media.addEventListener("pause", renderPlayState);
el.media.addEventListener("timeupdate", renderProgress);
el.media.addEventListener("loadedmetadata", renderProgress);
el.media.addEventListener("ended", () => {
  renderPlayState();
  if (el.autoplay.checked && state.tracks.length > 1) step(1);
});
el.media.addEventListener("error", () => {
  if (!current()) return;
  if (el.media.crossOrigin && !audioCtx) {
    // Helper cũ chưa có CORS → phát không hiệu ứng.
    corsBroken = true;
    const at = el.media.currentTime;
    el.media.removeAttribute("crossorigin");
    load(current(), { autoplay: true, resumeAt: at });
    return;
  }
  el.artist.textContent = "Không phát được file này.";
});

let lastSaved = 0;
el.media.addEventListener("timeupdate", () => {
  if (Date.now() - lastSaved > 4000) { store.set("position", el.media.currentTime); lastSaved = Date.now(); }
});

el.progress.addEventListener("input", () => {
  state.seeking = true;
  el.cur.textContent = fmt((el.progress.value / 1000) * (el.media.duration || 0));
  el.progress.style.setProperty("--pct", `${el.progress.value / 10}%`);
});
el.progress.addEventListener("change", () => {
  if (el.media.duration) el.media.currentTime = (el.progress.value / 1000) * el.media.duration;
  state.seeking = false;
});

el.volume.value = Math.round(store.get("volume", 1) * 100);
el.media.volume = el.volume.value / 100;
el.volume.style.setProperty("--pct", `${el.volume.value}%`);
el.volume.addEventListener("input", () => {
  el.media.volume = el.volume.value / 100;
  el.volume.style.setProperty("--pct", `${el.volume.value}%`);
  store.set("volume", el.media.volume);
});

el.play.addEventListener("click", togglePlay);
el.prev.addEventListener("click", () => step(-1));
el.next.addEventListener("click", () => step(1));
el.media.addEventListener("dblclick", () => {
  document.fullscreenElement ? document.exitFullscreen() : el.media.requestFullscreen().catch(() => {});
});
el.autoplay.checked = store.get("autoplay", true);
el.autoplay.addEventListener("change", () => store.set("autoplay", el.autoplay.checked));

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input[type=search], button")) return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
});

// ---------- thư viện ----------
function renderList() {
  const q = el.filter.value.trim().toLowerCase();
  const list = q ? state.tracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q)) : state.tracks;
  el.list.replaceChildren(...list.map((t) => {
    const li = node("li");
    li.dataset.id = t.id;
    li.title = t.artist ? `${t.title} — ${t.artist}` : t.title;
    if (t.id === state.currentId) {
      li.className = "active";
      const eq = node("span", "eq");
      eq.append(node("i"), node("i"), node("i"));
      li.append(eq);
    }
    li.append(node("span", "name", t.title));
    if (t.mode === "video") li.append(node("span", "tag", "VIDEO"));
    li.append(node("span", "time", fmt(t.duration)));
    return li;
  }));
  el.count.textContent = `(${state.tracks.length})`;
}

el.list.addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  if (li.dataset.id === state.currentId) return togglePlay();
  load(state.tracks.find((t) => t.id === li.dataset.id), { autoplay: true });
});
el.filter.addEventListener("input", renderList);

async function refreshTracks() {
  const { tracks, library_version } = await api.tracks();
  const firstLoad = state.libraryVersion < 0;
  state.tracks = tracks;
  state.libraryVersion = library_version;
  if (firstLoad && current()) load(current(), { resumeAt: store.get("position", 0) });
  else if (state.currentId && !current()) load(null);
  renderNowPlaying();
  renderList();
  renderHere();
}

// ---------- video đang mở trên YouTube ----------
function trackForPage() {
  const have = state.tracks.filter((t) => t.source_id === state.page.videoId);
  return have.find((t) => t.mode === "audio") || have[0] || null;
}

function renderHere(job) {
  const { videoId, title } = state.page;
  el.here.hidden = !videoId;
  if (!videoId) return;
  el.hereThumb.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  el.hereTitle.textContent = title || "Video YouTube";
  const existing = trackForPage();
  const busy = job && (job.status === "queued" || job.status === "downloading");
  el.herePlay.hidden = !existing || busy;
  el.hereActions.hidden = Boolean(existing) || busy;
  el.hereBar.hidden = !busy;
  if (busy) el.hereFill.style.width = `${Math.round(job.progress * 100)}%`;
  if (existing) el.herePlay.textContent = existing.id === state.currentId && isPlaying() ? "♪ Đang phát" : "▶ Phát";
}

async function addPage(mode) {
  if (!state.page.url) return;
  el.addAudio.disabled = el.addVideo.disabled = true;
  showMsg("Đang đọc link…");
  try {
    const before = new Set((await api.downloads()).jobs.map((j) => j.id));
    const res = await api.add(state.page.url, mode);
    showMsg(res.message, res.queued === 0 && res.skipped === 0);
    const { jobs } = await api.downloads();
    state.watchJob = jobs.find((j) => !before.has(j.id))?.id || null;
    state.playWhenDone = Boolean(state.watchJob);
    if (!state.watchJob) await refreshTracks();
    poll();
  } catch (err) {
    showMsg(err.message || "Không thêm được link", true);
  } finally {
    el.addAudio.disabled = el.addVideo.disabled = false;
  }
}

el.addAudio.addEventListener("click", () => addPage("audio"));
el.addVideo.addEventListener("click", () => addPage("video"));
el.herePlay.addEventListener("click", () => {
  const t = trackForPage();
  if (t) t.id === state.currentId ? play() : load(t, { autoplay: true });
});

// ---------- đồng bộ helper ----------
async function poll() {
  clearTimeout(state.pollTimer);
  let delay = 8000;
  try {
    const { jobs, running, library_version } = await api.downloads();
    el.status.className = "status on";
    el.offline.hidden = true;
    const job = jobs.find((j) => j.id === state.watchJob);
    if (library_version !== state.libraryVersion) await refreshTracks();
    renderHere(job);
    if (job?.status === "done" && state.playWhenDone) {
      state.playWhenDone = false;
      state.watchJob = null;
      showMsg("Tải xong — đang phát không quảng cáo.");
      const t = state.tracks.find((x) => x.id === job.track_id);
      if (t) load(t, { autoplay: true });
    } else if (job?.status === "error") {
      showMsg(job.error || "Tải lỗi", true);
      state.watchJob = null;
    }
    if (running) delay = 1200;
  } catch {
    el.status.className = "status off";
    el.offline.hidden = false;
    delay = 5000;
  }
  state.pollTimer = setTimeout(poll, delay);
}

// ---------- giao tiếp với content script ----------
window.addEventListener("message", (e) => {
  if (e.source !== window.parent || e.data?.source !== "ytp-host") return;
  const msg = e.data;
  if (msg.type === "page") {
    const videoId = youtubeId(msg.url);
    if (videoId !== state.page.videoId) showMsg("");
    state.page = { url: msg.url, videoId, title: String(msg.title || "") };
    renderHere();
  } else if (msg.type === "pause" && isPlaying()) {
    el.media.pause();
  }
});

el.drag.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.target.closest("button")) return;
  e.preventDefault();
  toParent({ type: "drag-start", x: e.screenX, y: e.screenY });
});
el.hide.addEventListener("click", () => toParent({ type: "hide" }));
el.expand.addEventListener("click", () => {
  el.media.pause();
  chrome.runtime.sendMessage({ type: "open-player", id: state.currentId });
});

toParent({ type: "ready" });
poll();
