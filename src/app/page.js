'use client';

import dynamic from 'next/dynamic';
import ChatPanel from '../components/ChatPanel';
import KpiBar from '../components/KpiBar';
import { useState, useRef } from 'react';

// Graph canvas must be client-side only (vis-network uses DOM APIs)
const GraphCanvas = dynamic(() => import('../components/GraphCanvas'), { ssr: false });

export default function HomePage() {
  const [selectedNode, setSelectedNode] = useState(null);
  const chatRef = useRef(null);

  function handleAnomalyClick(query) {
    chatRef.current?.sendExternal(query);
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">⬡</div>
          <span className="header-title">Mapping</span>
          <span className="header-breadcrumb">/ <span>Order to Cash</span></span>
        </div>
        <div className="header-status">
          <div className="status-dot" />
          Dodge AI
        </div>
      </header>

      {/* KPI Stats Bar */}
      <KpiBar onAnomalyClick={handleAnomalyClick} />

      {/* Body: Graph + Chat */}
      <div className="app-body">
        <GraphCanvas onNodeSelect={setSelectedNode} />
        <ChatPanel ref={chatRef} selectedNode={selectedNode} />
      </div>
    </div>
  );
}
