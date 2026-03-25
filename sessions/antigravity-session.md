# AI Coding Session Log — O2C Graph Intelligence
# Tool: Antigravity AI (Google DeepMind)
# Session: 2026-03-23 to 2026-03-25
# Conversation ID: 5b517a83-c9c9-462c-9905-8b25c3657a3c

---

## Session Overview

This session covers the complete development of the O2C Graph Intelligence system from initial planning through final verification. The AI assistant was used for architecture design, code generation, debugging, schema analysis, and iterative refinement.

---

## Phase 1: Planning & Architecture (2026-03-23)

### Prompt: Initial project planning
**User:** Build a graph-based data modeling and query system for SAP O2C data.

**AI Reasoning:**
- Explored 19 JSONL directories to understand schema
- Identified core O2C flow: SO → Delivery → Billing → Journal Entry → Payment
- Decided on SQLite (zero-config, fast reads) over PostgreSQL/Neo4j
- Chose vis-network for graph visualization (lightweight, physics layout)
- Chose Next.js 14 App Router (API routes + React in one codebase)
- Planned two-pass LLM: NL→SQL then results→NL answer

**Implementation Plan Created:**
```
Phase 1: Data ingestion (JSONL → SQLite)
Phase 2: Graph builder (SQL → nodes/edges)
Phase 3: Graph visualization (vis-network)
Phase 4: LLM chat API (NL→SQL→answer)
Phase 5: Guardrails (domain restriction + SQL safety)
```

---

## Phase 2: Data Ingestion (2026-03-23 to 2026-03-24)

### Prompt: Create data ingestion script
**User:** Ingest all 19 JSONL tables into SQLite.

**AI Generated:** `scripts/ingest.js`
- Reads each JSONL file line by line
- Flattens nested structures
- Auto-detects columns from first record
- Creates indexed tables for all FK relationships

**Bug Found & Fixed:**
```
Error: column "referenceSdDocument" - invalid identifier
Fix: Used double-quoted identifiers in CREATE INDEX for camelCase columns
```

### Key Schema Discovery:
After examining sample data:
```jsonl
{"billingDocument":"90504298","referenceSdDocument":"80738109",...}
```
Discovered that `referenceSdDocument` (not `salesOrder`) is used in delivery/billing items 
to chain documents — critical for correct graph edges.

---

## Phase 3: Graph Construction (2026-03-24)

### Prompt: Build graph with correct relationships
**User:** The graph edges are wrong, deliveries aren't connecting to billing.

**AI Debug Process:**
1. Examined actual JSONL data samples
2. Found `outbound_delivery_items.referenceSdDocument` = sales order
3. Found `billing_document_items.referenceSdDocument` = delivery document (not SO)
4. Rewrote `graphBuilder.js` with correct join logic

**Final Relationship Chain:**
```javascript
// Delivery → SO link
SELECT odi.deliveryDocument, odi.referenceSdDocument AS salesOrder
FROM outbound_delivery_items odi

// Billing → Delivery link  
SELECT bdi.billingDocument, bdi.referenceSdDocument AS deliveryDocument
FROM billing_document_items bdi
```

---

## Phase 4: LLM Chat Integration (2026-03-24 to 2026-03-25)

### Prompt: Implement Gemini-powered NL→SQL chat
**User:** Add a chat interface that translates questions to SQL.

**AI Generated:** `src/app/api/chat/route.js`

**Model Errors Encountered:**
```
Error 404: gemini-1.0-pro not found
Error 404: gemini-1.5-flash not found  
Fix: Listed available models via API, found gemini-2.0-flash-001
```

**Rate Limit Issues:**
```
Error 429: Too Many Requests (free tier)
Migration: Switched from Google AI SDK to OpenRouter API
OpenRouter provides same models with higher free-tier limits
```

**Off-Topic Guardrail Prompt Engineering:**
```javascript
// System prompt instructs LLM to return structured JSON for off-topic:
{"off_topic": true, "response": "This system is designed to answer..."}
```

