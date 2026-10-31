// Gọi helper local (FastAPI + yt-dlp) — dùng chung cho trang player và background.
export const HELPER = "http://127.0.0.1:8765";

async function request(path, options = {}) {
  const res = await fetch(HELPER + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail;
    throw new Error(detail || `Lỗi ${res.status}`);
  }
  return body;
}

export const api = {
  health: () => request("/api/health"),
  tracks: () => request("/api/tracks"),
  downloads: () => request("/api/downloads"),
  add: (url, mode) => request("/api/downloads", { method: "POST", body: JSON.stringify({ url, mode }) }),
  remove: (id) => request(`/api/tracks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  mediaUrl: (id) => `${HELPER}/media/${encodeURIComponent(id)}`,
};
