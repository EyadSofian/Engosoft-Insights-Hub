export function deliverableStatus(
  actual: number | null,
  target: number,
  elapsed: number,
  connected: boolean,
) {
  if (!connected || actual === null) return "not_connected";
  if (actual >= target && target > 0) return "complete";
  if (actual <= 0) return "not_started";
  const achievement = target > 0 ? actual / target : 0;
  if (achievement >= elapsed + 0.05) return "ahead";
  if (achievement + 0.05 < elapsed) return "behind";
  return "on_track";
}
