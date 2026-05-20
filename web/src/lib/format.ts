export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const sec = Math.floor(abs / 1000);
  if (sec < 60) return diff >= 0 ? `${sec}s 前` : `${sec}s 后`;
  const min = Math.floor(sec / 60);
  if (min < 60) return diff >= 0 ? `${min}m 前` : `${min}m 后`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return diff >= 0 ? `${hr}h 前` : `${hr}h 后`;
  const day = Math.floor(hr / 24);
  return diff >= 0 ? `${day}d 前` : `${day}d 后`;
}

export function formatCountdown(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return '已过期';
  const sec = Math.floor(remaining / 1000);
  const hr = Math.floor(sec / 3600);
  const min = Math.floor((sec % 3600) / 60);
  if (hr > 0) return `${hr}h ${min}m`;
  return `${min}m`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
