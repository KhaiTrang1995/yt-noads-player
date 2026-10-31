// Trang player: phát file đã tải từ helper, quản lý thư viện + hàng đợi tải.
import { api } from "./api.js";

const $ = (id) => document.getElementById(id);
const el = {
  stage: $("stage"), vinyl: $("vinyl"), cover: $("cover"), media: $("media"),
  title: $("title"), artist: $("artist"), cur: $("cur"), dur: $("dur"), progress: $("progress"),
  play: $("play"), playIcon: $("playIcon"), prev: $("prev"), next: $("next"),
  autoplay: $("autoplay"), queue: $("queue"), queueEmpty: $("queueEmpty"),
  offline: $("offline"), retry: $("retry"),
  overlay: $("libOverlay"), openLib: $("openLib"), closeLib: $("closeLib"),
  addForm: $("addForm"), url: $("url"), addBtn: $("addBtn"), addMsg: $("addMsg"),
  jobsBox: $("jobsBox"), jobs: $("jobs"), jobsCount: $("jobsCount"),
  library: $("library"), libCount: $("libCount"), filter: $("filter"),
};

const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
const ICON_PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("ytp." + key); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("ytp." + key, JSON.stringify(value)); } catch { /* chế độ riêng tư */ }
  },
};

const state = {
  tracks: [],
  currentId: store.get("currentId", null),
  libraryVersion: -1,
  online: false,
  seeking: false,
  pollTimer: null,
};

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

const current = () => state.tracks.find((t) => t.id === state.currentId) || null;
const indexOfCurrent = () => state.tracks.findIndex((t) => t.id === state.currentId);

// ---------- phát ----------
function load(track, { autoplay = false, resumeAt = 0 } = {}) {
  state.currentId = track ? track.id : null;
  store.set("currentId", state.currentId);
  if (!track) {
    el.media.removeAttribute("src");
    el.media.load();
    renderNowPlaying();
    renderQueue();
    return;
  }
  el.media.src = api.mediaUrl(track.id);
  store.set("position", resumeAt);
  if (resumeAt > 0) el.media.currentTime = resumeAt;
  renderNowPlaying();
  renderQueue();
  if (autoplay) el.media.play().catch(() => {});
}

function togglePlay() {
  if (!current()) {
    if (state.tracks.length) load(state.tracks[0], { autoplay: true });
    return;
  }
  el.media.paused ? el.media.play().catch(() => {}) : el.media.pause();
}

function step(delta) {
  if (!state.tracks.length) return;
  // "Trước" khi đã nghe >3s thì quay lại đầu bài, giống các trình phát quen thuộc.
  if (delta < 0 && el.media.currentTime > 3) { el.media.currentTime = 0; return; }
  const i = indexOfCurrent();
  const n = state.tracks.length;
  const next = state.tracks[((i < 0 ? 0 : i + delta) % n + n) % n];
  load(next, { autoplay: true });
}

function renderNowPlaying() {
  const t = current();
  el.title.textContent = t ? t.title : "Chưa có bài nào";
  el.artist.textContent = t ? (t.artist || "Không rõ nghệ sĩ") : "Bấm “Thư viện” để thêm nhạc từ link";
  document.title = t ? `${t.title} — YT NoAds` : "YT NoAds Player";
  el.stage.classList.toggle("video", t?.mode === "video");
  if (t?.thumbnail) el.cover.src = t.thumbnail; else el.cover.removeAttribute("src");
  el.dur.textContent = fmt(t?.duration);
  updateMediaSession(t);
}

