import { z } from "zod";

// --- Template Definitions ---

function makeField(id, name, type, opts = {}) {
  return {
    id,
    name,
    type: type.toUpperCase(),
    size: opts.size || "",
    default: opts.default || "",
    check: opts.check || "",
    primary: opts.primary || false,
    unique: opts.unique || false,
    notNull: opts.notNull || false,
    increment: opts.increment || false,
    comment: opts.comment || "",
    values: opts.values || undefined,
  };
}

function uuidPk(id) {
  return makeField(id, "id", "UUID", {
    primary: true,
    unique: true,
    notNull: true,
    comment: "Primary key",
  });
}

function createdAt(id) {
  return makeField(id, "created_at", "TIMESTAMP", {
    notNull: true,
    default: "CURRENT_TIMESTAMP",
    comment: "Record creation timestamp",
  });
}

function updatedAt(id) {
  return makeField(id, "updated_at", "TIMESTAMP", {
    notNull: true,
    default: "CURRENT_TIMESTAMP",
    comment: "Record last update timestamp",
  });
}

function orgIdField(id) {
  return makeField(id, "org_id", "UUID", {
    notNull: true,
    comment: "Tenant isolation key",
  });
}

// --- SaaS Multi-Tenant Template ---

function buildSaasMultiTenant() {
  const tables = [
    {
      id: 0,
      name: "organizations",
      x: 100,
      y: 100,
      comment: "Tenant organizations for multi-tenant isolation",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "name", "VARCHAR", { size: "255", notNull: true, comment: "Organization name" }),
        makeField(2, "slug", "VARCHAR", { size: "100", notNull: true, unique: true, comment: "URL-safe unique identifier" }),
        makeField(3, "plan", "VARCHAR", { size: "50", notNull: true, default: "free", comment: "Subscription plan tier" }),
        makeField(4, "settings", "TEXT", { comment: "JSON organization settings" }),
        makeField(5, "is_active", "BOOLEAN", { notNull: true, default: "true", comment: "Whether the org is active" }),
        createdAt(6),
        updatedAt(7),
      ],
      indices: [
        { name: "idx_organizations_slug", unique: true, fields: ["slug"] },
      ],
    },
    {
      id: 1,
      name: "users",
      x: 400,
      y: 100,
      comment: "Application users with authentication details",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "email", "VARCHAR", { size: "255", notNull: true, unique: true, comment: "User email address" }),
        makeField(2, "password_hash", "VARCHAR", { size: "255", notNull: true, comment: "Bcrypt password hash" }),
        makeField(3, "display_name", "VARCHAR", { size: "150", notNull: true, comment: "User display name" }),
        makeField(4, "avatar_url", "VARCHAR", { size: "500", comment: "Profile avatar URL" }),
        makeField(5, "email_verified_at", "TIMESTAMP", { comment: "Email verification timestamp" }),
        makeField(6, "last_login_at", "TIMESTAMP", { comment: "Last successful login" }),
        makeField(7, "is_active", "BOOLEAN", { notNull: true, default: "true", comment: "Account active flag" }),
        createdAt(8),
        updatedAt(9),
      ],
      indices: [
        { name: "idx_users_email", unique: true, fields: ["email"] },
      ],
    },
    {
      id: 2,
      name: "memberships",
      x: 250,
      y: 350,
      comment: "Maps users to organizations with role-based access",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        orgIdField(1),
        makeField(2, "user_id", "UUID", { notNull: true, comment: "FK to users" }),
        makeField(3, "role", "VARCHAR", { size: "50", notNull: true, default: "member", comment: "Role within org (owner, admin, member)" }),
        makeField(4, "invited_by", "UUID", { comment: "User who sent the invitation" }),
        makeField(5, "joined_at", "TIMESTAMP", { notNull: true, default: "CURRENT_TIMESTAMP", comment: "When user joined the org" }),
        createdAt(6),
        updatedAt(7),
      ],
      indices: [
        { name: "idx_memberships_org_id", unique: false, fields: ["org_id"] },
        { name: "idx_memberships_user_id", unique: false, fields: ["user_id"] },
        { name: "idx_memberships_org_user", unique: true, fields: ["org_id", "user_id"] },
      ],
    },
    {
      id: 3,
      name: "api_keys",
      x: 550,
      y: 350,
      comment: "API keys for programmatic access scoped to organizations",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        orgIdField(1),
        makeField(2, "created_by", "UUID", { notNull: true, comment: "User who created the key" }),
        makeField(3, "name", "VARCHAR", { size: "100", notNull: true, comment: "Human-readable key name" }),
        makeField(4, "key_hash", "VARCHAR", { size: "255", notNull: true, unique: true, comment: "SHA-256 hash of the API key" }),
        makeField(5, "key_prefix", "VARCHAR", { size: "10", notNull: true, comment: "First chars for identification" }),
        makeField(6, "scopes", "TEXT", { comment: "JSON array of permission scopes" }),
        makeField(7, "expires_at", "TIMESTAMP", { comment: "Key expiration timestamp" }),
        makeField(8, "last_used_at", "TIMESTAMP", { comment: "Last usage timestamp" }),
        makeField(9, "is_revoked", "BOOLEAN", { notNull: true, default: "false", comment: "Whether key is revoked" }),
        createdAt(10),
        updatedAt(11),
      ],
      indices: [
        { name: "idx_api_keys_org_id", unique: false, fields: ["org_id"] },
        { name: "idx_api_keys_key_hash", unique: true, fields: ["key_hash"] },
        { name: "idx_api_keys_key_prefix", unique: false, fields: ["key_prefix"] },
      ],
    },
    {
      id: 4,
      name: "audit_log",
      x: 350,
      y: 600,
      comment: "Immutable audit trail for all tenant actions",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        orgIdField(1),
        makeField(2, "actor_id", "UUID", { comment: "User who performed the action" }),
        makeField(3, "action", "VARCHAR", { size: "100", notNull: true, comment: "Action performed (e.g. user.created)" }),
        makeField(4, "resource_type", "VARCHAR", { size: "100", notNull: true, comment: "Type of resource affected" }),
        makeField(5, "resource_id", "UUID", { comment: "ID of the affected resource" }),
        makeField(6, "metadata", "TEXT", { comment: "JSON payload with action details" }),
        makeField(7, "ip_address", "VARCHAR", { size: "45", comment: "Client IP address" }),
        makeField(8, "user_agent", "VARCHAR", { size: "500", comment: "Client user agent string" }),
        createdAt(9),
      ],
      indices: [
        { name: "idx_audit_log_org_id", unique: false, fields: ["org_id"] },
        { name: "idx_audit_log_actor_id", unique: false, fields: ["actor_id"] },
        { name: "idx_audit_log_action", unique: false, fields: ["action"] },
        { name: "idx_audit_log_resource", unique: false, fields: ["resource_type", "resource_id"] },
        { name: "idx_audit_log_created_at", unique: false, fields: ["created_at"] },
      ],
    },
  ];

  const relationships = [
    {
      id: 0,
      name: "fk_memberships_org_id",
      startTableId: 2,
      startFieldId: 1,
      endTableId: 0,
      endFieldId: 0,
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    },
    {
      id: 1,
      name: "fk_memberships_user_id",
      startTableId: 2,
      startFieldId: 2,
      endTableId: 1,
      endFieldId: 0,
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    },
    {
      id: 2,
      name: "fk_api_keys_org_id",
      startTableId: 3,
      startFieldId: 1,
      endTableId: 0,
      endFieldId: 0,
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    },
    {
      id: 3,
      name: "fk_api_keys_created_by",
      startTableId: 3,
      startFieldId: 2,
      endTableId: 1,
      endFieldId: 0,
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    },
    {
      id: 4,
      name: "fk_audit_log_org_id",
      startTableId: 4,
      startFieldId: 1,
      endTableId: 0,
      endFieldId: 0,
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "Cascade",
    },
    {
      id: 5,
      name: "fk_audit_log_actor_id",
      startTableId: 4,
      startFieldId: 2,
      endTableId: 1,
      endFieldId: 0,
      cardinality: "many_to_one",
      updateConstraint: "No action",
      deleteConstraint: "Set null",
    },
  ];

  return { tables, relationships };
}


