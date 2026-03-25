// src/lib/graphBuilder.js
// Builds graph nodes and edges from the SQLite database

import { getDb } from './db';

const NODE_COLORS = {
  SalesOrder:      { bg: '#6366f1', border: '#4f46e5', font: '#fff' },
  SalesOrderItem:  { bg: '#8b5cf6', border: '#7c3aed', font: '#fff' },
  Delivery:        { bg: '#0ea5e9', border: '#0284c7', font: '#fff' },
  BillingDocument: { bg: '#f59e0b', border: '#d97706', font: '#000' },
  JournalEntry:    { bg: '#10b981', border: '#059669', font: '#fff' },
  Payment:         { bg: '#22c55e', border: '#16a34a', font: '#fff' },
  Customer:        { bg: '#ef4444', border: '#dc2626', font: '#fff' },
  Product:         { bg: '#f97316', border: '#ea580c', font: '#fff' },
  Plant:           { bg: '#84cc16', border: '#65a30d', font: '#000' },
};

const NODE_SIZES = {
  SalesOrder: 18, Customer: 16, BillingDocument: 15,
  Delivery: 14, SalesOrderItem: 12, JournalEntry: 12,
  Payment: 12, Product: 11, Plant: 10,
};

function nodeStyle(type) {
  const c = NODE_COLORS[type] || { bg: '#94a3b8', border: '#64748b', font: '#fff' };
  return {
    color: {
      background: c.bg, border: c.border,
      highlight: { background: c.bg, border: '#ffffff' },
      hover: { background: c.bg, border: '#ffffff' },
    },
    font: { color: '#09090b', size: 11, face: 'Inter, sans-serif' },
    shape: 'dot',
    size: NODE_SIZES[type] || 12,
  };
}

