// src/app/api/kpis/route.js
// Returns live O2C business KPIs computed directly from the database

import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';

export async function GET() {
  try {
    const db = getDb();

    // 1. Total sales orders
    const { totalOrders } = db.prepare(
      `SELECT COUNT(*) AS totalOrders FROM sales_order_headers`
    ).get();

    // 2. Total billed revenue (non-cancelled)
    const { totalRevenue } = db.prepare(
      `SELECT COALESCE(SUM(CAST(totalNetAmount AS REAL)), 0) AS totalRevenue
       FROM billing_document_headers
       WHERE billingDocumentIsCancelled != 'true'`
    ).get();

    // 3. Orders delivered but not billed (broken flows / revenue at risk)
    const { brokenFlows } = db.prepare(
      `SELECT COUNT(DISTINCT odi.referenceSdDocument) AS brokenFlows
       FROM outbound_delivery_items odi
       WHERE odi.referenceSdDocument NOT IN (
         SELECT DISTINCT odi2.referenceSdDocument
         FROM billing_document_items bdi2
         JOIN outbound_delivery_items odi2 ON odi2.deliveryDocument = bdi2.referenceSdDocument
       )`
    ).get();

    // 4. Payment collection rate (% of billing docs fully cleared)
    const { totalBilled } = db.prepare(
      `SELECT COUNT(DISTINCT billingDocument) AS totalBilled
       FROM billing_document_headers
       WHERE billingDocumentIsCancelled != 'true'`
    ).get();

    const { totalPaid } = db.prepare(
      `SELECT COUNT(DISTINCT bdh.billingDocument) AS totalPaid
       FROM billing_document_headers bdh
       JOIN payments_ar pay ON pay.accountingDocument = bdh.accountingDocument
       WHERE bdh.billingDocumentIsCancelled != 'true'`
    ).get();

    const collectionRate = totalBilled > 0
      ? Math.round((totalPaid / totalBilled) * 100)
      : 0;

    // 5. Cancelled billing docs count
    const { cancelledCount } = db.prepare(
      `SELECT COUNT(*) AS cancelledCount FROM billing_document_headers
       WHERE billingDocumentIsCancelled = 'true'`
    ).get();

    // 6. Average order value
    const { avgOrderValue } = db.prepare(
      `SELECT COALESCE(AVG(CAST(totalNetAmount AS REAL)), 0) AS avgOrderValue
       FROM billing_document_headers
       WHERE billingDocumentIsCancelled != 'true'`
    ).get();

    return NextResponse.json({
      totalOrders,
      totalRevenue: Math.round(totalRevenue),
      brokenFlows,
      collectionRate,
      cancelledCount,
      avgOrderValue: Math.round(avgOrderValue),
    });
  } catch (error) {
    console.error('KPI error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
