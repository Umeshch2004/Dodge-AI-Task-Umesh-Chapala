// src/app/api/chat/route.js
// LLM-powered chat endpoint: NL → SQL → answer (via OpenRouter)

import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { SCHEMA_DESCRIPTION } from '../../../lib/schema';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'google/gemini-2.0-flash-001';

const SYSTEM_PROMPT = `You are an expert SQL analyst for an SAP Order-to-Cash (O2C) business intelligence system.
Your ONLY purpose is to answer questions about the O2C dataset described below.

DOMAIN GUARDRAIL (CRITICAL):
- Only answer questions related to: sales orders, deliveries, billing documents/invoices, payments, customers, products, plants, journal entries, and O2C business process analysis.
- For ANY off-topic question (general knowledge, weather, coding help, creative writing, history, etc.), respond ONLY with this exact JSON:
  {"off_topic": true, "response": "This system is designed to answer questions related to the provided Order-to-Cash dataset only. Please ask about sales orders, deliveries, billing, payments, customers, or products."}

DATABASE SCHEMA:
${SCHEMA_DESCRIPTION}

CRITICAL SQL RULES:
1. Use ONLY SELECT statements. NEVER use INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, PRAGMA.
2. ALWAYS add LIMIT (max 50) unless the query is counting/aggregating all rows.
3. Only reference columns that exist in the schema above.
4. products table has NO productDescription column — always JOIN product_descriptions pd ON x.material = pd.product WHERE pd.language = 'EN'.
5. outbound_delivery_items.referenceSdDocument → links to sales_order_headers.salesOrder (NOT called salesOrder in this table).
6. billing_document_items.referenceSdDocument → links to outbound_delivery_headers.deliveryDocument (NOT to salesOrder).
7. journal_entry_items_ar.referenceDocument → links to billing_document_headers.billingDocument.
8. journal_entry_items_ar.accountingDocument = billing_document_headers.accountingDocument (this is how billing links to journal).

VERIFIED CORRECT SQL PATTERNS — use these exact join paths:

-- A) Top products by billing documents:
SELECT pd.productDescription, COUNT(DISTINCT bdi.billingDocument) AS billing_doc_count
FROM billing_document_items bdi
JOIN product_descriptions pd ON bdi.material = pd.product
WHERE pd.language = 'EN'
GROUP BY pd.productDescription
ORDER BY billing_doc_count DESC LIMIT 10

-- B) Trace full flow of a billing document (replace '90504248' with actual number):
SELECT
  odi.referenceSdDocument AS salesOrder,
  bdi.referenceSdDocument AS deliveryDocument,
  bdh.billingDocument,
  bdh.billingDocumentDate,
  bdh.totalNetAmount,
  bdh.accountingDocument AS journalEntryDoc,
  CASE WHEN pay.accountingDocument IS NOT NULL THEN 'Paid' ELSE 'Unpaid' END AS paymentStatus
FROM billing_document_headers bdh
LEFT JOIN billing_document_items bdi ON bdi.billingDocument = bdh.billingDocument
LEFT JOIN outbound_delivery_items odi ON odi.deliveryDocument = bdi.referenceSdDocument
LEFT JOIN payments_ar pay ON pay.accountingDocument = bdh.accountingDocument
WHERE bdh.billingDocument = '90504248'
GROUP BY bdh.billingDocument

-- C) Delivered but not billed (broken flow — delivery exists, no billing):
SELECT DISTINCT odi.referenceSdDocument AS salesOrder,
  odh.actualGoodsMovementDate AS deliveredOn,
  soh.totalNetAmount
FROM outbound_delivery_items odi
JOIN outbound_delivery_headers odh ON odh.deliveryDocument = odi.deliveryDocument
JOIN sales_order_headers soh ON soh.salesOrder = odi.referenceSdDocument
WHERE odi.referenceSdDocument NOT IN (
  SELECT DISTINCT odi2.referenceSdDocument
  FROM billing_document_items bdi2
  JOIN outbound_delivery_items odi2 ON odi2.deliveryDocument = bdi2.referenceSdDocument
)
LIMIT 50

-- D) Billed without delivery (reversed broken flow):
SELECT DISTINCT bdi.billingDocument, bdh.totalNetAmount, bdh.billingDocumentDate
FROM billing_document_items bdi
JOIN billing_document_headers bdh ON bdh.billingDocument = bdi.billingDocument
WHERE bdi.referenceSdDocument NOT IN (
  SELECT deliveryDocument FROM outbound_delivery_headers
)
LIMIT 50

-- E) Revenue by customer:
SELECT bp.businessPartnerFullName, soh.soldToParty, COUNT(DISTINCT soh.salesOrder) AS orders,
  SUM(CAST(bdh.totalNetAmount AS REAL)) AS totalRevenue
FROM billing_document_headers bdh
JOIN sales_order_headers soh ON soh.soldToParty = bdh.soldToParty
JOIN business_partners bp ON bp.businessPartner = bdh.soldToParty
WHERE bdh.billingDocumentIsCancelled != 'true'
GROUP BY bdh.soldToParty ORDER BY totalRevenue DESC LIMIT 10

RESPONSE FORMAT:
Return ONLY valid JSON with no markdown, no code fences, no extra text:
{"sql": "SELECT ...", "explanation": "what this query does", "intent": "user intent"}`;