function safeStr(v) { return String(v || '').replace(/'/g, "''"); }
function inList(arr) { return arr.map(v => `'${safeStr(v)}'`).join(','); }

export function buildGraph() {
  const db = getDb();
  const nodes = [];
  const edges = [];
  const nodeSet = new Set();
  const edgeSet = new Set();
  let edgeId = 0;

  function addNode(id, label, type, metadata) {
    if (!nodeSet.has(id)) {
      nodeSet.add(id);
      nodes.push({ id, label, title: type, group: type, metadata, ...nodeStyle(type) });
    }
  }

  function addEdge(from, to, label) {
    const key = `${from}→${to}`;
    if (!nodeSet.has(from) || !nodeSet.has(to) || edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({
      id: `e${edgeId++}`, from, to, label,
      arrows: { to: { enabled: true, scaleFactor: 0.6 } },
      font: { size: 9, align: 'middle', color: '#94a3b8' },
      color: { color: '#2a4a7f', highlight: '#6366f1', hover: '#6366f1' },
      smooth: { type: 'curvedCW', roundness: 0.1 },
    });
  }

  // ── Sales Orders ──────────────────────────────────────────────────────────
  const salesOrders = db.prepare('SELECT * FROM sales_order_headers LIMIT 80').all();
  for (const so of salesOrders) {
    const soId = `SO_${so.salesOrder}`;
    addNode(soId, `SO ${so.salesOrder}`, 'SalesOrder', so);
    if (so.soldToParty) {
      const custId = `CUST_${so.soldToParty}`;
      if (!nodeSet.has(custId)) {
        const cust = db.prepare('SELECT * FROM business_partners WHERE businessPartner = ?').get(so.soldToParty) || {};
        const addr = db.prepare('SELECT * FROM business_partner_addresses WHERE businessPartner = ?').get(so.soldToParty) || {};
        addNode(custId, `CUST ${so.soldToParty}`, 'Customer', { ...cust, ...addr });
      }
      addEdge(`CUST_${so.soldToParty}`, soId, 'placed');
    }
  }

  const soNumbers = salesOrders.map(s => s.salesOrder);
  if (!soNumbers.length) return { nodes, edges };

  // ── Sales Order Items ──────────────────────────────────────────────────────
  const items = db.prepare(
    `SELECT * FROM sales_order_items WHERE salesOrder IN (${inList(soNumbers)})`
  ).all();
  for (const item of items) {
    const soId = `SO_${item.salesOrder}`;
    const itemId = `SOI_${item.salesOrder}_${item.salesOrderItem}`;
    addNode(itemId, `Item ${item.salesOrderItem}`, 'SalesOrderItem', item);
    addEdge(soId, itemId, 'has');
    if (item.material) {
      const prodId = `PROD_${item.material}`;
      if (!nodeSet.has(prodId)) {
        const desc = db.prepare("SELECT productDescription FROM product_descriptions WHERE product = ? AND language = 'EN' LIMIT 1").get(item.material);
        const prod = db.prepare('SELECT * FROM products WHERE product = ?').get(item.material) || {};
        addNode(prodId, (desc?.productDescription || item.material).substring(0, 20), 'Product', { ...prod, material: item.material, productDescription: desc?.productDescription });
      }
      addEdge(itemId, prodId, 'product');
    }
    if (item.productionPlant) {
      const plantId = `PLANT_${item.productionPlant}`;
      if (!nodeSet.has(plantId)) {
        const plant = db.prepare('SELECT * FROM plants WHERE plant = ?').get(item.productionPlant) || {};
        addNode(plantId, `Plant ${item.productionPlant}`, 'Plant', { ...plant, plant: item.productionPlant });
      }
      addEdge(itemId, plantId, 'shipped from');
    }
  }

  // ── Deliveries ── linked via outbound_delivery_items.referenceSdDocument = SO ──
  const delivRows = db.prepare(`
    SELECT odi.deliveryDocument, odi.referenceSdDocument AS salesOrder,
           odh.shippingPoint, odh.overallGoodsMovementStatus,
           odh.actualGoodsMovementDate, odh.overallPickingStatus
    FROM outbound_delivery_items odi
    JOIN outbound_delivery_headers odh ON odh.deliveryDocument = odi.deliveryDocument
    WHERE odi.referenceSdDocument IN (${inList(soNumbers)})
    GROUP BY odi.deliveryDocument`).all();

  const deliveryDocIds = [];
  for (const di of delivRows) {
    const delId = `DEL_${di.deliveryDocument}`;
    if (!nodeSet.has(delId)) {
      deliveryDocIds.push(di.deliveryDocument);
      addNode(delId, `DEL ${di.deliveryDocument}`, 'Delivery', {
        deliveryDocument: di.deliveryDocument,
        shippingPoint: di.shippingPoint,
        overallGoodsMovementStatus: di.overallGoodsMovementStatus,
        overallPickingStatus: di.overallPickingStatus,
        actualGoodsMovementDate: di.actualGoodsMovementDate,
      });
    }
    const soId = `SO_${di.salesOrder}`;
    if (nodeSet.has(soId)) addEdge(soId, delId, 'delivered');
  }

  // ── Billing Documents ── linked via billing_document_items.referenceSdDocument = Delivery ──
  if (deliveryDocIds.length) {
    const billRows = db.prepare(`
      SELECT bdi.billingDocument, bdi.referenceSdDocument AS deliveryDocument,
             bdh.billingDocumentType, bdh.billingDocumentIsCancelled,
             bdh.totalNetAmount, bdh.billingDocumentDate, bdh.accountingDocument, bdh.soldToParty
      FROM billing_document_items bdi
      JOIN billing_document_headers bdh ON bdh.billingDocument = bdi.billingDocument
      WHERE bdi.referenceSdDocument IN (${inList(deliveryDocIds)})
      GROUP BY bdi.billingDocument`).all();

    for (const bi of billRows) {
      const billId = `BILL_${bi.billingDocument}`;
      const delId = `DEL_${bi.deliveryDocument}`;
      if (!nodeSet.has(billId)) {
        addNode(billId, `BILL ${bi.billingDocument}`, 'BillingDocument', {
          billingDocument: bi.billingDocument,
          billingDocumentType: bi.billingDocumentType,
          billingDocumentIsCancelled: bi.billingDocumentIsCancelled,
          totalNetAmount: bi.totalNetAmount,
          billingDocumentDate: bi.billingDocumentDate,
          accountingDocument: bi.accountingDocument,
          soldToParty: bi.soldToParty,
        });
      }
      if (nodeSet.has(delId)) addEdge(delId, billId, 'billed');

      // ── Journal Entries ──
      if (bi.accountingDocument) {
        const je = db.prepare('SELECT * FROM journal_entry_items_ar WHERE accountingDocument = ? LIMIT 1').get(bi.accountingDocument);
        if (je) {
          const jeId = `JE_${bi.accountingDocument}`;
          addNode(jeId, `JE ${bi.accountingDocument}`, 'JournalEntry', je);
          addEdge(billId, jeId, 'posted to');

          // ── Payments ──
          const pay = db.prepare('SELECT * FROM payments_ar WHERE accountingDocument = ? LIMIT 1').get(bi.accountingDocument);
          if (pay) {
            const payKey = pay.paymentDocument || pay.clearingDocument || bi.accountingDocument;
            const payId = `PAY_${payKey}`;
            addNode(payId, `PAY ${pay.paymentDocument || 'N/A'}`, 'Payment', pay);
            addEdge(jeId, payId, 'cleared by');
          }
        }
      }
    }
  }

  return { nodes, edges };
}
