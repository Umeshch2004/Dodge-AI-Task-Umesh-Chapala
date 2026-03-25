'use client';

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

const EXAMPLE_QUERIES = [
  'Top products by billing docs',
  'Trace billing doc 90504248',
  'Orders delivered but not billed',
  'Revenue by customer',
  'Cancelled billing documents',
];

const ChatPanel = forwardRef(function ChatPanel(props, ref) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: 'Hi! I can help you analyze the **Order to Cash** process. Ask me about sales orders, deliveries, billing documents, payments, customers, or products.',
      sql: null,
      results: null,
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedSql, setExpandedSql] = useState({});
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    sendExternal: (text) => sendMessage(text),
  }));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text) {
    const userText = (text || input).trim();
    if (!userText || isLoading) return;

    setInput('');
    const userMsg = { id: Date.now(), role: 'user', content: userText };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, history }),
      });

      const data = await res.json();

      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.answer || 'No response received.',
        sql: data.sql,
        results: data.results,
        rowCount: data.rowCount,
        isOffTopic: data.isOffTopic,
        isError: data.isError,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: 'Connection error. Please check that the server is running.',
        isError: true,
      }]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function toggleSql(id) {
    setExpandedSql(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-top">
          <div className="chat-avatar">D</div>
          <div>
            <div className="chat-agent-name">Dodge AI</div>
            <div className="chat-agent-role">Graph Agent</div>
          </div>
        </div>
        <div className="chat-header-subtitle">Chat with Graph · Order to Cash</div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role} ${msg.isOffTopic ? 'off-topic' : ''} ${msg.isError ? 'error' : ''}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? 'Y' : 'D'}
            </div>
            <div className="message-content">
              <div className="message-bubble">
                <FormattedText text={msg.content} />
              </div>

              {/* SQL reveal */}
              {msg.sql && (
                <div className="sql-reveal">
                  <div className="sql-reveal-header" onClick={() => toggleSql(msg.id)}>
                    <span>🔍 Generated SQL</span>
                    <span>{expandedSql[msg.id] ? '▲' : '▼'}</span>
                  </div>
                  {expandedSql[msg.id] && (
                    <div className="sql-code">{msg.sql}</div>
                  )}
                </div>
              )}

              {/* Row count badge */}
              {msg.rowCount !== undefined && msg.rowCount !== null && (
                <div className="results-badge">
                  ✓ {msg.rowCount} row{msg.rowCount !== 1 ? 's' : ''} returned
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="message assistant">
            <div className="message-avatar">D</div>
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Example queries */}
      <div className="example-queries">
        <div className="example-label">Try asking</div>
        <div className="example-chips">
          {EXAMPLE_QUERIES.map(q => (
            <button key={q} className="example-chip" onClick={() => sendMessage(q)} disabled={isLoading}>
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Analyze anything"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
          />
          <button className="send-btn" onClick={() => sendMessage()} disabled={isLoading || !input.trim()}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
});

export default ChatPanel;

// Simple markdown-like formatter
function FormattedText({ text }) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        // Handle bullet points
        const lines = part.split('\n');
        return lines.map((line, j) => {
          const isLast = j === lines.length - 1;
          if (line.startsWith('- ') || line.startsWith('• ')) {
            return (
              <span key={`${i}-${j}`}>
                {'• ' + line.slice(2)}
                {!isLast && <br />}
              </span>
            );
          }
          return (
            <span key={`${i}-${j}`}>
              {line}
              {!isLast && <br />}
            </span>
          );
        });
      })}
    </>
  );
}
