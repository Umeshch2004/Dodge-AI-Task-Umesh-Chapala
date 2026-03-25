'use client';

import { useEffect, useState } from 'react';

function formatCurrency(n) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

export default function KpiBar({ onAnomalyClick }) {
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/kpis')
      .then(r => r.json())
      .then(data => { setKpis(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="kpi-bar">
        {[1,2,3,4].map(i => (
          <div key={i} className="kpi-card kpi-skeleton" />
        ))}
      </div>
    );
  }

  if (!kpis) return null;

  return (
    <div className="kpi-bar">

      <div className="kpi-card">
        <span className="kpi-label">Sales Orders</span>
        <span className="kpi-value">{kpis.totalOrders}</span>
        <span className="kpi-sub">total in dataset</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Billed Revenue</span>
        <span className="kpi-value">{formatCurrency(kpis.totalRevenue)}</span>
        <span className="kpi-sub">invoiced (non-cancelled)</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Collection Rate</span>
        <span className="kpi-value kpi-value--accent">{kpis.collectionRate}%</span>
        <span className="kpi-sub">invoices cleared</span>
      </div>

      <div
        className={`kpi-card kpi-card--alert ${kpis.brokenFlows > 0 ? 'kpi-card--clickable' : ''}`}
        onClick={() => kpis.brokenFlows > 0 && onAnomalyClick?.('Which sales orders were delivered but not billed?')}
        title={kpis.brokenFlows > 0 ? 'Click to analyze in chat' : ''}
      >
        <span className="kpi-label">⚠ Revenue at Risk</span>
        <span className="kpi-value kpi-value--warn">{kpis.brokenFlows}</span>
        <span className="kpi-sub">delivered, not billed ↗</span>
      </div>

    </div>
  );
}
