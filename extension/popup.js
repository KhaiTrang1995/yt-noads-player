// Popup: bấm icon khi đang ở YouTube → thêm video đó để nghe/xem không ads, hoặc phát ngay nếu đã có.
import { api } from "./api.js";

const $ = (id) => document.getElementById(id);
const el = {
  status: $("status"), thumb: $("thumb"), pageLabel: $("pageLabel"), pageTitle: $("pageTitle"),
  actions: $("actions"), addAudio: $("addAudio"), addVideo: $("addVideo"), playNow: $("playNow"),
  manual: $("manual"), url: $("url"), msg: $("msg"), jobs: $("jobs"), offline: $("offline"),
  openPlayer: $("openPlayer"), toggleMini: $("toggleMini"),
};

let pageUrl = null;      // URL tab hiện tại nếu là http(s)
let videoId = null;      // id YouTube của tab hiện tại
let watchedJobs = new Set(); // job do popup này tạo, để hiện nút "Phát" khi xong

function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host !== "youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function showMsg(text, isError = false) {
  el.msg.textContent = text;
  el.msg.classList.toggle("error", isError);
}

function openPlayer(id) {
  chrome.runtime.sendMessage({ type: "open-player", id }).finally(() => window.close());
}

async function add(url, mode) {
  el.addAudio.disabled = el.addVideo.disabled = true;
  showMsg("Đang đọc link…");
  try {
    const before = new Set((await api.downloads()).jobs.map((j) => j.id));
    const res = await api.add(url, mode);
    showMsg(res.message, res.queued === 0 && res.skipped === 0);
    const { jobs } = await api.downloads();
    jobs.filter((j) => !before.has(j.id)).forEach((j) => watchedJobs.add(j.id));
    chrome.runtime.sendMessage({ type: "library-changed" }).catch(() => {});
    if (res.queued === 0 && res.skipped > 0) await checkExisting();
    return true;
  } catch (err) {
    showMsg(err.message || "Không thêm được link", true);
    return false;
  } finally {
    el.addAudio.disabled = el.addVideo.disabled = false;
  }
}

// Video đang mở đã có trong thư viện → hiện nút phát ngay.
async function checkExisting() {
  if (!videoId) return;
  const { tracks } = await api.tracks();
  const have = tracks.filter((t) => t.source_id === videoId);
  if (!have.length) return;
  const pick = have.find((t) => t.mode === "audio") || have[0];
  el.playNow.hidden = false;
  el.playNow.onclick = () => openPlayer(pick.id);
  if (!el.msg.textContent) showMsg("Bài này đã có trong thư viện.");
}

function renderJobs(jobs) {
  // Chỉ hiện job đang chạy hoặc do popup này tạo; mới nhất lên đầu.
  const shown = jobs
    .filter((j) => watchedJobs.has(j.id) || j.status === "queued" || j.status === "downloading")
    .reverse()
    .slice(0, 4);
  el.jobs.replaceChildren(...shown.map((j) => {
    const li = document.createElement("li");
    li.className = j.status;
    const top = document.createElement("div");
    top.className = "top";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = j.title;
    name.title = j.error || j.title;
    top.append(name);
    if (j.status === "done" && j.track_id) {
      const go = document.createElement("button");
      go.className = "go";
      go.textContent = "▶ Phát";
      go.onclick = () => openPlayer(j.track_id);
      top.append(go);
    } else {
      const pct = document.createElement("span");
      pct.className = "pct";
      pct.textContent = j.status === "queued" ? "chờ" : j.status === "error" ? "lỗi" : `${Math.round(j.progress * 100)}%`;
      top.append(pct);
    }
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${j.status === "error" ? 100 : Math.round(j.progress * 100)}%`;
    bar.append(fill);
    li.append(top, bar);
    return li;
  }));
}

async function poll() {
  try {
    const { jobs } = await api.downloads();
    el.status.className = "status on";
    el.offline.hidden = true;
    renderJobs(jobs);
  } catch {
    el.status.className = "status off";
    el.offline.hidden = false;
  }
  setTimeout(poll, 1200);
}

el.addAudio.addEventListener("click", () => pageUrl && add(pageUrl, "audio"));
el.addVideo.addEventListener("click", () => pageUrl && add(pageUrl, "video"));
el.openPlayer.addEventListener("click", () => openPlayer());
el.manual.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = el.url.value.trim();
  if (!/^https?:\/\//i.test(url)) return showMsg("Link phải bắt đầu bằng http(s)://", true);
  if (await add(url, "audio")) el.url.value = "";
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  if (/^https?:\/\//i.test(url)) {
    pageUrl = url;
    videoId = youtubeId(url);
    el.pageTitle.textContent = (tab.title || url).replace(/^\(\d+\)\s*/, "").replace(/ - YouTube( Music)?$/, "");
    el.pageLabel.textContent = videoId ? "Video YouTube đang mở" : "Trang đang mở";
    if (videoId) el.thumb.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    if (/^https:\/\/(www\.|m\.|music\.)?youtube\.com\//.test(url)) {
      el.toggleMini.hidden = false;
      el.toggleMini.onclick = () => {
        chrome.tabs.sendMessage(tab.id, { type: "ytp-toggle" })
          .then(() => window.close())
          .catch(() => showMsg("Tải lại trang YouTube (F5) để hiện trình phát nổi.", true));
      };
    }
  } else {
    el.pageTitle.textContent = "Mở một video YouTube rồi bấm lại, hoặc dán link bên dưới.";
    el.pageLabel.textContent = "Không có video";
    el.actions.hidden = true;
  }
  poll();
  checkExisting().catch(() => {});
}

init();