async function callOpenRouter(messages) {
  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'O2C Graph Intelligence',
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.1, max_tokens: 2048 }),
  });

  if (!res.ok) {
    const err = await res.text();
    const error = new Error(`OpenRouter ${res.status}: ${err.substring(0, 200)}`);
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function isReadOnlySql(sql) {
  const up = sql.trim().toUpperCase();
  if (!up.startsWith('SELECT') && !up.startsWith('WITH')) return false;
  const banned = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'REPLACE', 'ATTACH', 'PRAGMA'];
  return !banned.some(kw => up.includes(kw));
}

function ensureLimit(sql) {
  if (!sql.toUpperCase().includes('LIMIT')) {
    return sql.trimEnd().replace(/;?\s*$/, '') + ' LIMIT 50';
  }
  return sql;
}

export async function POST(request) {
  try {
    const { message, history = [] } = await request.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Step 1: NL → SQL via LLM
    const sqlMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    let rawResponse;
    try {
      rawResponse = await callOpenRouter(sqlMessages);
    } catch (apiErr) {
      if (apiErr.status === 429) return NextResponse.json({ answer: '⏳ Rate limit reached. Please wait a moment and try again.', isError: true });
      if (apiErr.status === 401) return NextResponse.json({ answer: '⚠️ Invalid API key.', isError: true });
      throw apiErr;
    }

    // Strip markdown fences if present
    rawResponse = rawResponse.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      const match = rawResponse.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
      }
      if (!parsed) {
        return NextResponse.json({
          answer: `I had trouble forming a structured response. Raw model output: ${rawResponse.substring(0, 300)}`,
          isError: true,
        });
      }
    }

    // Off-topic guard
    if (parsed.off_topic) {
      return NextResponse.json({ answer: parsed.response, sql: null, results: null, isOffTopic: true });
    }

    const { sql, explanation } = parsed;
    if (!sql) {
      return NextResponse.json({ answer: "I couldn't generate a valid SQL query. Please try rephrasing your question.", sql: null, results: null });
    }

    if (!isReadOnlySql(sql)) {
      return NextResponse.json({ answer: 'Security: only SELECT queries are permitted on this system.', sql, results: null, isError: true });
    }

    // Step 2: Execute SQL
    const db = getDb();
    const safeSql = ensureLimit(sql);
    let results;
    try {
      results = db.prepare(safeSql).all();
    } catch (sqlError) {
      console.error('SQL execution error:', sqlError.message, '\nSQL:', safeSql);
      return NextResponse.json({
        answer: `The generated SQL had an error: **${sqlError.message}**\n\nSQL attempted:\n\`\`\`sql\n${safeSql}\n\`\`\`\n\nPlease try rephrasing, e.g. "top products by number of billing documents".`,
        sql: safeSql,
        results: null,
        isError: true,
      });
    }

    // Step 3: LLM generates natural language answer
    const answerMessages = [
      {
        role: 'system',
        content: 'You are a business analyst. Give a clear, concise answer based on query results. Use bullet points for lists. Maximum 150 words. Do not repeat the SQL or raw JSON.',
      },
      {
        role: 'user',
        content: `User asked: "${message}"\nQuery ran: \`${safeSql}\`\nReturned ${results.length} row(s):\n${JSON.stringify(results.slice(0, 20), null, 2)}\n\nAnswer the question naturally.`,
      },
    ];

    let answer;
    try {
      answer = await callOpenRouter(answerMessages);
    } catch (apiErr) {
      answer = `Query returned ${results.length} row(s). ${apiErr.status === 429 ? '(Rate limited on summary generation — raw results shown below)' : ''}`;
    }

    return NextResponse.json({ answer, sql: safeSql, results: results.slice(0, 50), explanation, rowCount: results.length });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ answer: `Error: ${error.message}`, isError: true });
  }
}
