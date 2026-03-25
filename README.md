# O2C Graph Intelligence

> A context graph system with an LLM-powered query interface for SAP Order-to-Cash data.

Data is unified from 19 JSONL tables into a graph of interconnected entities, visualized interactively, and queryable via natural language.

---

## Architecture

```
sap-o2c-data/  (19 JSONL folders)
       ↓  node scripts/ingest.js
  data/o2c.db  (SQLite — 19 normalized tables with indexes)
       ↓
  /api/graph   → graphBuilder.js constructs nodes + edges
  /api/chat    → NL → LLM → SQL → SQLite → LLM → answer
       ↓
  Next.js 14 App Router
    ├── Graph canvas  (vis-network, ~714 nodes)
    └── Chat panel    (real-time LLM responses)
```

### Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js 14 (App Router) | Server-side API routes + React frontend in one codebase |
| Graph Viz | vis-network | Lightweight, physics-based layout, expand/collapse support |
| Database | SQLite (better-sqlite3) | Zero-config, embeddable, fast analytical reads, no server needed |
| LLM | Google Gemini 2.0 Flash (via OpenRouter) | Free tier, fast inference, strong SQL generation |
| Styling | Vanilla CSS | Full dark-mode design system, no framework dependencies |

### Why SQLite?

- **Zero infrastructure**: No external database server needed — the entire dataset is a single `o2c.db` file
- **ACID-compliant**: Proper transaction support during data ingestion
- **Fast reads**: WAL mode + B-tree indexes on all foreign keys = sub-millisecond query times
- **Portable**: The database file ships with the repo

### Why Graph Visualization?

O2C data is inherently relational — a sales order connects to deliveries, which connect to billing documents, which connect to journal entries and payments. A graph representation makes these multi-hop relationships visible at a glance, which is impossible in flat tables.

---

## Database Choice

SQLite was chosen over alternatives for these reasons:

| Option | Considered | Decision |
|--------|-----------|----------|
| PostgreSQL | Powerful, but requires separate server setup | Rejected: overkill for read-only analytics on ~1000 records |
| Neo4j | Native graph DB | Rejected: adds significant infrastructure complexity for a dataset this size |
| In-memory JSON | Simplest option | Rejected: no SQL support for dynamic LLM queries |
| **SQLite** | Embedded, fast, SQL-native | **Chosen**: perfect balance of power and simplicity |

Data is ingested from 19 JSONL directories, each containing one or more `.jsonl` files. The ingestion script (`scripts/ingest.js`) flattens nested structures and creates indexed tables with proper column types.

---

## Graph Modelling

### Entity Types (Nodes)

| Entity | Color | Source Table | Count |
|--------|-------|-------------|-------|
| Sales Order | Purple | sales_order_headers | ~100 |
| SO Item | Pink | sales_order_items | ~150 |
| Delivery | Blue | outbound_delivery_headers | ~95 |
| Billing Doc | Orange | billing_document_headers | ~110 |
| Journal Entry | Green | journal_entry_items_ar | ~120 |
| Payment | Emerald | payments_ar | ~40 |
| Customer | Red | business_partners | ~10 |
| Product | Orange | products | ~50 |
| Plant | Yellow | plants | ~20 |

### Relationships (Edges)

```
Customer ──[placed]──→ Sales Order
Sales Order ──[has]──→ SO Item
SO Item ──[contains]──→ Product
SO Item ──[shipped_from]──→ Plant
Sales Order ──[fulfilled_by]──→ Delivery     (via outbound_delivery_items.referenceSdDocument)
Delivery ──[invoiced_in]──→ Billing Doc       (via billing_document_items.referenceSdDocument)
Billing Doc ──[posted_to]──→ Journal Entry   (via billing_document_headers.accountingDocument)
Journal Entry ──[cleared_by]──→ Payment       (via payments_ar.accountingDocument)
```

**Key schema insight**: SAP uses `referenceSdDocument` (not `salesOrder`) in delivery and billing item tables for document chaining. This required careful schema analysis to discover.

---

## LLM Prompting Strategy

### Two-Pass Architecture

```
User Question  →  [LLM Pass 1: NL→SQL]  →  SQL Query
                                              ↓
                                         SQLite Execution
                                              ↓
SQL Results    →  [LLM Pass 2: Data→NL] →  Business Answer
```

**Pass 1 — SQL Generation:**
- System prompt includes full schema (19 tables, all columns with types and FK relationships)
- 5 verified SQL patterns for common queries (top products, trace flow, broken flows, revenue, cancellations)
- Explicit column-name warnings (e.g., "products has NO productDescription column — use product_descriptions")
- Temperature: 0.1 (low creativity, high precision)
- Output format: strict JSON `{sql, explanation, intent}`

**Pass 2 — Answer Generation:**
- Raw SQL results (up to 20 rows) sent with original question
- Instructions: bullet points for lists, max 150 words, no raw JSON/SQL in answer

### Why Verified SQL Patterns?

LLMs frequently hallucinate column names (e.g., `p.productDescription` when the column only exists in `product_descriptions`). By including correct, tested SQL patterns in the system prompt, the model has concrete reference patterns to follow, dramatically reducing column-name errors.

---

## Guardrails

### 1. Domain Restriction (LLM-level)

The system prompt instructs the LLM to respond with `{"off_topic": true}` for any question unrelated to O2C data. This rejects:
- General knowledge ("What is the capital of France?")
- Creative writing ("Write me a poem")
- Coding help ("How do I sort an array?")

Response: *"This system is designed to answer questions related to the provided Order-to-Cash dataset only."*

