export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export function sourceBadgeLabel(source: string): string {
  switch (source) {
    case 'climatiq_fresh':
      return 'Climatiq fresh';
    case 'climatiq_cached':
      return 'Climatiq cached';
    case 'local_fallback':
      return 'Local fallback';
    default:
      return source;
  }
}

export function getCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    audio_electronics: 'Audio & Electronics',
    laptops: 'Laptops',
    smartphones: 'Smartphones',
    apparel_tops: 'Apparel',
    footwear: 'Footwear',
    books: 'Books',
    beauty: 'Beauty',
    food_packaged: 'Food',
    general: 'General'
  };
  return map[cat] ?? cat;
}

export function buildDailyTrend(
  rows: { ts: number; kg_total: number }[],
  days = 30
): { date: string; kg: number }[] {
  const buckets: Record<string, number> = {};

  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = 0;
  }

  for (const row of rows) {
    const key = new Date(row.ts).toISOString().slice(0, 10);
    if (key in buckets) {
      buckets[key] += row.kg_total;
    }
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, kg]) => ({ date, kg: Math.round(kg * 10) / 10 }));
}

export function buildCategoryTotals(
  rows: { category: string; kg_total: number; category_uncertain: boolean }[]
): { category: string; kg: number; uncertain: boolean }[] {
  const totals: Record<string, { kg: number; uncertain: boolean }> = {};

  for (const row of rows) {
    if (!totals[row.category]) {
      totals[row.category] = { kg: 0, uncertain: row.category_uncertain };
    }
    totals[row.category].kg += row.kg_total;
    if (row.category_uncertain) totals[row.category].uncertain = true;
  }

  return Object.entries(totals)
    .map(([category, { kg, uncertain }]) => ({
      category,
      kg: Math.round(kg * 10) / 10,
      uncertain
    }))
    .sort((a, b) => b.kg - a.kg);
}
