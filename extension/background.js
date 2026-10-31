// Service worker: mở tab player (theo yêu cầu từ popup), menu chuột phải "Thêm vào YT NoAds", phím tắt.
import { api } from "./api.js";

const PLAYER_URL = chrome.runtime.getURL("player.html");

// Mở (hoặc chuyển tới) tab player; có playId thì phát luôn bài đó.
async function openPlayer(playId) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
  const ctx = contexts.find((c) => c.documentUrl?.startsWith(PLAYER_URL) && c.tabId >= 0);
  if (ctx) {
    const tab = await chrome.tabs.update(ctx.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    if (playId) chrome.runtime.sendMessage({ type: "play", id: playId }).catch(() => {});
  } else {
    await chrome.tabs.create({ url: playId ? `${PLAYER_URL}?play=${encodeURIComponent(playId)}` : PLAYER_URL });
  }
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

async function addUrl(url, mode) {
  if (!url || !/^https?:\/\//i.test(url)) return flashBadge("!", "#e5534b");
  flashBadge("…", "#7ddc8a");
  try {
    const res = await api.add(url, mode);
    flashBadge(res.queued ? `+${res.queued}` : "=", "#7ddc8a");
    chrome.runtime.sendMessage({ type: "library-changed" }).catch(() => {});
  } catch (err) {
    console.warn("YT NoAds: không thêm được", err);
    flashBadge("!", "#e5534b");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const contexts = ["link", "page", "video", "audio"];
    chrome.contextMenus.create({ id: "ytp-audio", title: chrome.i18n.getMessage("menuAudio"), contexts });
    chrome.contextMenus.create({ id: "ytp-video", title: chrome.i18n.getMessage("menuVideo"), contexts });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  // Chuột phải lên video YouTube cho srcUrl dạng blob: → dùng URL trang.
  const media = /^https?:/i.test(info.srcUrl || "") ? info.srcUrl : null;
  const url = info.linkUrl || media || info.pageUrl;
  addUrl(url, info.menuItemId === "ytp-video" ? "video" : "audio");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "open-player") openPlayer(msg.id);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "add-current-audio" && tab?.url) addUrl(tab.url, "audio");
});