### 2. SQL Safety (Server-level)

Even if the LLM generates dangerous SQL, the server blocks it:

```javascript
function isReadOnlySql(sql) {
  const up = sql.trim().toUpperCase();
  if (!up.startsWith('SELECT') && !up.startsWith('WITH')) return false;
  const banned = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'PRAGMA'];
  return !banned.some(kw => up.includes(kw));
}
```

### 3. Result Size Cap

All queries automatically get `LIMIT 50` appended if not present, preventing memory issues from unbounded result sets.

### 4. Error Transparency

SQL errors are surfaced to the user with the generated SQL visible in a "Generated SQL" accordion, allowing them to understand and rephrase their question.

---

## Example Queries

| Query | What It Tests | Result |
|-------|--------------|--------|
| "Top products by billing docs" | Multi-table JOIN + GROUP BY | SUNSCREEN GEL SPF50 (22 docs), FACESERUM 30ML VIT C (22 docs) |
| "Trace billing doc 90504248" | Full O2C flow tracing | SO 740552 → DEL 80738072 → BILL 90504248 → JE 9400000249 (Unpaid) |
| "Orders delivered but not billed" | Anti-join pattern (broken flow) | 3 orders: 740506, 740507, 740508 |
| "Revenue by customer" | Aggregate + business_partners JOIN | Top customer identified with revenue totals |
| "How many sales orders?" | Simple COUNT | 100 sales orders |
| "What is the weather?" | Off-topic guardrail | Rejected with domain message |

---

## Bonus Features Implemented

| Feature | Implementation |
|---------|---------------|
| **NL→SQL translation** | Two-pass LLM with verified SQL patterns |
| **SQL reveal** | Expandable "Generated SQL" accordion on each chat response |
| **Suggested queries** | Pre-built query chips: "Top products by billing docs", "Trace billing doc 90504248", etc. |
| **Conversation memory** | Last 6 messages sent as context to maintain multi-turn coherence |
| **Row count badges** | Green badge showing "✓ N rows returned" on each response |
| **Node inspector** | Click any graph node to see full metadata panel |
| **Entity type legend** | Color-coded legend overlay on graph canvas |

---

---

## Setup Instructions

### Prerequisites

- **Node.js 18+** — [download](https://nodejs.org)
- **npm** (comes with Node.js)
- No other external dependencies (SQLite is embedded, no database server needed)

### 1. Clone / Download the Repo

```bash
git clone <repo-url>
cd o2c-graph-intelligence
```

### 2. Install Dependencies

```bash
npm install
```

This installs: Next.js 14, better-sqlite3, vis-network, @google/generative-ai, and all peer dependencies.

### 3. Ingest the Dataset

> ⚠️ **Ensure the raw data is in place** before running this step.
> The JSONL dataset should be in `sap-o2c-data/` (19 subdirectories).

```bash
node scripts/ingest.js
```

This creates `data/o2c.db` — a SQLite database with all 19 tables and indexes. Takes ~10–30 seconds.

**Expected output:**
```
Ingesting sales_order_headers... 100 rows
Ingesting outbound_delivery_headers... 97 rows
...
Ingestion complete. 19 tables created.
```

### 4. Configure API Key (Optional)

The OpenRouter API key is bundled in `src/app/api/chat/route.js`. To use your own:

1. Sign up at [openrouter.ai](https://openrouter.ai) (free)
2. Create an API key
3. Replace the key in `src/app/api/chat/route.js`:

```javascript
const OPENROUTER_API_KEY = 'sk-or-v1-your-key-here';
```

Or set it as an environment variable by creating `.env.local`:
```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 5. Start the Development Server

```bash
npm run dev
```

Open **http://localhost:3000** in your browser.

### 6. Using the App

- **Graph**: Drag nodes, scroll to zoom, click any node to inspect its metadata
- **Fit View**: Resets graph zoom to show all nodes
- **Toggle Physics**: Freezes/unfreezes the physics layout
- **Chat**: Type any O2C question in the "Analyze anything" box, or click a suggested query chip

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module 'better-sqlite3'` | Run `npm install` again; may need VS Build Tools on Windows |
| `data/o2c.db not found` | Run `node scripts/ingest.js` first |
| Chat returns rate limit error | Wait 30 seconds and retry; free tier has per-minute limits |
| Graph shows 0 nodes | Check browser console; the `/api/graph` route may have an error |
| Port 3000 in use | Run `npm run dev -- -p 3001` to use a different port |

---

## Project Structure

```
├── scripts/
│   └── ingest.js              # JSONL → SQLite ingestion
├── sessions/
│   └── antigravity-session.md # AI coding session transcript
├── src/
│   ├── app/
│   │   ├── page.js             # Main layout
│   │   ├── globals.css          # Dark-mode design system
│   │   └── api/
│   │       ├── graph/route.js   # Graph data API
│   │       └── chat/route.js    # LLM chat API (OpenRouter)
│   ├── components/
│   │   ├── GraphCanvas.jsx      # vis-network graph canvas
│   │   └── ChatPanel.jsx        # Chat UI with SQL reveal
│   └── lib/
│       ├── db.js                # SQLite singleton connection
│       ├── schema.js            # Verified DB schema for LLM prompt
│       └── graphBuilder.js      # Graph nodes + edges construction
├── data/
│   └── o2c.db                   # SQLite database (run ingest.js to generate)
├── sap-o2c-data/                # Raw JSONL dataset (19 folders)
├── package.json
└── README.md
```

#   D o d g e - A I - T a s k - U m e s h - C h a p a l a  
 