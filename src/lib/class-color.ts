const FALLBACK = [
  "#d7263d",
  "#e07a14",
  "#1f8a4c",
  "#2c6fbb",
  "#7b3ff2",
  "#c43e8a",
  "#8a5a12",
  "#0e7490",
];

export function classFill(id: number, stored?: string | null): string {
  if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) return stored;
  const index = Math.abs(id) % FALLBACK.length;
  return FALLBACK[(index * 7) % FALLBACK.length];
}

export function inkOn(fill: string): string {
  const n = Number.parseInt(fill.slice(1), 16);
  if (!Number.isFinite(n)) return "#faf9f7";
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.42 ? "#1c1b19" : "#faf9f7";
}
