// src/app/api/chain/route.js
// Given a node ID, returns all node IDs in its O2C chain for graph highlighting

import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get('nodeId'); // e.g. "SO-740506" or "BILL-90504248"
  if (!nodeId) return NextResponse.json({ chain: [] });

  try {
    const db = getDb();
    const chain = new Set([nodeId]);

    const [type, id] = nodeId.split('-').length >= 2
      ? [nodeId.split('-')[0], nodeId.split('-').slice(1).join('-')]
      : [null, null];

    if (!type || !id) return NextResponse.json({ chain: [nodeId] });

    // Traverse the full O2C chain based on entity type
    if (type === 'SO') {
      // SO → delivery items → deliveries
      const deliveries = db.prepare(
        `SELECT DISTINCT deliveryDocument FROM outbound_delivery_items WHERE referenceSdDocument = ?`
      ).all(id);
      deliveries.forEach(r => {
        chain.add(`DEL-${r.deliveryDocument}`);
        // delivery → billing items → billing docs
        const bills = db.prepare(
          `SELECT DISTINCT billingDocument FROM billing_document_items WHERE referenceSdDocument = ?`
        ).all(r.deliveryDocument);
        bills.forEach(b => {
          chain.add(`BILL-${b.billingDocument}`);
          // billing → journal entries
          const bdh = db.prepare(
            `SELECT accountingDocument FROM billing_document_headers WHERE billingDocument = ?`
          ).get(b.billingDocument);
          if (bdh?.accountingDocument) {
            chain.add(`JE-${bdh.accountingDocument}`);
            // journal → payments
            const pays = db.prepare(
              `SELECT DISTINCT accountingDocument FROM payments_ar WHERE accountingDocument = ?`
            ).all(bdh.accountingDocument);
            pays.forEach(p => chain.add(`PAY-${p.accountingDocument}`));
          }
        });
      });
      // SO → SO items
      const items = db.prepare(
        `SELECT salesOrderItem FROM sales_order_items WHERE salesOrder = ?`
      ).all(id);
      items.forEach(i => chain.add(`SOI-${id}-${i.salesOrderItem}`));

    } else if (type === 'DEL') {
      // Delivery: find its SO and cascade both ways
      const soLinks = db.prepare(
        `SELECT DISTINCT referenceSdDocument FROM outbound_delivery_items WHERE deliveryDocument = ?`
      ).all(id);
      soLinks.forEach(r => chain.add(`SO-${r.referenceSdDocument}`));
      // delivery → billing
      const bills = db.prepare(
        `SELECT DISTINCT billingDocument FROM billing_document_items WHERE referenceSdDocument = ?`
      ).all(id);
      bills.forEach(b => {
        chain.add(`BILL-${b.billingDocument}`);
        const bdh = db.prepare(
          `SELECT accountingDocument FROM billing_document_headers WHERE billingDocument = ?`
        ).get(b.billingDocument);
        if (bdh?.accountingDocument) {
          chain.add(`JE-${bdh.accountingDocument}`);
          const pays = db.prepare(
            `SELECT DISTINCT accountingDocument FROM payments_ar WHERE accountingDocument = ?`
          ).all(bdh.accountingDocument);
          pays.forEach(p => chain.add(`PAY-${p.accountingDocument}`));
        }
      });

    } else if (type === 'BILL') {
      // Billing: find delivery, SO, JE, payment
      const items = db.prepare(
        `SELECT DISTINCT referenceSdDocument FROM billing_document_items WHERE billingDocument = ?`
      ).all(id);
      items.forEach(r => {
        chain.add(`DEL-${r.referenceSdDocument}`);
        const soLinks = db.prepare(
          `SELECT DISTINCT referenceSdDocument FROM outbound_delivery_items WHERE deliveryDocument = ?`
        ).all(r.referenceSdDocument);
        soLinks.forEach(s => chain.add(`SO-${s.referenceSdDocument}`));
      });
      const bdh = db.prepare(
        `SELECT accountingDocument, soldToParty FROM billing_document_headers WHERE billingDocument = ?`
      ).get(id);
      if (bdh?.accountingDocument) {
        chain.add(`JE-${bdh.accountingDocument}`);
        const pays = db.prepare(
          `SELECT DISTINCT accountingDocument FROM payments_ar WHERE accountingDocument = ?`
        ).all(bdh.accountingDocument);
        pays.forEach(p => chain.add(`PAY-${p.accountingDocument}`));
      }
      if (bdh?.soldToParty) chain.add(`CUST-${bdh.soldToParty}`);

    } else if (type === 'JE') {
      // Journal entry: find billing doc, then cascade full chain
      const jeRow = db.prepare(
        `SELECT referenceDocument FROM journal_entry_items_ar WHERE accountingDocument = ?`
      ).get(id);
      if (jeRow?.referenceDocument) {
        chain.add(`BILL-${jeRow.referenceDocument}`);
      }
      // Also find payment
      const pays = db.prepare(
        `SELECT DISTINCT accountingDocument FROM payments_ar WHERE accountingDocument = ?`
      ).all(id);
      pays.forEach(p => chain.add(`PAY-${p.accountingDocument}`));

    } else if (type === 'PAY') {
      // Payment: go backwards to JE → billing doc
      chain.add(`JE-${id}`);
    }

    return NextResponse.json({ chain: [...chain] });
  } catch (error) {
    console.error('Chain API error:', error);
    return NextResponse.json({ chain: [nodeId] });
  }
}
