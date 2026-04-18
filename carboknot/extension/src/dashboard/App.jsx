import React, { useEffect, useState } from 'react';
import { getHistory } from '../storage/db.js';

// Phase 1 shell. Orchids-styled trend chart, category breakdown, budget
// ring, and settings modal land in Phase 5.
export default function App() {
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory()
      .then((rows) => setViews(rows))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Carboknot</h1>
        <span style={styles.tag}>zero-trust carbon footprint · Phase 1 shell</span>
      </header>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Local history</h2>
        {loading ? (
          <p style={styles.muted}>Reading IndexedDB…</p>
        ) : views.length === 0 ? (
          <p style={styles.muted}>
            No product views yet. Visit an Amazon or eBay product page with
            the extension loaded and the badge will log a view here. Data
            never leaves this browser.
          </p>
        ) : (
          <ul style={styles.list}>
            {views.slice(0, 20).map((v) => (
              <li key={v.id} style={styles.listItem}>
                <span style={styles.kg}>{v.kg_total.toFixed(1)} kg</span>
                <span style={styles.itemTitle}>{v.title}</span>
                <span style={styles.muted}>
                  {v.merchant} · {v.category}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Zero-trust disclosure</h2>
        <p style={styles.muted}>
          Carboknot stores view history locally in IndexedDB. The extension
          makes exactly two kinds of outbound call, and only through the
          stateless Daedalus proxy: (1) <code>/api/categorize</code> when the
          local regex + WebLLM tiers both fail to classify a product title;
          (2) <code>/api/reason</code> when you explicitly click "Why is this
          better?" on an alternative. No other network calls exist.
        </p>
      </section>
    </main>
  );
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    maxWidth: 920,
    margin: '0 auto',
    padding: '32px 24px 80px',
    color: '#111827'
  },
  header: { marginBottom: 24 },
  title: { color: '#1A6B4A', margin: 0, fontSize: 28 },
  tag: { color: '#6b7280', fontSize: 13 },
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 20,
    marginTop: 20,
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
  },
  cardTitle: { margin: '0 0 12px', fontSize: 16 },
  muted: { color: '#6b7280', fontSize: 13, lineHeight: 1.55, margin: 0 },
  list: { listStyle: 'none', padding: 0, margin: 0 },
  listItem: {
    display: 'grid',
    gridTemplateColumns: '80px 1fr auto',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
    alignItems: 'center'
  },
  kg: { fontWeight: 600, color: '#1A6B4A' },
  itemTitle: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
};
