export function breakLabel(minutes) {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`;
  const days = minutes / 1440;
  return `${days.toFixed(days % 1 === 0 ? 0 : 1)} day(s)`;
}