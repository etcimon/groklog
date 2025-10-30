export function formatCompact(pos: number, item: any): string {
  const dt = new Date(item.datetime).toLocaleString();
  const preview = item.details?.length > 16 ? item.details.slice(0, 16) + "..." : item.details || "";
  return `[${pos}] ${dt} [${item.importance}/10] ${item.summary} (+${preview})`;
}

export function formatFull(item: any): string {
  const dt = new Date(item.datetime).toLocaleString();
  return `${dt} [${item.importance}/10] ${item.summary}\n${item.details || "(no details)"}`;
}

export function formatSources(pos: number, item: any): string {
  const urls: string[] = [];
  if (item.source_urls) item.source_urls.split(',').forEach((url: string) => urls.push(url));
  const matches = item.details?.match(/(https?:\/\/[^\s"']+)/g);
  if (matches) urls.push(...matches);
  if (urls.length === 0) return `[${pos}] (no sources)`;
  return `[${pos}] Sources:\n${urls.map(u => `  → ${u}`).join("\n")}`;
}