---

## Phase 5: Schema Accuracy Fixes (2026-03-25)

### Prompt: Top products query fails with "no such column: p.productDescription"
**User:** [shows SQL error]

**AI Debug Process:**
1. Ran DB audit script to get exact column names for all 19 tables
2. Found: `products` table has NO `productDescription` column
3. That column only exists in `product_descriptions` table
4. Fixed both schema.js and system prompt to prevent future hallucinations

**Schema corrections made:**
- `outbound_delivery_items`: columns are `referenceSdDocument`, `referenceSdDocumentItem` (not `salesOrder`, `salesOrderItem`)  
- `billing_document_items`: same column naming pattern
- `journal_entry_items_ar`: uses `referenceDocument` to link to billing (not `billingDocument`)
- `payments_ar`: links via `accountingDocument`, does NOT have `paymentDocument`

**SQL Patterns Added to System Prompt:**
```sql
-- A) Top products by billing docs (VERIFIED)
SELECT pd.productDescription, COUNT(DISTINCT bdi.billingDocument) AS billing_doc_count
FROM billing_document_items bdi
JOIN product_descriptions pd ON bdi.material = pd.product
WHERE pd.language = 'EN'
GROUP BY pd.productDescription
ORDER BY billing_doc_count DESC LIMIT 10

-- B) Trace billing document flow (VERIFIED)
SELECT odi.referenceSdDocument AS salesOrder,
  bdi.referenceSdDocument AS deliveryDocument,
  bdh.billingDocument, bdh.accountingDocument AS journalEntryDoc,
  CASE WHEN pay.accountingDocument IS NOT NULL THEN 'Paid' ELSE 'Unpaid' END AS paymentStatus
FROM billing_document_headers bdh
LEFT JOIN billing_document_items bdi ON bdi.billingDocument = bdh.billingDocument
LEFT JOIN outbound_delivery_items odi ON odi.deliveryDocument = bdi.referenceSdDocument
LEFT JOIN payments_ar pay ON pay.accountingDocument = bdh.accountingDocument
WHERE bdh.billingDocument = '?'

-- C) Delivered but not billed (VERIFIED)
SELECT DISTINCT odi.referenceSdDocument AS salesOrder
FROM outbound_delivery_items odi
WHERE odi.referenceSdDocument NOT IN (
  SELECT DISTINCT odi2.referenceSdDocument
  FROM billing_document_items bdi2
  JOIN outbound_delivery_items odi2 ON odi2.deliveryDocument = bdi2.referenceSdDocument
)
```

---

## Phase 6: Verification (2026-03-25)

### All 3 required queries tested in live app:

**Query A: Top products by billing docs**
- Generated SQL: correct JOIN on product_descriptions
- Result: SUNSCREEN GEL SPF50-PA+++ 50ML & FACESERUM 30ML VIT C (22 each)
- Status: ✅ PASS

**Query B: Trace billing doc 90504248**  
- Generated SQL: multi-table LEFT JOIN chain
- Result: SO 740552 → DEL 80738072 → BILL 90504248 → JE 9400000249 (Unpaid)
- Status: ✅ PASS

**Query C: Delivered but not billed**
- Generated SQL: anti-join subquery
- Result: 3 orders found (740506, 740507, 740508)
- Status: ✅ PASS

---

## Prompting Patterns That Worked Well

1. **Include verified SQL examples in system prompt** — prevents column hallucination
2. **Explicit "never do X" warnings** — "products has NO productDescription column"
3. **Two-pass LLM** — separate SQL generation from answer generation
4. **Low temperature (0.1)** for SQL generation — high precision over creativity
5. **Structured JSON output format** — easier to parse than free-form text

## Debugging Patterns Used

1. Direct DB audit script to verify actual column names
2. Test SQL queries directly against SQLite before relying on LLM
3. Surface SQL errors to user with the generated SQL visible — easier to debug
4. Check server logs for 429 vs 404 vs SQL errors to distinguish failure types