function renderPlayState() {
  const playing = !el.media.paused && !el.media.ended;
  el.playIcon.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  el.play.setAttribute("aria-label", playing ? "Tạm dừng" : "Phát");
  el.vinyl.classList.toggle("spinning", playing);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

function renderProgress() {
  const d = el.media.duration || current()?.duration || 0;
  const c = el.media.currentTime || 0;
  el.cur.textContent = fmt(c);
  if (Number.isFinite(el.media.duration)) el.dur.textContent = fmt(el.media.duration);
  if (!state.seeking) el.progress.value = d ? Math.round((c / d) * 1000) : 0;
  el.progress.style.setProperty("--pct", `${el.progress.value / 10}%`);
}

function updateMediaSession(t) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = t
    ? new MediaMetadata({ title: t.title, artist: t.artist, artwork: t.thumbnail ? [{ src: t.thumbnail }] : [] })
    : null;
}

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => el.media.play());
  ms.setActionHandler("pause", () => el.media.pause());
  ms.setActionHandler("previoustrack", () => step(-1));
  ms.setActionHandler("nexttrack", () => step(1));
  ms.setActionHandler("seekto", (e) => { el.media.currentTime = e.seekTime; });
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
  if (current()) el.artist.textContent = "Không phát được file này — thử xóa và tải lại.";
});

let lastSaved = 0;
el.media.addEventListener("timeupdate", () => {
  if (Date.now() - lastSaved > 4000) { store.set("position", el.media.currentTime); lastSaved = Date.now(); }
});
el.media.addEventListener("volumechange", () => store.set("volume", el.media.volume));
el.media.volume = store.get("volume", 1);

el.progress.addEventListener("input", () => {
  state.seeking = true;
  const d = el.media.duration || 0;
  el.cur.textContent = fmt((el.progress.value / 1000) * d);
  el.progress.style.setProperty("--pct", `${el.progress.value / 10}%`);
});
el.progress.addEventListener("change", () => {
  const d = el.media.duration || 0;
  if (d) el.media.currentTime = (el.progress.value / 1000) * d;
  state.seeking = false;
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
  if (e.target.closest("input, textarea") && e.target.type !== "range" && e.target.type !== "checkbox") return;
  if (e.code === "Space" && e.target.closest("button")) return; // nút tự xử lý Space
  if (e.key === "Escape" && !el.overlay.hidden) return closeLibrary();
  if (!el.overlay.hidden) return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowRight") el.media.currentTime += 5;
  else if (e.key === "ArrowLeft") el.media.currentTime -= 5;
  else if (e.key.toLowerCase() === "n") step(1);
  else if (e.key.toLowerCase() === "p") step(-1);
});

// ---------- danh sách ----------
function trackRow(t, { withDelete = false } = {}) {
  const li = node("li");
  li.dataset.id = t.id;
  li.append(node("span", "name", t.title));
  if (t.mode === "video") li.append(node("span", "tag", "VIDEO"));
  li.append(node("span", "time", fmt(t.duration)));
  if (withDelete) {
    const del = node("button", "del", "xóa");
    del.type = "button";
    del.dataset.del = t.id;
    li.append(del);
  }
  return li;
}

function renderQueue() {
  el.queue.replaceChildren(...state.tracks.map((t) => {
    const li = trackRow(t);
    li.classList.toggle("active", t.id === state.currentId);
    li.title = t.artist ? `${t.title} — ${t.artist}` : t.title;
    return li;
  }));
  el.queueEmpty.hidden = state.tracks.length > 0;
  el.queue.querySelector("li.active")?.scrollIntoView({ block: "nearest" });
}

function renderLibrary() {
  const q = el.filter.value.trim().toLowerCase();
  const list = q
    ? state.tracks.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q))
    : state.tracks;
  el.library.replaceChildren(...list.map((t) => trackRow(t, { withDelete: true })));
  el.libCount.textContent = `(${state.tracks.length})`;
}

el.queue.addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  if (li.dataset.id === state.currentId) return togglePlay();
  load(state.tracks.find((t) => t.id === li.dataset.id), { autoplay: true });
});

el.library.addEventListener("click", async (e) => {
  const id = e.target.dataset?.del;
  if (id) {
    const t = state.tracks.find((x) => x.id === id);
    if (!t || !confirm(`Xóa “${t.title}” khỏi thư viện và xóa file trên máy?`)) return;
    try {
      if (id === state.currentId) { el.media.pause(); load(null); }
      await api.remove(id);
      await refreshTracks();
    } catch (err) {
      showMsg(err.message, true);
    }
    return;
  }
  const li = e.target.closest("li[data-id]");
  if (li) { load(state.tracks.find((t) => t.id === li.dataset.id), { autoplay: true }); closeLibrary(); }
});

