'use client';

import { useEffect, useRef, useState } from 'react';

const NODE_TYPE_COLORS = {
  SalesOrder: '#6366f1',
  SalesOrderItem: '#8b5cf6',
  Delivery: '#0ea5e9',
  BillingDocument: '#f59e0b',
  JournalEntry: '#10b981',
  Payment: '#22c55e',
  Customer: '#ef4444',
  Product: '#f97316',
  Plant: '#84cc16',
};

const LEGEND_ITEMS = [
  { type: 'SalesOrder', label: 'Sales Order' },
  { type: 'SalesOrderItem', label: 'SO Item' },
  { type: 'Delivery', label: 'Delivery' },
  { type: 'BillingDocument', label: 'Billing Doc' },
  { type: 'JournalEntry', label: 'Journal Entry' },
  { type: 'Payment', label: 'Payment' },
  { type: 'Customer', label: 'Customer' },
  { type: 'Product', label: 'Product' },
  { type: 'Plant', label: 'Plant' },
];

export default function GraphCanvas({ onNodeSelect, highlightedNodes = [] }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function initGraph() {
      try {
        // Dynamic import vis-network (client-side only)
        const { Network, DataSet } = await import('vis-network/standalone');

        const res = await fetch('/api/graph');
        if (!res.ok) throw new Error('Failed to load graph data');
        const { nodes: rawNodes, edges: rawEdges } = await res.json();

        if (!isMounted) return;

        setNodeCount(rawNodes.length);

        const nodes = new DataSet(rawNodes);
        const edges = new DataSet(rawEdges);

        const options = {
          physics: {
            enabled: true,
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
              gravitationalConstant: -26,
              centralGravity: 0.005,
              springLength: 230,
              springConstant: 0.18,
              damping: 0.4,
              avoidOverlap: 1,
            },
            stabilization: { iterations: 150 },
          },
          interaction: {
            hover: true,
            tooltipDelay: 200,
            navigationButtons: false,
            keyboard: true,
          },
          edges: {
            smooth: { type: 'continuous' },
            width: 0.8,
            color: {
              color: '#c4c4c8',
              highlight: '#71717a',
              hover: '#a1a1aa',
            },
            selectionWidth: 2,
            arrows: { to: { enabled: true, scaleFactor: 0.4 } },
          },
          nodes: {
            borderWidth: 2,
            borderWidthSelected: 3,
            color: {
              border: '#ffffff',
              highlight: { border: '#18181b' },
              hover: { border: '#71717a' },
            },
            chosen: true,
            font: {
              color: '#09090b',
              size: 10,
              face: 'Inter, -apple-system, sans-serif',
            },
            shadow: false,
          },
        };

        const network = new Network(containerRef.current, { nodes, edges }, options);
        networkRef.current = network;

        const nodesDataSet = nodes;
        const edgesDataSet = edges;

        async function highlightChain(nodeId) {
          try {
            const res = await fetch(`/api/chain?nodeId=${encodeURIComponent(nodeId)}`);
            const { chain } = await res.json();
            const chainSet = new Set(chain);

            // Update all nodes: dim non-chain, highlight chain
            const updates = nodesDataSet.get().map(n => {
              if (chainSet.has(n.id)) {
                return {
                  id: n.id,
                  opacity: 1,
                  borderWidth: 3,
                  color: {
                    border: '#f59e0b',
                    background: n.color?.background || NODE_TYPE_COLORS[n.title] || '#94a3b8',
                    highlight: { border: '#d97706', background: n.color?.background },
                  },
                  shadow: { enabled: true, color: 'rgba(245,158,11,0.5)', size: 10, x: 0, y: 0 },
                };
              }
              return { id: n.id, opacity: 0.15, borderWidth: 1, shadow: false };
            });
            nodesDataSet.update(updates);

            // Dim non-chain edges
            const edgeUpdates = edgesDataSet.get().map(e => {
              const inChain = chainSet.has(e.from) && chainSet.has(e.to);
              return {
                id: e.id,
                color: inChain ? { color: '#f59e0b', opacity: 1 } : { color: '#e4e4e7', opacity: 0.3 },
                width: inChain ? 2 : 0.5,
              };
            });
            edgesDataSet.update(edgeUpdates);
          } catch (err) {
            console.error('Chain highlight error:', err);
          }
        }

        function clearHighlight() {
          const updates = nodesDataSet.get().map(n => ({
            id: n.id, opacity: 1, borderWidth: 2,
            color: { border: '#ffffff' },
            shadow: false,
          }));
          nodesDataSet.update(updates);
          const edgeUpdates = edgesDataSet.get().map(e => ({
            id: e.id,
            color: { color: '#c4c4c8', opacity: 1 },
            width: 0.8,
          }));
          edgesDataSet.update(edgeUpdates);
        }

        network.on('click', (params) => {
          if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodesDataSet.get(nodeId);
            setSelectedNode(node);
            if (onNodeSelect) onNodeSelect(node);
            highlightChain(nodeId);
          } else {
            setSelectedNode(null);
            if (onNodeSelect) onNodeSelect(null);
            clearHighlight();
          }
        });

        network.on('stabilizationIterationsDone', () => {
          if (isMounted) {
            setLoading(false);
            network.setOptions({ physics: { enabled: false } });
          }
        });

        // Fallback if stabilization takes too long
        setTimeout(() => {
          if (isMounted && loading) {
            setLoading(false);
          }
        }, 5000);

      } catch (err) {
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    initGraph();
    return () => { isMounted = false; };
  }, []);

  // Highlight nodes from chat
  useEffect(() => {
    if (!networkRef.current || !highlightedNodes.length) return;
    // Could implement node focus/highlight here
  }, [highlightedNodes]);

  function handleFitView() {
    if (networkRef.current) {
      networkRef.current.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
    }
  }

  function handleTogglePhysics() {
    if (networkRef.current) {
      const current = networkRef.current.physics.options.enabled;
      networkRef.current.setOptions({ physics: { enabled: !current } });
    }
  }

  return (
    <div className="graph-panel">
      {loading && (
        <div className="graph-loading">
          <div className="loader" />
          <span className="loading-text">Building O2C knowledge graph…</span>
        </div>
      )}

      {error && (
        <div className="graph-loading">
          <span style={{ color: '#ef4444', fontSize: 14 }}>⚠ {error}</span>
          <span style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
            Make sure you&apos;ve run <code style={{ color: '#0ea5e9' }}>node scripts/ingest.js</code> first
          </span>
        </div>
      )}

      <div className="graph-controls">
        <button className="graph-btn" onClick={handleFitView}>⊕ Fit View</button>
        <button className="graph-btn" onClick={handleTogglePhysics}>⚛ Toggle Physics</button>
        {nodeCount > 0 && (
          <span className="graph-btn" style={{ cursor: 'default', color: '#6366f1' }}>
            {nodeCount} nodes
          </span>
        )}
      </div>

      <div ref={containerRef} className="graph-canvas" />

      {selectedNode && (
        <NodeInspectorPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}

      <div className="graph-legend">
        <div className="legend-title">Entity Types</div>
        <div className="legend-items">
          {LEGEND_ITEMS.map(({ type, label }) => (
            <div key={type} className="legend-item">
              <div className="legend-dot" style={{ background: NODE_TYPE_COLORS[type] }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeInspectorPanel({ node, onClose }) {
  const { metadata = {}, title: type, label } = node;
  const color = NODE_TYPE_COLORS[type] || '#94a3b8';

  const importantFields = Object.entries(metadata || {}).filter(([k, v]) =>
    v && v !== 'null' && v !== '{}' && k !== 'id'
  );

  const connections = node.value || 0;

  return (
    <div className="node-inspector">
      <div className="inspector-header">
        <div className="inspector-type">
          <span
            className="inspector-type-badge"
            style={{ background: color + '22', color, border: `1px solid ${color}55` }}
          >
            {type}
          </span>
        </div>
        <button className="inspector-close" onClick={onClose}>×</button>
      </div>
      <div className="inspector-title">{label}</div>
      <div className="inspector-fields">
        {importantFields.map(([key, value]) => {
          let displayVal = value;
          try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object') {
              displayVal = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ');
            }
          } catch {}
          const isHighlighted = ['salesOrder', 'billingDocument', 'deliveryDocument', 'businessPartner', 'product', 'accountingDocument'].includes(key);
          return (
            <div key={key} className="inspector-field">
              <span className="field-label">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
              <span className={`field-value ${isHighlighted ? 'highlighted' : ''}`}>
                {String(displayVal).substring(0, 80)}
                {String(displayVal).length > 80 ? '…' : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="connections-count">
        🔗 Node ID: {node.id}
      </div>
    </div>
  );
}
