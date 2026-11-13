const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function human(bytes: number): string {
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  if (index === 0) return `${Math.round(value)} B`;
  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[index]}`;
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const value = (part / whole) * 100;
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function shortName(name: string, max = 28): string {
  if (name.length <= max) return name;
  return `…${name.slice(name.length - (max - 1))}`;
}
