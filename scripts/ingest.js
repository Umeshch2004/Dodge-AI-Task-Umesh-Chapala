#!/usr/bin/env node
/**
 * Data Ingestion Script
 * Reads all 19 JSONL files from sap-o2c-data and loads them into SQLite.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'sap-o2c-data');
const DB_PATH = path.join(__dirname, '..', 'data', 'o2c.db');

// Ensure data dir exists
if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
  fs.mkdirSync(path.join(__dirname, '..', 'data'));
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Read all JSONL files from a folder and return parsed records */
function readJsonlFolder(folderName) {
  const folderPath = path.join(DATA_DIR, folderName);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
  const records = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(folderPath, file), 'utf8');
    content.split('\n').forEach(line => {
      if (line.trim()) {
        try { records.push(JSON.parse(line)); } catch {}
      }
    });
  }
  return records;
}

/** Flatten nested objects (e.g. creationTime: {hours,minutes,seconds} → string) */
function flatten(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = JSON.stringify(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/** Create table from first record's keys and insert all records */
function loadTable(tableName, records) {
  if (!records.length) { console.log(`  ${tableName}: 0 records`); return; }
  const sample = flatten(records[0]);
  const cols = Object.keys(sample);
  const colDefs = cols.map(c => `"${c}" TEXT`).join(', ');
  db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
  db.exec(`CREATE TABLE "${tableName}" (${colDefs})`);
  const placeholders = cols.map(() => '?').join(', ');
  const insert = db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const flat = flatten(row);
      insert.run(cols.map(c => flat[c] !== undefined && flat[c] !== null ? String(flat[c]) : null));
    }
  });
  insertMany(records);
  console.log(`  ${tableName}: ${records.length} records`);
}

console.log('Starting data ingestion...\n');

const TABLES = [
  ['sales_order_headers', 'sales_order_headers'],
  ['sales_order_items', 'sales_order_items'],
  ['sales_order_schedule_lines', 'sales_order_schedule_lines'],
  ['outbound_delivery_headers', 'outbound_delivery_headers'],
  ['outbound_delivery_items', 'outbound_delivery_items'],
  ['billing_document_headers', 'billing_document_headers'],
  ['billing_document_items', 'billing_document_items'],
  ['billing_document_cancellations', 'billing_document_cancellations'],
  ['journal_entry_items_ar', 'journal_entry_items_accounts_receivable'],
  ['payments_ar', 'payments_accounts_receivable'],
  ['business_partners', 'business_partners'],
  ['customer_company_assignments', 'customer_company_assignments'],
  ['customer_sales_area_assignments', 'customer_sales_area_assignments'],
  ['business_partner_addresses', 'business_partner_addresses'],
  ['products', 'products'],
  ['product_descriptions', 'product_descriptions'],
  ['product_plants', 'product_plants'],
  ['product_storage_locations', 'product_storage_locations'],
  ['plants', 'plants'],
];

for (const [tableName, folderName] of TABLES) {
  const records = readJsonlFolder(folderName);
  loadTable(tableName, records);
}

// Create useful indexes for query performance
console.log('\nCreating indexes...');
const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_soh_soldto ON sales_order_headers("soldToParty")',
  'CREATE INDEX IF NOT EXISTS idx_soi_so ON sales_order_items("salesOrder")',
  'CREATE INDEX IF NOT EXISTS idx_soi_material ON sales_order_items("material")',
  'CREATE INDEX IF NOT EXISTS idx_odh_del ON outbound_delivery_headers("deliveryDocument")',
  'CREATE INDEX IF NOT EXISTS idx_odi_ref ON outbound_delivery_items("referenceSdDocument")',
  'CREATE INDEX IF NOT EXISTS idx_odi_del ON outbound_delivery_items("deliveryDocument")',
  'CREATE INDEX IF NOT EXISTS idx_bdh_doc ON billing_document_headers("billingDocument")',
  'CREATE INDEX IF NOT EXISTS idx_bdh_soldto ON billing_document_headers("soldToParty")',
  'CREATE INDEX IF NOT EXISTS idx_bdi_ref ON billing_document_items("referenceSdDocument")',
  'CREATE INDEX IF NOT EXISTS idx_bdi_bill ON billing_document_items("billingDocument")',
  'CREATE INDEX IF NOT EXISTS idx_jei_ref ON journal_entry_items_ar("referenceDocument")',
  'CREATE INDEX IF NOT EXISTS idx_jei_acc ON journal_entry_items_ar("accountingDocument")',
  'CREATE INDEX IF NOT EXISTS idx_pay_acc ON payments_ar("accountingDocument")',
];
for (const idx of indexes) {
  db.exec(idx);
}

db.close();
console.log('\n✅ Ingestion complete! Database saved to data/o2c.db');