// --- E-commerce Template ---

function buildEcommerce() {
  const tables = [
    {
      id: 0,
      name: "customers",
      x: 100,
      y: 100,
      comment: "Registered customers with profile information",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "email", "VARCHAR", { size: "255", notNull: true, unique: true, comment: "Customer email" }),
        makeField(2, "first_name", "VARCHAR", { size: "100", notNull: true, comment: "First name" }),
        makeField(3, "last_name", "VARCHAR", { size: "100", notNull: true, comment: "Last name" }),
        makeField(4, "phone", "VARCHAR", { size: "20", comment: "Phone number" }),
        makeField(5, "password_hash", "VARCHAR", { size: "255", notNull: true, comment: "Hashed password" }),
        makeField(6, "is_active", "BOOLEAN", { notNull: true, default: "true", comment: "Account active status" }),
        createdAt(7),
        updatedAt(8),
      ],
      indices: [
        { name: "idx_customers_email", unique: true, fields: ["email"] },
      ],
    },
    {
      id: 1,
      name: "categories",
      x: 400,
      y: 100,
      comment: "Product categories with hierarchical support",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "name", "VARCHAR", { size: "150", notNull: true, comment: "Category name" }),
        makeField(2, "slug", "VARCHAR", { size: "150", notNull: true, unique: true, comment: "URL slug" }),
        makeField(3, "parent_id", "UUID", { comment: "Parent category for hierarchy" }),
        makeField(4, "description", "TEXT", { comment: "Category description" }),
        makeField(5, "sort_order", "INT", { notNull: true, default: "0", comment: "Display order" }),
        createdAt(6),
        updatedAt(7),
      ],
      indices: [
        { name: "idx_categories_slug", unique: true, fields: ["slug"] },
        { name: "idx_categories_parent_id", unique: false, fields: ["parent_id"] },
      ],
    },
    {
      id: 2,
      name: "products",
      x: 700,
      y: 100,
      comment: "Product catalog with pricing and metadata",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "category_id", "UUID", { notNull: true, comment: "FK to categories" }),
        makeField(2, "name", "VARCHAR", { size: "255", notNull: true, comment: "Product name" }),
        makeField(3, "slug", "VARCHAR", { size: "255", notNull: true, unique: true, comment: "URL slug" }),
        makeField(4, "description", "TEXT", { comment: "Product description" }),
        makeField(5, "price", "DECIMAL", { size: "12,2", notNull: true, comment: "Current price" }),
        makeField(6, "compare_at_price", "DECIMAL", { size: "12,2", comment: "Original price for sale display" }),
        makeField(7, "sku", "VARCHAR", { size: "100", unique: true, comment: "Stock keeping unit" }),
        makeField(8, "is_active", "BOOLEAN", { notNull: true, default: "true", comment: "Whether product is listed" }),
        makeField(9, "weight", "DECIMAL", { size: "8,2", comment: "Weight in kg for shipping" }),
        createdAt(10),
        updatedAt(11),
      ],
      indices: [
        { name: "idx_products_category_id", unique: false, fields: ["category_id"] },
        { name: "idx_products_slug", unique: true, fields: ["slug"] },
        { name: "idx_products_sku", unique: true, fields: ["sku"] },
        { name: "idx_products_is_active", unique: false, fields: ["is_active"] },
      ],
    },
    {
      id: 3,
      name: "inventory",
      x: 1000,
      y: 100,
      comment: "Stock levels per product with reservation tracking",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "product_id", "UUID", { notNull: true, unique: true, comment: "FK to products" }),
        makeField(2, "quantity", "INT", { notNull: true, default: "0", comment: "Available stock quantity" }),
        makeField(3, "reserved", "INT", { notNull: true, default: "0", comment: "Reserved by pending orders" }),
        makeField(4, "reorder_level", "INT", { notNull: true, default: "10", comment: "Threshold for reorder alert" }),
        makeField(5, "warehouse_location", "VARCHAR", { size: "100", comment: "Physical warehouse location" }),
        createdAt(6),
        updatedAt(7),
      ],
      indices: [
        { name: "idx_inventory_product_id", unique: true, fields: ["product_id"] },
      ],
    },
    {
      id: 4,
      name: "addresses",
      x: 100,
      y: 400,
      comment: "Customer shipping and billing addresses",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "customer_id", "UUID", { notNull: true, comment: "FK to customers" }),
        makeField(2, "label", "VARCHAR", { size: "50", default: "home", comment: "Address label (home, work)" }),
        makeField(3, "line1", "VARCHAR", { size: "255", notNull: true, comment: "Street address line 1" }),
        makeField(4, "line2", "VARCHAR", { size: "255", comment: "Street address line 2" }),
        makeField(5, "city", "VARCHAR", { size: "100", notNull: true, comment: "City" }),
        makeField(6, "state", "VARCHAR", { size: "100", comment: "State or province" }),
        makeField(7, "postal_code", "VARCHAR", { size: "20", notNull: true, comment: "Postal/ZIP code" }),
        makeField(8, "country", "VARCHAR", { size: "2", notNull: true, comment: "ISO 3166-1 alpha-2 country code" }),
        makeField(9, "is_default", "BOOLEAN", { notNull: true, default: "false", comment: "Default address flag" }),
        createdAt(10),
        updatedAt(11),
      ],
      indices: [
        { name: "idx_addresses_customer_id", unique: false, fields: ["customer_id"] },
      ],
    },
    {
      id: 5,
      name: "orders",
      x: 400,
      y: 400,
      comment: "Customer orders with status tracking",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "customer_id", "UUID", { notNull: true, comment: "FK to customers" }),
        makeField(2, "shipping_address_id", "UUID", { notNull: true, comment: "FK to addresses" }),
        makeField(3, "order_number", "VARCHAR", { size: "50", notNull: true, unique: true, comment: "Human-readable order number" }),
        makeField(4, "status", "VARCHAR", { size: "30", notNull: true, default: "pending", comment: "Order status (pending, confirmed, shipped, delivered, cancelled)" }),
        makeField(5, "subtotal", "DECIMAL", { size: "12,2", notNull: true, comment: "Sum of line items before tax/shipping" }),
        makeField(6, "tax_amount", "DECIMAL", { size: "12,2", notNull: true, default: "0", comment: "Tax amount" }),
        makeField(7, "shipping_amount", "DECIMAL", { size: "12,2", notNull: true, default: "0", comment: "Shipping cost" }),
        makeField(8, "total", "DECIMAL", { size: "12,2", notNull: true, comment: "Final total charged" }),
        makeField(9, "currency", "VARCHAR", { size: "3", notNull: true, default: "USD", comment: "ISO 4217 currency code" }),
        makeField(10, "notes", "TEXT", { comment: "Customer order notes" }),
        createdAt(11),
        updatedAt(12),
      ],
      indices: [
        { name: "idx_orders_customer_id", unique: false, fields: ["customer_id"] },
        { name: "idx_orders_order_number", unique: true, fields: ["order_number"] },
        { name: "idx_orders_status", unique: false, fields: ["status"] },
        { name: "idx_orders_created_at", unique: false, fields: ["created_at"] },
      ],
    },
    {
      id: 6,
      name: "order_items",
      x: 700,
      y: 400,
      comment: "Individual line items within an order",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "order_id", "UUID", { notNull: true, comment: "FK to orders" }),
        makeField(2, "product_id", "UUID", { notNull: true, comment: "FK to products" }),
        makeField(3, "quantity", "INT", { notNull: true, default: "1", comment: "Quantity ordered" }),
        makeField(4, "unit_price", "DECIMAL", { size: "12,2", notNull: true, comment: "Price per unit at time of order" }),
        makeField(5, "total_price", "DECIMAL", { size: "12,2", notNull: true, comment: "quantity * unit_price" }),
        createdAt(6),
        updatedAt(7),
      ],
      indices: [
        { name: "idx_order_items_order_id", unique: false, fields: ["order_id"] },
        { name: "idx_order_items_product_id", unique: false, fields: ["product_id"] },
      ],
    },
    {
      id: 7,
      name: "payments",
      x: 400,
      y: 700,
      comment: "Payment transactions linked to orders",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "order_id", "UUID", { notNull: true, comment: "FK to orders" }),
        makeField(2, "amount", "DECIMAL", { size: "12,2", notNull: true, comment: "Payment amount" }),
        makeField(3, "currency", "VARCHAR", { size: "3", notNull: true, default: "USD", comment: "ISO 4217 currency code" }),
        makeField(4, "method", "VARCHAR", { size: "30", notNull: true, comment: "Payment method (card, paypal, bank_transfer)" }),
        makeField(5, "status", "VARCHAR", { size: "30", notNull: true, default: "pending", comment: "Payment status (pending, completed, failed, refunded)" }),
        makeField(6, "provider_ref", "VARCHAR", { size: "255", comment: "External payment provider reference" }),
        makeField(7, "paid_at", "TIMESTAMP", { comment: "When payment was confirmed" }),
        createdAt(8),
        updatedAt(9),
      ],
      indices: [
        { name: "idx_payments_order_id", unique: false, fields: ["order_id"] },
        { name: "idx_payments_status", unique: false, fields: ["status"] },
        { name: "idx_payments_provider_ref", unique: false, fields: ["provider_ref"] },
      ],
    },
    {
      id: 8,
      name: "reviews",
      x: 1000,
      y: 400,
      comment: "Product reviews and ratings from customers",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "product_id", "UUID", { notNull: true, comment: "FK to products" }),
        makeField(2, "customer_id", "UUID", { notNull: true, comment: "FK to customers" }),
        makeField(3, "rating", "INT", { notNull: true, check: "rating >= 1 AND rating <= 5", comment: "Rating 1-5" }),
        makeField(4, "title", "VARCHAR", { size: "200", comment: "Review title" }),
        makeField(5, "body", "TEXT", { comment: "Review body text" }),
        makeField(6, "is_verified", "BOOLEAN", { notNull: true, default: "false", comment: "Verified purchase review" }),
        createdAt(7),
        updatedAt(8),
      ],
      indices: [
        { name: "idx_reviews_product_id", unique: false, fields: ["product_id"] },
        { name: "idx_reviews_customer_id", unique: false, fields: ["customer_id"] },
        { name: "idx_reviews_rating", unique: false, fields: ["rating"] },
      ],
    },
  ];

  const relationships = [
    { id: 0, name: "fk_products_category_id", startTableId: 2, startFieldId: 1, endTableId: 1, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Restrict" },
    { id: 1, name: "fk_inventory_product_id", startTableId: 3, startFieldId: 1, endTableId: 2, endFieldId: 0, cardinality: "one_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 2, name: "fk_addresses_customer_id", startTableId: 4, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 3, name: "fk_orders_customer_id", startTableId: 5, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Restrict" },
    { id: 4, name: "fk_orders_shipping_address_id", startTableId: 5, startFieldId: 2, endTableId: 4, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Restrict" },
    { id: 5, name: "fk_order_items_order_id", startTableId: 6, startFieldId: 1, endTableId: 5, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 6, name: "fk_order_items_product_id", startTableId: 6, startFieldId: 2, endTableId: 2, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Restrict" },
    { id: 7, name: "fk_payments_order_id", startTableId: 7, startFieldId: 1, endTableId: 5, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Restrict" },
    { id: 8, name: "fk_reviews_product_id", startTableId: 8, startFieldId: 1, endTableId: 2, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 9, name: "fk_reviews_customer_id", startTableId: 8, startFieldId: 2, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
  ];

  return { tables, relationships };
}


// --- Fintech Ledger Template ---

function buildFintechLedger() {
  const tables = [
    {
      id: 0,
      name: "accounts",
      x: 100,
      y: 100,
      comment: "Financial accounts (assets, liabilities, equity, revenue, expense)",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "account_number", "VARCHAR", { size: "50", notNull: true, unique: true, comment: "Unique account number" }),
        makeField(2, "name", "VARCHAR", { size: "200", notNull: true, comment: "Account name" }),
        makeField(3, "account_type", "VARCHAR", { size: "30", notNull: true, comment: "Type: asset, liability, equity, revenue, expense" }),
        makeField(4, "currency", "VARCHAR", { size: "3", notNull: true, default: "USD", comment: "ISO 4217 currency code" }),
        makeField(5, "is_active", "BOOLEAN", { notNull: true, default: "true", comment: "Whether account is active" }),
        makeField(6, "parent_account_id", "UUID", { comment: "Parent account for chart of accounts hierarchy" }),
        makeField(7, "metadata", "TEXT", { comment: "JSON additional account metadata" }),
        createdAt(8),
        updatedAt(9),
      ],
      indices: [
        { name: "idx_accounts_account_number", unique: true, fields: ["account_number"] },
        { name: "idx_accounts_account_type", unique: false, fields: ["account_type"] },
        { name: "idx_accounts_parent_account_id", unique: false, fields: ["parent_account_id"] },
      ],
    },
    {
      id: 1,
      name: "transactions",
      x: 400,
      y: 100,
      comment: "Financial transactions grouping related ledger entries",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "reference", "VARCHAR", { size: "100", notNull: true, unique: true, comment: "Unique transaction reference" }),
        makeField(2, "description", "VARCHAR", { size: "500", notNull: true, comment: "Transaction description" }),
        makeField(3, "transaction_date", "TIMESTAMP", { notNull: true, comment: "When the transaction occurred" }),
        makeField(4, "posted_date", "TIMESTAMP", { comment: "When the transaction was posted to ledger" }),
        makeField(5, "status", "VARCHAR", { size: "20", notNull: true, default: "pending", comment: "Status: pending, posted, reversed, failed" }),
        makeField(6, "idempotency_key", "VARCHAR", { size: "100", unique: true, comment: "Idempotency key for deduplication" }),
        makeField(7, "source_system", "VARCHAR", { size: "50", comment: "Originating system identifier" }),
        makeField(8, "metadata", "TEXT", { comment: "JSON additional transaction data" }),
        createdAt(9),
        updatedAt(10),
      ],
      indices: [
        { name: "idx_transactions_reference", unique: true, fields: ["reference"] },
        { name: "idx_transactions_idempotency_key", unique: true, fields: ["idempotency_key"] },
        { name: "idx_transactions_status", unique: false, fields: ["status"] },
        { name: "idx_transactions_transaction_date", unique: false, fields: ["transaction_date"] },
        { name: "idx_transactions_posted_date", unique: false, fields: ["posted_date"] },
      ],
    },
    {
      id: 2,
      name: "ledger_entries",
      x: 700,
      y: 100,
      comment: "Append-only double-entry ledger entries (immutable)",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "transaction_id", "UUID", { notNull: true, comment: "FK to transactions" }),
        makeField(2, "account_id", "UUID", { notNull: true, comment: "FK to accounts" }),
        makeField(3, "entry_type", "VARCHAR", { size: "6", notNull: true, comment: "DEBIT or CREDIT" }),
        makeField(4, "amount", "DECIMAL", { size: "18,4", notNull: true, comment: "Entry amount (always positive)" }),
        makeField(5, "currency", "VARCHAR", { size: "3", notNull: true, comment: "ISO 4217 currency code" }),
        makeField(6, "running_balance", "DECIMAL", { size: "18,4", comment: "Running balance after this entry" }),
        makeField(7, "sequence_number", "BIGINT", { notNull: true, comment: "Monotonic sequence for ordering" }),
        makeField(8, "description", "VARCHAR", { size: "500", comment: "Line-level description" }),
        createdAt(9),
      ],
      indices: [
        { name: "idx_ledger_entries_transaction_id", unique: false, fields: ["transaction_id"] },
        { name: "idx_ledger_entries_account_id", unique: false, fields: ["account_id"] },
        { name: "idx_ledger_entries_account_created", unique: false, fields: ["account_id", "created_at"] },
        { name: "idx_ledger_entries_sequence", unique: true, fields: ["sequence_number"] },
      ],
    },
    {
      id: 3,
      name: "balances",
      x: 400,
      y: 400,
      comment: "Materialized account balances for fast reads (derived from ledger_entries)",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "account_id", "UUID", { notNull: true, unique: true, comment: "FK to accounts" }),
        makeField(2, "available_balance", "DECIMAL", { size: "18,4", notNull: true, default: "0", comment: "Current available balance" }),
        makeField(3, "pending_balance", "DECIMAL", { size: "18,4", notNull: true, default: "0", comment: "Balance including pending transactions" }),
        makeField(4, "last_entry_id", "UUID", { comment: "Last ledger entry used to compute balance" }),
        makeField(5, "last_reconciled_at", "TIMESTAMP", { comment: "Last reconciliation timestamp" }),
        makeField(6, "version", "INT", { notNull: true, default: "0", comment: "Optimistic locking version" }),
        createdAt(7),
        updatedAt(8),
      ],
      indices: [
        { name: "idx_balances_account_id", unique: true, fields: ["account_id"] },
      ],
    },
    {
      id: 4,
      name: "reconciliation_log",
      x: 700,
      y: 400,
      comment: "Reconciliation audit trail comparing computed vs materialized balances",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "account_id", "UUID", { notNull: true, comment: "FK to accounts" }),
        makeField(2, "expected_balance", "DECIMAL", { size: "18,4", notNull: true, comment: "Balance computed from ledger entries" }),
        makeField(3, "actual_balance", "DECIMAL", { size: "18,4", notNull: true, comment: "Balance from materialized balances table" }),
        makeField(4, "discrepancy", "DECIMAL", { size: "18,4", notNull: true, default: "0", comment: "Difference (expected - actual)" }),
        makeField(5, "status", "VARCHAR", { size: "20", notNull: true, comment: "matched, discrepancy, resolved" }),
        makeField(6, "resolved_at", "TIMESTAMP", { comment: "When discrepancy was resolved" }),
        makeField(7, "resolved_by", "UUID", { comment: "User who resolved the discrepancy" }),
        makeField(8, "notes", "TEXT", { comment: "Resolution notes" }),
        createdAt(9),
      ],
      indices: [
        { name: "idx_reconciliation_log_account_id", unique: false, fields: ["account_id"] },
        { name: "idx_reconciliation_log_status", unique: false, fields: ["status"] },
        { name: "idx_reconciliation_log_created_at", unique: false, fields: ["created_at"] },
      ],
    },
  ];

  const relationships = [
    { id: 0, name: "fk_ledger_entries_transaction_id", startTableId: 2, startFieldId: 1, endTableId: 1, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Restrict" },
    { id: 1, name: "fk_ledger_entries_account_id", startTableId: 2, startFieldId: 2, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Restrict" },
    { id: 2, name: "fk_balances_account_id", startTableId: 3, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "one_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 3, name: "fk_reconciliation_log_account_id", startTableId: 4, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
  ];

  return { tables, relationships };
}


// --- Social Platform Template ---

function buildSocialPlatform() {
  const tables = [
    {
      id: 0,
      name: "users",
      x: 100,
      y: 100,
      comment: "Platform users with profile information",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "username", "VARCHAR", { size: "50", notNull: true, unique: true, comment: "Unique username handle" }),
        makeField(2, "email", "VARCHAR", { size: "255", notNull: true, unique: true, comment: "User email" }),
        makeField(3, "password_hash", "VARCHAR", { size: "255", notNull: true, comment: "Hashed password" }),
        makeField(4, "display_name", "VARCHAR", { size: "150", notNull: true, comment: "Display name" }),
        makeField(5, "bio", "TEXT", { comment: "User biography" }),
        makeField(6, "avatar_url", "VARCHAR", { size: "500", comment: "Profile picture URL" }),
        makeField(7, "is_verified", "BOOLEAN", { notNull: true, default: "false", comment: "Verified account badge" }),
        makeField(8, "is_active", "BOOLEAN", { notNull: true, default: "true", comment: "Account active status" }),
        createdAt(9),
        updatedAt(10),
      ],
      indices: [
        { name: "idx_users_username", unique: true, fields: ["username"] },
        { name: "idx_users_email", unique: true, fields: ["email"] },
      ],
    },
    {
      id: 1,
      name: "posts",
      x: 400,
      y: 100,
      comment: "User-generated content posts",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "author_id", "UUID", { notNull: true, comment: "FK to users" }),
        makeField(2, "content", "TEXT", { notNull: true, comment: "Post text content" }),
        makeField(3, "visibility", "VARCHAR", { size: "20", notNull: true, default: "public", comment: "Visibility: public, followers, private" }),
        makeField(4, "like_count", "INT", { notNull: true, default: "0", comment: "Denormalized like count" }),
        makeField(5, "comment_count", "INT", { notNull: true, default: "0", comment: "Denormalized comment count" }),
        makeField(6, "share_count", "INT", { notNull: true, default: "0", comment: "Denormalized share count" }),
        makeField(7, "is_pinned", "BOOLEAN", { notNull: true, default: "false", comment: "Pinned to profile" }),
        makeField(8, "deleted_at", "TIMESTAMP", { comment: "Soft delete timestamp" }),
        createdAt(9),
        updatedAt(10),
      ],
      indices: [
        { name: "idx_posts_author_id", unique: false, fields: ["author_id"] },
        { name: "idx_posts_created_at", unique: false, fields: ["created_at"] },
        { name: "idx_posts_visibility", unique: false, fields: ["visibility"] },
      ],
    },
    {
      id: 2,
      name: "comments",
      x: 700,
      y: 100,
      comment: "Comments on posts with threading support",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "post_id", "UUID", { notNull: true, comment: "FK to posts" }),
        makeField(2, "author_id", "UUID", { notNull: true, comment: "FK to users" }),
        makeField(3, "parent_comment_id", "UUID", { comment: "FK to comments for threading" }),
        makeField(4, "content", "TEXT", { notNull: true, comment: "Comment text" }),
        makeField(5, "like_count", "INT", { notNull: true, default: "0", comment: "Denormalized like count" }),
        makeField(6, "deleted_at", "TIMESTAMP", { comment: "Soft delete timestamp" }),
        createdAt(7),
        updatedAt(8),
      ],
      indices: [
        { name: "idx_comments_post_id", unique: false, fields: ["post_id"] },
        { name: "idx_comments_author_id", unique: false, fields: ["author_id"] },
        { name: "idx_comments_parent_comment_id", unique: false, fields: ["parent_comment_id"] },
      ],
    },
    {
      id: 3,
      name: "likes",
      x: 400,
      y: 400,
      comment: "Like interactions on posts and comments",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "user_id", "UUID", { notNull: true, comment: "FK to users" }),
        makeField(2, "target_type", "VARCHAR", { size: "20", notNull: true, comment: "Type: post or comment" }),
        makeField(3, "target_id", "UUID", { notNull: true, comment: "ID of the liked post or comment" }),
        createdAt(4),
      ],
      indices: [
        { name: "idx_likes_user_id", unique: false, fields: ["user_id"] },
        { name: "idx_likes_target", unique: false, fields: ["target_type", "target_id"] },
        { name: "idx_likes_user_target", unique: true, fields: ["user_id", "target_type", "target_id"] },
      ],
    },
    {
      id: 4,
      name: "follows",
      x: 100,
      y: 400,
      comment: "User follow relationships",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "follower_id", "UUID", { notNull: true, comment: "FK to users (the follower)" }),
        makeField(2, "following_id", "UUID", { notNull: true, comment: "FK to users (being followed)" }),
        makeField(3, "status", "VARCHAR", { size: "20", notNull: true, default: "active", comment: "Status: active, blocked, muted" }),
        createdAt(4),
      ],
      indices: [
        { name: "idx_follows_follower_id", unique: false, fields: ["follower_id"] },
        { name: "idx_follows_following_id", unique: false, fields: ["following_id"] },
        { name: "idx_follows_pair", unique: true, fields: ["follower_id", "following_id"] },
      ],
    },
    {
      id: 5,
      name: "notifications",
      x: 700,
      y: 400,
      comment: "User notifications for social interactions",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "recipient_id", "UUID", { notNull: true, comment: "FK to users (notification target)" }),
        makeField(2, "actor_id", "UUID", { comment: "FK to users (who triggered it)" }),
        makeField(3, "notification_type", "VARCHAR", { size: "50", notNull: true, comment: "Type: like, comment, follow, mention" }),
        makeField(4, "target_type", "VARCHAR", { size: "20", comment: "Resource type (post, comment)" }),
        makeField(5, "target_id", "UUID", { comment: "Resource ID" }),
        makeField(6, "message", "VARCHAR", { size: "500", comment: "Notification message text" }),
        makeField(7, "is_read", "BOOLEAN", { notNull: true, default: "false", comment: "Read status" }),
        makeField(8, "read_at", "TIMESTAMP", { comment: "When notification was read" }),
        createdAt(9),
      ],
      indices: [
        { name: "idx_notifications_recipient_id", unique: false, fields: ["recipient_id"] },
        { name: "idx_notifications_recipient_read", unique: false, fields: ["recipient_id", "is_read"] },
        { name: "idx_notifications_created_at", unique: false, fields: ["created_at"] },
      ],
    },
    {
      id: 6,
      name: "media",
      x: 400,
      y: 700,
      comment: "Media attachments (images, videos) for posts",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "post_id", "UUID", { notNull: true, comment: "FK to posts" }),
        makeField(2, "uploader_id", "UUID", { notNull: true, comment: "FK to users" }),
        makeField(3, "media_type", "VARCHAR", { size: "20", notNull: true, comment: "Type: image, video, gif" }),
        makeField(4, "url", "VARCHAR", { size: "500", notNull: true, comment: "Storage URL" }),
        makeField(5, "thumbnail_url", "VARCHAR", { size: "500", comment: "Thumbnail URL" }),
        makeField(6, "width", "INT", { comment: "Media width in pixels" }),
        makeField(7, "height", "INT", { comment: "Media height in pixels" }),
        makeField(8, "file_size", "BIGINT", { comment: "File size in bytes" }),
        makeField(9, "alt_text", "VARCHAR", { size: "500", comment: "Accessibility alt text" }),
        createdAt(10),
      ],
      indices: [
        { name: "idx_media_post_id", unique: false, fields: ["post_id"] },
        { name: "idx_media_uploader_id", unique: false, fields: ["uploader_id"] },
      ],
    },
  ];

  const relationships = [
    { id: 0, name: "fk_posts_author_id", startTableId: 1, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 1, name: "fk_comments_post_id", startTableId: 2, startFieldId: 1, endTableId: 1, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 2, name: "fk_comments_author_id", startTableId: 2, startFieldId: 2, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 3, name: "fk_likes_user_id", startTableId: 3, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 4, name: "fk_follows_follower_id", startTableId: 4, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 5, name: "fk_follows_following_id", startTableId: 4, startFieldId: 2, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 6, name: "fk_notifications_recipient_id", startTableId: 5, startFieldId: 1, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 7, name: "fk_notifications_actor_id", startTableId: 5, startFieldId: 2, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Set null" },
    { id: 8, name: "fk_media_post_id", startTableId: 6, startFieldId: 1, endTableId: 1, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 9, name: "fk_media_uploader_id", startTableId: 6, startFieldId: 2, endTableId: 0, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
  ];

  return { tables, relationships };
}


// --- Analytics Pipeline Template ---

function buildAnalyticsPipeline() {
  const tables = [
    {
      id: 0,
      name: "events",
      x: 100,
      y: 100,
      comment: "Raw event stream partitioned by time for analytics ingestion",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "event_name", "VARCHAR", { size: "100", notNull: true, comment: "Event type identifier" }),
        makeField(2, "session_id", "UUID", { notNull: true, comment: "FK to sessions" }),
        makeField(3, "user_id", "UUID", { comment: "FK to anonymous or identified user" }),
        makeField(4, "properties", "TEXT", { comment: "JSON event properties payload" }),
        makeField(5, "page_url", "VARCHAR", { size: "2000", comment: "Page URL where event occurred" }),
        makeField(6, "referrer", "VARCHAR", { size: "2000", comment: "Referrer URL" }),
        makeField(7, "user_agent", "VARCHAR", { size: "500", comment: "Browser user agent" }),
        makeField(8, "ip_address", "VARCHAR", { size: "45", comment: "Client IP address" }),
        makeField(9, "country", "VARCHAR", { size: "2", comment: "ISO country code from IP" }),
        makeField(10, "device_type", "VARCHAR", { size: "20", comment: "Device type: desktop, mobile, tablet" }),
        makeField(11, "event_timestamp", "TIMESTAMP", { notNull: true, comment: "When the event occurred (client time)" }),
        makeField(12, "received_at", "TIMESTAMP", { notNull: true, default: "CURRENT_TIMESTAMP", comment: "Server receive timestamp" }),
        createdAt(13),
      ],
      indices: [
        { name: "idx_events_event_name", unique: false, fields: ["event_name"] },
        { name: "idx_events_session_id", unique: false, fields: ["session_id"] },
        { name: "idx_events_user_id", unique: false, fields: ["user_id"] },
        { name: "idx_events_event_timestamp", unique: false, fields: ["event_timestamp"] },
        { name: "idx_events_received_at", unique: false, fields: ["received_at"] },
      ],
    },
    {
      id: 1,
      name: "sessions",
      x: 400,
      y: 100,
      comment: "User sessions grouping events by visit",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "user_id", "UUID", { comment: "Identified user (null for anonymous)" }),
        makeField(2, "anonymous_id", "VARCHAR", { size: "100", notNull: true, comment: "Anonymous tracking identifier" }),
        makeField(3, "started_at", "TIMESTAMP", { notNull: true, comment: "Session start time" }),
        makeField(4, "ended_at", "TIMESTAMP", { comment: "Session end time" }),
        makeField(5, "duration_seconds", "INT", { comment: "Total session duration" }),
        makeField(6, "page_views", "INT", { notNull: true, default: "0", comment: "Number of page views in session" }),
        makeField(7, "events_count", "INT", { notNull: true, default: "0", comment: "Total events in session" }),
        makeField(8, "entry_page", "VARCHAR", { size: "2000", comment: "First page visited" }),
        makeField(9, "exit_page", "VARCHAR", { size: "2000", comment: "Last page visited" }),
        makeField(10, "utm_source", "VARCHAR", { size: "200", comment: "UTM source parameter" }),
        makeField(11, "utm_medium", "VARCHAR", { size: "200", comment: "UTM medium parameter" }),
        makeField(12, "utm_campaign", "VARCHAR", { size: "200", comment: "UTM campaign parameter" }),
        makeField(13, "country", "VARCHAR", { size: "2", comment: "ISO country code" }),
        makeField(14, "device_type", "VARCHAR", { size: "20", comment: "Device type" }),
        makeField(15, "browser", "VARCHAR", { size: "50", comment: "Browser name" }),
        createdAt(16),
        updatedAt(17),
      ],
      indices: [
        { name: "idx_sessions_user_id", unique: false, fields: ["user_id"] },
        { name: "idx_sessions_anonymous_id", unique: false, fields: ["anonymous_id"] },
        { name: "idx_sessions_started_at", unique: false, fields: ["started_at"] },
        { name: "idx_sessions_utm_source", unique: false, fields: ["utm_source"] },
      ],
    },
    {
      id: 2,
      name: "page_views",
      x: 700,
      y: 100,
      comment: "Individual page view events with timing metrics",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "session_id", "UUID", { notNull: true, comment: "FK to sessions" }),
        makeField(2, "user_id", "UUID", { comment: "FK to identified user" }),
        makeField(3, "page_url", "VARCHAR", { size: "2000", notNull: true, comment: "Full page URL" }),
        makeField(4, "page_title", "VARCHAR", { size: "500", comment: "HTML page title" }),
        makeField(5, "referrer", "VARCHAR", { size: "2000", comment: "Previous page URL" }),
        makeField(6, "time_on_page_seconds", "INT", { comment: "Time spent on page" }),
        makeField(7, "scroll_depth_percent", "INT", { comment: "Max scroll depth percentage" }),
        makeField(8, "viewed_at", "TIMESTAMP", { notNull: true, comment: "When page was viewed" }),
        createdAt(9),
      ],
      indices: [
        { name: "idx_page_views_session_id", unique: false, fields: ["session_id"] },
        { name: "idx_page_views_user_id", unique: false, fields: ["user_id"] },
        { name: "idx_page_views_page_url", unique: false, fields: ["page_url"] },
        { name: "idx_page_views_viewed_at", unique: false, fields: ["viewed_at"] },
      ],
    },
    {
      id: 3,
      name: "conversions",
      x: 400,
      y: 400,
      comment: "Conversion events tracking goal completions",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "session_id", "UUID", { notNull: true, comment: "FK to sessions" }),
        makeField(2, "user_id", "UUID", { comment: "FK to identified user" }),
        makeField(3, "goal_name", "VARCHAR", { size: "100", notNull: true, comment: "Conversion goal identifier" }),
        makeField(4, "revenue", "DECIMAL", { size: "12,2", comment: "Revenue attributed to conversion" }),
        makeField(5, "currency", "VARCHAR", { size: "3", default: "USD", comment: "Revenue currency" }),
        makeField(6, "attribution_source", "VARCHAR", { size: "200", comment: "Attributed traffic source" }),
        makeField(7, "attribution_medium", "VARCHAR", { size: "200", comment: "Attributed medium" }),
        makeField(8, "attribution_campaign", "VARCHAR", { size: "200", comment: "Attributed campaign" }),
        makeField(9, "converted_at", "TIMESTAMP", { notNull: true, comment: "Conversion timestamp" }),
        createdAt(10),
      ],
      indices: [
        { name: "idx_conversions_session_id", unique: false, fields: ["session_id"] },
        { name: "idx_conversions_user_id", unique: false, fields: ["user_id"] },
        { name: "idx_conversions_goal_name", unique: false, fields: ["goal_name"] },
        { name: "idx_conversions_converted_at", unique: false, fields: ["converted_at"] },
      ],
    },
    {
      id: 4,
      name: "aggregates_daily",
      x: 700,
      y: 400,
      comment: "Pre-computed daily aggregates for dashboard queries",
      color: "#175e7a",
      fields: [
        uuidPk(0),
        makeField(1, "date", "DATE", { notNull: true, comment: "Aggregation date" }),
        makeField(2, "metric_name", "VARCHAR", { size: "100", notNull: true, comment: "Metric identifier" }),
        makeField(3, "dimension_name", "VARCHAR", { size: "100", notNull: true, default: "total", comment: "Dimension for grouping" }),
        makeField(4, "dimension_value", "VARCHAR", { size: "500", notNull: true, default: "all", comment: "Dimension value" }),
        makeField(5, "value_count", "BIGINT", { notNull: true, default: "0", comment: "Count metric" }),
        makeField(6, "value_sum", "DECIMAL", { size: "18,4", default: "0", comment: "Sum metric" }),
        makeField(7, "value_avg", "DECIMAL", { size: "18,4", comment: "Average metric" }),
        makeField(8, "value_min", "DECIMAL", { size: "18,4", comment: "Minimum value" }),
        makeField(9, "value_max", "DECIMAL", { size: "18,4", comment: "Maximum value" }),
        makeField(10, "unique_users", "BIGINT", { default: "0", comment: "Distinct user count" }),
        createdAt(11),
        updatedAt(12),
      ],
      indices: [
        { name: "idx_aggregates_daily_date", unique: false, fields: ["date"] },
        { name: "idx_aggregates_daily_metric", unique: false, fields: ["metric_name"] },
        { name: "idx_aggregates_daily_dimension", unique: false, fields: ["dimension_name", "dimension_value"] },
        { name: "idx_aggregates_daily_composite", unique: true, fields: ["date", "metric_name", "dimension_name", "dimension_value"] },
      ],
    },
  ];

  const relationships = [
    { id: 0, name: "fk_events_session_id", startTableId: 0, startFieldId: 2, endTableId: 1, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 1, name: "fk_page_views_session_id", startTableId: 2, startFieldId: 1, endTableId: 1, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
    { id: 2, name: "fk_conversions_session_id", startTableId: 3, startFieldId: 1, endTableId: 1, endFieldId: 0, cardinality: "many_to_one", updateConstraint: "No action", deleteConstraint: "Cascade" },
  ];

  return { tables, relationships };
}