el.filter.addEventListener("input", renderLibrary);

async function refreshTracks() {
  const { tracks, library_version } = await api.tracks();
  const firstLoad = state.libraryVersion < 0;
  state.tracks = tracks;
  state.libraryVersion = library_version;
  if (firstLoad) {
    const wanted = new URLSearchParams(location.search).get("play");
    if (wanted && tracks.some((t) => t.id === wanted)) {
      history.replaceState(null, "", location.pathname);
      state.currentId = wanted;
      load(current(), { autoplay: true });
      renderLibrary();
      return;
    }
    const t = current();
    if (t) load(t, { resumeAt: store.get("position", 0) });
    else load(null);
  } else if (state.currentId && !current()) {
    load(null);
  }
  renderNowPlaying();
  renderQueue();
  renderLibrary();
}

// ---------- thư viện + tải ----------
function showMsg(text, isError = false) {
  el.addMsg.textContent = text;
  el.addMsg.classList.toggle("error", isError);
}

function openLibrary() {
  el.overlay.hidden = false;
  renderLibrary();
  el.url.focus();
  poll();
}

function closeLibrary() { el.overlay.hidden = true; el.openLib.focus(); }

el.openLib.addEventListener("click", openLibrary);
el.closeLib.addEventListener("click", closeLibrary);
el.overlay.addEventListener("click", (e) => { if (e.target === el.overlay) closeLibrary(); });

el.addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = el.url.value.trim();
  const mode = el.addForm.querySelector('input[name="mode"]:checked').value;
  el.addBtn.disabled = true;
  showMsg("Đang đọc link…");
  try {
    const res = await api.add(url, mode);
    showMsg(res.message, res.queued === 0 && res.skipped === 0);
    if (res.queued) el.url.value = "";
    poll();
  } catch (err) {
    showMsg(err.message || "Không thêm được link", true);
  } finally {
    el.addBtn.disabled = false;
  }
});

function renderJobs(jobs, running) {
  el.jobsBox.hidden = jobs.length === 0;
  el.jobsCount.textContent = running ? `(${running} đang chạy)` : "(xong)";
  el.jobs.replaceChildren(...[...jobs].reverse().map((j) => {
    const li = node("li", j.status);
    const top = node("div", "top");
    top.append(node("span", "name", j.title));
    if (j.mode === "video") top.append(node("span", "tag", "VIDEO"));
    const label = j.status === "queued" ? "chờ" : j.status === "error" ? "lỗi" : `${Math.round(j.progress * 100)}%`;
    top.append(node("span", "time", label));
    const bar = node("div", "bar");
    const fill = node("span");
    fill.style.width = `${j.status === "error" ? 100 : Math.round(j.progress * 100)}%`;
    bar.append(fill);
    li.append(top, bar);
    if (j.error) li.append(node("div", "err", j.error));
    return li;
  }));
}

// Hỏi helper định kỳ: nhanh khi đang tải hoặc mở thư viện, chậm khi rảnh.
async function poll() {
  clearTimeout(state.pollTimer);
  let delay = 10000;
  try {
    const { jobs, running, library_version } = await api.downloads();
    setOnline(true);
    renderJobs(jobs, running);
    if (library_version !== state.libraryVersion) await refreshTracks();
    if (running || !el.overlay.hidden) delay = 1500;
  } catch {
    setOnline(false);
    delay = 5000;
  }
  state.pollTimer = setTimeout(poll, delay);
}

function setOnline(online) {
  state.online = online;
  el.offline.hidden = online;
}

el.retry.addEventListener("click", poll);

// Background báo có link mới từ menu chuột phải.
globalThis.chrome?.runtime?.onMessage?.addListener((msg) => {
  if (msg?.type === "library-changed") poll();
  if (msg?.type === "play") playById(msg.id);
});

// Popup yêu cầu phát một bài: bài có thể vừa tải xong nên nạp lại thư viện trước.
async function playById(id) {
  if (!state.tracks.some((t) => t.id === id)) await refreshTracks().catch(() => {});
  const t = state.tracks.find((x) => x.id === id);
  if (t) { closeLibrary(); load(t, { autoplay: true }); }
}

poll();
