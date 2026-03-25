// src/lib/schema.js
// Database schema for LLM prompts — verified against actual SQLite column names

export const SCHEMA_DESCRIPTION = `
SQLite database with 19 tables from an SAP Order-to-Cash (O2C) process.

=== CORE FLOW TABLES ===

TABLE: sales_order_headers
  salesOrder (TEXT, PK) - Sales order number (e.g. "740506")
  salesOrderType (TEXT) - e.g. "OR" = standard order
  salesOrganization, distributionChannel, organizationDivision, salesGroup, salesOffice
  soldToParty (TEXT, FK→business_partners.businessPartner) - Customer ID
  creationDate (TEXT) - ISO date
  lastChangeDateTime (TEXT)
  totalNetAmount (TEXT) - Order total (INR)
  transactionCurrency (TEXT)
  overallDeliveryStatus (TEXT) - A=not started, B=partial, C=complete
  overallOrdReltdBillgStatus (TEXT) - A=not started, B=partial, C=complete
  overallSdDocReferenceStatus (TEXT)
  headerBillingBlockReason, deliveryBlockReason
  customerPaymentTerms (TEXT)
  pricingDate, requestedDeliveryDate, incotermsClassification, incotermsLocation1
  totalCreditCheckStatus (TEXT)

TABLE: sales_order_items
  salesOrder (TEXT, FK→sales_order_headers.salesOrder)
  salesOrderItem (TEXT) - Item number (10, 20, 30...)
  salesOrderItemCategory (TEXT)
  material (TEXT, FK→products.product)
  requestedQuantity, requestedQuantityUnit
  netAmount (TEXT) - Item net amount (INR)
  transactionCurrency
  materialGroup
  productionPlant (TEXT, FK→plants.plant)
  storageLocation
  salesDocumentRjcnReason - rejection reason code
  itemBillingBlockReason

TABLE: outbound_delivery_headers
  deliveryDocument (TEXT, PK) - Delivery ID (e.g. "80738109")
  creationDate, shippingPoint
  overallGoodsMovementStatus (TEXT) - A=not posted, C=fully posted
  overallPickingStatus (TEXT) - A=not started, C=complete
  actualGoodsMovementDate (TEXT)
  overallDeliveryStatus, overallPackingStatus, overallWarehouseActivityStatus
  deliveryDocumentTypeName, headerBillingBlockReason
  soldToParty (TEXT, FK→business_partners.businessPartner)
  totalActualDeliveryQuantity, totalNetWeight, totalGrossWeight, netWeightUnit

TABLE: outbound_delivery_items
  deliveryDocument (TEXT, FK→outbound_delivery_headers.deliveryDocument)
  deliveryDocumentItem (TEXT)
  referenceSdDocument (TEXT, FK→sales_order_headers.salesOrder) ← LINKS TO SALES ORDER
  referenceSdDocumentItem (TEXT) - sales order item number
  material (TEXT, FK→products.product)
  actualDeliveryQuantity, deliveryQuantityUnit
  plant (TEXT, FK→plants.plant)
  storageLocation, batch
  itemBillingBlockReason, lastChangeDate

TABLE: billing_document_headers
  billingDocument (TEXT, PK) - Invoice ID (e.g. "90504248")
  billingDocumentType (TEXT) - F2=invoice, S1=cancellation credit memo
  creationDate, billingDocumentDate
  billingDocumentIsCancelled (TEXT) - "true"/"false"
  cancelledBillingDocument (TEXT)
  totalNetAmount (TEXT) - Invoice total (INR)
  transactionCurrency
  companyCode, fiscalYear
  accountingDocument (TEXT, FK→journal_entry_items_ar.accountingDocument)
  soldToParty (TEXT, FK→business_partners.businessPartner)

TABLE: billing_document_items
  billingDocument (TEXT, FK→billing_document_headers.billingDocument)
  billingDocumentItem (TEXT)
  referenceSdDocument (TEXT, FK→outbound_delivery_headers.deliveryDocument) ← LINKS TO DELIVERY
  referenceSdDocumentItem (TEXT) - delivery item
  material (TEXT, FK→products.product)
  billingQuantity, billingQuantityUnit
  netAmount (TEXT)
  transactionCurrency

TABLE: billing_document_cancellations
  billingDocument (TEXT) - original document
  cancelDocument (TEXT) - cancellation document

TABLE: journal_entry_items_ar (accounts receivable journal entries)
  accountingDocument (TEXT, FK→billing_document_headers.accountingDocument)
  companyCode, fiscalYear
  accountingDocumentItem (TEXT)
  referenceDocument (TEXT, FK→billing_document_headers.billingDocument) ← LINKS TO BILLING DOC
  glAccount
  amountInTransactionCurrency (TEXT) - line amount (INR)
  transactionCurrency, companyCodeCurrency
  amountInCompanyCodeCurrency (TEXT)
  postingDate, documentDate
  accountingDocumentType (TEXT) - RV=billing, AB=adjustment
  assignmentReference
  lastChangeDateTime
  customer (TEXT)
  financialAccountType
  clearingDate, clearingAccountingDocument, clearingDocFiscalYear
  costCenter, profitCenter

TABLE: payments_ar (accounts receivable payments / clearing)
  accountingDocument (TEXT, FK→journal_entry_items_ar.accountingDocument)
  companyCode, fiscalYear
  accountingDocumentItem (TEXT)
  clearingDate (TEXT)
  clearingAccountingDocument (TEXT) - payment clearing document
  clearingDocFiscalYear (TEXT)
  amountInTransactionCurrency (TEXT)
  transactionCurrency, companyCodeCurrency
  amountInCompanyCodeCurrency (TEXT)
  customer (TEXT)
  invoiceReference, invoiceReferenceFiscalYear
  postingDate, documentDate
  assignmentReference
  glAccount
  financialAccountType
  profitCenter, costCenter

=== SUPPORTING ENTITY TABLES ===

TABLE: business_partners
  businessPartner (TEXT, PK) - Customer/partner ID (e.g. "310000108")
  customer (TEXT) - same as businessPartner for customers
  businessPartnerCategory (TEXT) - 1=person, 2=org
  businessPartnerFullName (TEXT)
  businessPartnerName, businessPartnerGrouping
  correspondenceLanguage
  createdByUser, creationDate, creationTime
  firstName, lastName, formOfAddress
  organizationBpName1, organizationBpName2
  industry, lastChangeDate
  businessPartnerIsBlocked, isMarkedForArchiving

TABLE: business_partner_addresses
  businessPartner (TEXT, FK→business_partners.businessPartner)
  addressId, validityStartDate, validityEndDate
  cityName, country, region, postalCode
  streetName, taxJurisdiction, transportZone
  poBox, poBoxPostalCode, poBoxDeviatingCityName

TABLE: customer_company_assignments
  customer (TEXT, FK→business_partners.businessPartner)
  companyCode
  reconciliationAccount, paymentTerms
  paymentMethodsList, paymentBlockingReason
  creditControlArea, accountingClerk

TABLE: customer_sales_area_assignments
  customer (TEXT, FK→business_partners.businessPartner)
  salesOrganization, distributionChannel, division
  billingIsBlockedForCustomer, customerPaymentTerms
  deliveryPriority, incotermsClassification, incotermsLocation1
  creditControlArea, currency, shippingCondition, supplyingPlant

TABLE: products
  product (TEXT, PK) - Material/product ID (e.g. "S8907367028192")
  productType (TEXT)
  productGroup (TEXT)
  baseUnit (TEXT) - e.g. "PC"
  weightUnit, grossWeight, netWeight
  division, industrySector
  creationDate, createdByUser, lastChangeDate, lastChangeDateTime
  productOldId, crossPlantStatus
  isMarkedForDeletion
  NOTE: products has NO productDescription column — use product_descriptions table

TABLE: product_descriptions
  product (TEXT, FK→products.product)
  language (TEXT) - filter WHERE language = 'EN' for English
  productDescription (TEXT) - Human-readable name (ONLY table with this column)

TABLE: product_plants
  product (TEXT, FK→products.product)
  plant (TEXT, FK→plants.plant)
  profitCenter, mrpType, fiscalYearVariant
  countryOfOrigin, regionOfOrigin, availabilityCheckType

TABLE: product_storage_locations
  product (TEXT, FK→products.product)
  plant (TEXT, FK→plants.plant)
  storageLocation (TEXT)

TABLE: plants
  plant (TEXT, PK) - Plant code (e.g. "1001")
  plantName (TEXT)
  valuationArea, plantCustomer, plantSupplier
  salesOrganization, distributionChannel, division
  countryCode, regionCode, language

=== KEY RELATIONSHIPS SUMMARY ===
Customer (business_partners) → Sales Order (soldToParty)
Sales Order → Sales Order Items (salesOrder)
Sales Order Item → Product (material), Plant (productionPlant)
Sales Order → Delivery: outbound_delivery_items.referenceSdDocument = sales_order_headers.salesOrder
Delivery → Billing: billing_document_items.referenceSdDocument = outbound_delivery_headers.deliveryDocument
Billing → Journal Entry: billing_document_headers.accountingDocument = journal_entry_items_ar.accountingDocument
Journal Entry → Payment: journal_entry_items_ar.accountingDocument = payments_ar.accountingDocument
Also: journal_entry_items_ar.referenceDocument = billing_document_headers.billingDocument
`;

export const GUARDRAIL_TOPICS = [
  'order', 'delivery', 'billing', 'invoice', 'payment', 'customer', 'product',
  'material', 'sales', 'plant', 'journal', 'accounting', 'document', 'shipment',
  'quantity', 'amount', 'currency', 'flow', 'status', 'o2c', 'sap', 'revenue',
  'cancelled', 'goods', 'movement', 'clearing', 'fiscal', 'trace', 'broken'
];