// --- Template Registry ---

export const TEMPLATE_SUMMARIES = [
  {
    name: "saas_multi_tenant",
    domain: "Multi-tenant SaaS",
    description:
      "organizations, users, memberships, api_keys, audit_log with org_id tenant isolation",
    keywords: ["saas", "multi-tenant", "rls", "organization", "tenant", "b2b", "subscription"],
  },
  {
    name: "ecommerce",
    domain: "E-commerce",
    description:
      "products, categories, orders, order_items, customers, addresses, payments, inventory, reviews",
    keywords: ["ecommerce", "shop", "store", "products", "orders", "cart", "checkout", "marketplace"],
  },
  {
    name: "fintech_ledger",
    domain: "Financial / accounting",
    description:
      "double-entry accounting with append-only ledger_entries, materialized balances, reconciliation_log",
    keywords: ["fintech", "ledger", "accounting", "transactions", "payments", "wallet", "banking", "double-entry"],
  },
  {
    name: "social_platform",
    domain: "Social platform",
    description: "users, posts, comments, likes, follows, notifications, media",
    keywords: ["social", "feed", "posts", "followers", "comments", "likes", "messaging"],
  },
  {
    name: "analytics_pipeline",
    domain: "Analytics / event tracking",
    description: "events, sessions, page_views, conversions, daily aggregates",
    keywords: ["analytics", "tracking", "events", "metrics", "telemetry", "observability"],
  },
];

const TEMPLATES = {
  saas_multi_tenant: {
    name: "saas_multi_tenant",
    description: "Multi-tenant SaaS with RLS pattern: organizations, users, memberships, api_keys, audit_log. All tables have org_id for tenant isolation.",
    tables: 5,
    build: buildSaasMultiTenant,
  },
  ecommerce: {
    name: "ecommerce",
    description: "E-commerce platform: products, categories, orders, order_items, customers, addresses, payments, inventory, reviews.",
    tables: 9,
    build: buildEcommerce,
  },
  fintech_ledger: {
    name: "fintech_ledger",
    description: "Double-entry accounting ledger: accounts, ledger_entries (append-only), transactions, balances (materialized), reconciliation_log.",
    tables: 5,
    build: buildFintechLedger,
  },
  social_platform: {
    name: "social_platform",
    description: "Social platform: users, posts, comments, likes, follows, notifications, media.",
    tables: 7,
    build: buildSocialPlatform,
  },
  analytics_pipeline: {
    name: "analytics_pipeline",
    description: "Analytics pipeline: events (partitioned by time), sessions, page_views, conversions, aggregates_daily.",
    tables: 5,
    build: buildAnalyticsPipeline,
  },
};

// --- Tool Registration ---

export function registerTemplateTools(server, store) {
  // --- list_templates ---
  server.tool(
    "list_templates",
    "List all available pre-built schema templates with descriptions",
    {},
    async () => {
      const lines = ["Available schema templates:\n"];
      for (const [key, tmpl] of Object.entries(TEMPLATES)) {
        lines.push(`- ${key} (${tmpl.tables} tables)`);
        lines.push(`  ${tmpl.description}\n`);
      }
      lines.push("Use apply_template to add a template to the current diagram.");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // --- apply_template ---
  server.tool(
    "apply_template",
    "Apply a pre-built production-grade schema template (UUID PKs, timestamps, indices, comments, proper FKs) to the current diagram. STRONGLY RECOMMENDED when the user's domain matches one of: SaaS multi-tenant, e-commerce, fintech ledger, social platform, analytics pipeline. Use this BEFORE add_table to save time and start from production patterns -- you can still customize with add_field/add_table afterwards. The think_about_schema tool will surface matching templates during entity_identification phase.",
    {
      template_name: z
        .enum(["saas_multi_tenant", "ecommerce", "fintech_ledger", "social_platform", "analytics_pipeline"])
        .describe("Name of the template to apply"),
    },
    async ({ template_name }) => {
      const tmpl = TEMPLATES[template_name];
      if (!tmpl) {
        return {
          content: [{ type: "text", text: `Error: Template '${template_name}' not found.` }],
          isError: true,
        };
      }

      const { tables, relationships } = tmpl.build();

      // Offset IDs based on existing data to avoid collisions
      const tableIdOffset = store.nextTableId();
      const relIdOffset = store.nextRelationshipId();

      // Remap table IDs
      const remappedTables = tables.map((t) => ({
        ...t,
        id: t.id + tableIdOffset,
      }));

      // Remap relationship IDs and table references
      const remappedRels = relationships.map((r) => ({
        ...r,
        id: r.id + relIdOffset,
        startTableId: r.startTableId + tableIdOffset,
        endTableId: r.endTableId + tableIdOffset,
      }));

      // Check for name collisions
      const existingNames = store.tables.map((t) => t.name.toLowerCase());
      const conflicts = remappedTables.filter((t) =>
        existingNames.includes(t.name.toLowerCase()),
      );
      if (conflicts.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Table name conflict(s): ${conflicts.map((c) => c.name).join(", ")}. Remove existing tables first or rename them.`,
            },
          ],
          isError: true,
        };
      }

      // Add tables and relationships
      for (const table of remappedTables) {
        store.tables.push(table);
      }
      for (const rel of remappedRels) {
        store.relationships.push(rel);
      }

      await store.save();

      const tableNames = remappedTables.map((t) => t.name).join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Template '${template_name}' applied successfully.\n\nAdded ${remappedTables.length} tables: ${tableNames}\nAdded ${remappedRels.length} relationships.\n\nAll tables include UUID primary keys, created_at/updated_at timestamps, proper indices, and comments.`,
          },
        ],
      };
    },
  );
}
