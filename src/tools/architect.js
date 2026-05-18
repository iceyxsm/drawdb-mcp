import { z } from "zod";
import { resetThinkingState } from "./thinking.js";

const ARCHITECT_SYSTEM_PROMPT = `You are a senior database architect with expertise in:
- High-scale financial systems and exchange infrastructure
- Event sourcing, CQRS, and ledger/accounting systems
- PostgreSQL internals and TimescaleDB
- Distributed transaction systems and low-latency OLTP
- Analytics pipelines and data warehousing
- Audit/compliance systems and multi-region architectures
- Schema evolution at scale and high-frequency trading infrastructure

You think like engineers from Stripe, Coinbase, Jane Street, Bloomberg, AWS Aurora, Uber Infrastructure, Snowflake, and Databricks.

CORE MISSION: Design production-grade database architectures. Never generate beginner-level schemas.

Every decision must optimize for:
- Scalability, consistency, observability
- Auditability, replayability, migration safety
- Operational simplicity, query performance
- Failure recovery, long-term maintainability

ENGINEERING PRINCIPLES:
- Prefer append-only financial records
- Separate transactional workloads from analytical workloads
- Design for billions of rows and concurrent writes
- Design for historical replayability and idempotent event processing
- Minimize locking and contention
- Use normalization intentionally; denormalization only when justified
- Never use JSONB unless justified
- Every table must have a scaling rationale

REQUIRED TECHNOLOGIES:
- PostgreSQL as primary database
- TimescaleDB when appropriate for time-series
- Event sourcing where beneficial
- Partitioning for large-scale tables
- UUID primary keys
- Explicit indexing strategies

FORBIDDEN PATTERNS:
- Simplistic CRUD-only schemas
- Excessive JSON blobs
- Missing audit trails
- Mutable financial ledgers
- Poor indexing
- Unpartitioned high-volume tables
- Weak reconciliation models
- Synchronous bottleneck architectures

REASONING FRAMEWORK (apply before generating schemas):
1. Analyze workload patterns and read/write ratios
2. Analyze scaling risks and financial consistency requirements
3. Analyze replay/audit and partitioning requirements
4. Analyze analytical query and operational complexity
5. Analyze migration complexity and disaster recovery implications

REQUIRED OUTPUT SECTIONS:
- Architecture overview and workload analysis
- ERD design and table definitions
- Relationship design and indexing strategy
- Partitioning strategy and event sourcing strategy
- Ledger model and reconciliation strategy
- Materialized views and caching strategy
- Query optimization and migration strategy
- Audit logging and observability strategy
- Disaster recovery strategy
- Bottleneck analysis and scalability limits
- Complete SQL schema

QUALITY CONTROL - Review your own architecture as if:
- You are performing a FAANG production review
- The system handles billions in transactions
- Schema mistakes could cost millions
- Downtime is unacceptable
- Migrations must be zero-downtime

Explicitly identify weaknesses, future scaling risks, operational risks, expensive joins, lock contention risks, replication risks, partitioning limits, and indexing tradeoffs.`;

/**
 * Register the architect tool -- an AI-guided database design tool
 * that produces production-grade schemas and writes them into the diagram.
 */
export function registerArchitectTools(server, store) {
  // --- design_schema ---
  server.tool(
    "design_schema",
    `Start a production-grade database schema design session. 
This tool initializes the design with the user's requirements and FORCES the AI into the 
sequential thinking flow via think_about_schema. It does NOT return a full architecture; 
the AI must reason through the design step by step.

The AI's next action after this tool MUST be think_about_schema with thoughtNumber=1.`,
    {
      product_description: z
        .string()
        .describe("What the product/system does -- its core purpose and domain"),
      features: z
        .string()
        .describe("Key features that need database support (comma-separated or bullet list)"),
      expected_users: z
        .string()
        .optional()
        .default("unspecified")
        .describe("Expected number of users (e.g., '10M', '100K'). If unspecified, the AI should ASK the user."),
      transactions_per_second: z
        .string()
        .optional()
        .default("unspecified")
        .describe("Expected peak TPS (e.g., '50K', '1K'). If unspecified, the AI should ASK."),
      daily_events: z
        .string()
        .optional()
        .default("unspecified")
        .describe("Expected daily event volume. If unspecified, the AI should ASK."),
      regions: z
        .string()
        .optional()
        .default("unspecified")
        .describe("Deployment regions. If unspecified, the AI should ASK."),
      retention: z
        .string()
        .optional()
        .default("unspecified")
        .describe("Data retention requirements. If unspecified, the AI should ASK."),
      dialect: z
        .enum(["postgresql", "mysql", "sqlite", "mariadb", "transactsql", "oraclesql"])
        .optional()
        .describe("Target database dialect. If omitted and the diagram has no dialect set, the AI should ASK or SUGGEST one based on requirements."),
    },
    async ({
      product_description,
      features,
      expected_users,
      transactions_per_second,
      daily_events,
      regions,
      retention,
      dialect,
    }) => {
      // Auto-clear the diagram when starting a new design session.
      // This prevents leftover tables from a previous design polluting the new one.
      // The user explicitly called design_schema with new requirements, so they want a fresh start.
      if (store.tables.length > 0 || store.enums.length > 0) {
        store.diagram.tables = [];
        store.diagram.relationships = [];
        store.diagram.notes = [];
        store.diagram.subjectAreas = [];
        store.diagram.types = [];
        store.diagram.enums = [];
        // Generate a new diagramId so DrawDB treats this as a new diagram
        store.diagram.diagramId = store._generateUUID();
      }

      // Reset thinking state for the new session
      resetThinkingState();

      // Set dialect on the diagram if provided
      if (dialect) {
        store.diagram.database = dialect;
      }

      // Set title from product description
      store.diagram.title = product_description.substring(0, 80);

      await store.save();

      const requirementsContext = `
PRODUCT: ${product_description}
FEATURES: ${features}
SCALE:
  - Users: ${expected_users}
  - TPS: ${transactions_per_second}
  - Daily events: ${daily_events}
  - Regions: ${regions}
  - Retention: ${retention}
DIALECT: ${dialect || store.database || "(not set -- ask the user)"}

CURRENT DIAGRAM:
  - Tables: ${store.tables.length}
  - Relationships: ${store.relationships.length}
`;

      const missing = [];
      if (expected_users === "unspecified") missing.push("expected_users");
      if (transactions_per_second === "unspecified") missing.push("transactions_per_second");
      if (daily_events === "unspecified") missing.push("daily_events");
      if (regions === "unspecified") missing.push("regions");
      if (retention === "unspecified") missing.push("retention");
      if (!dialect && !store.database) missing.push("dialect");

      const response = {
        status: "design_session_started",
        persona: "You are a senior database architect (Stripe, Coinbase, Jane Street, Bloomberg level). Think rigorously, not quickly.",
        requirements_recorded: requirementsContext,
        next_action: {
          required: "think_about_schema",
          parameters: {
            thoughtNumber: 1,
            totalThoughts: 12,
            phase: "domain_analysis",
            nextThoughtNeeded: true,
          },
          instruction: "DO NOT call add_table, add_enum, add_field, or any write tools yet. You MUST start the sequential thinking loop NOW by calling think_about_schema with the parameters above. Continue calling it (10-15 times) through every phase. Only after thinking completes should you execute write tools.",
        },
      };

      if (missing.length > 0) {
        response.missing_requirements = {
          fields: missing,
          instruction: `Before starting deep design, ASK THE USER for: ${missing.join(", ")}. These directly affect partitioning, indexing, and architecture choices. Do not assume defaults.`,
        };
      }

      if (!store.database && !dialect) {
        response.dialect_warning = `No database dialect set. ASK THE USER which one they want, or SUGGEST one based on the requirements (e.g. financial -> postgresql for ACID + types, mobile -> sqlite, time-series analytics -> postgresql + TimescaleDB). Set it via new_diagram or pass dialect to design_schema.`;
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // --- get_design_prompt ---
  server.tool(
    "get_design_prompt",
    `Returns the database architecture system prompt. Use this to prime your context 
before designing any database schema. Call this FIRST before any schema design work.`,
    {},
    async () => {
      return {
        content: [
          {
            type: "text",
            text: ARCHITECT_SYSTEM_PROMPT,
          },
        ],
      };
    },
  );

  // --- validate_schema_quality ---
  server.tool(
    "validate_schema_quality",
    `Analyze the current diagram for production-readiness issues. Returns a quality 
report identifying anti-patterns, missing audit trails, poor indexing, scaling risks, 
and recommendations for improvement.`,
    {},
    async () => {
      const issues = [];
      const warnings = [];
      const info = [];

      // Check for missing primary keys
      for (const table of store.tables) {
        const hasPK = table.fields.some((f) => f.primary);
        if (!hasPK) {
          issues.push(`Table '${table.name}' has no primary key`);
        }

        // Check for UUID vs integer PKs
        const pkFields = table.fields.filter((f) => f.primary);
        for (const pk of pkFields) {
          if (pk.type === "INT" || pk.type === "BIGINT" || pk.type === "SERIAL") {
            warnings.push(
              `Table '${table.name}': PK '${pk.name}' uses ${pk.type} -- consider UUID for distributed systems`,
            );
          }
        }

        // Check for missing timestamps
        const hasCreatedAt = table.fields.some((f) =>
          ["created_at", "createdat", "created"].includes(f.name.toLowerCase()),
        );
        const hasUpdatedAt = table.fields.some((f) =>
          ["updated_at", "updatedat", "updated", "modified_at"].includes(f.name.toLowerCase()),
        );
        if (!hasCreatedAt) {
          warnings.push(`Table '${table.name}' missing created_at timestamp`);
        }
        if (!hasUpdatedAt) {
          info.push(`Table '${table.name}' missing updated_at timestamp`);
        }

        // Check for missing indices on FK columns
        const fkFields = store.relationships
          .filter((r) => String(r.startTableId) === String(table.id))
          .map((r) => String(r.startFieldId));

        for (const fkFieldId of fkFields) {
          const field = table.fields.find((f) => String(f.id) === fkFieldId);
          if (field) {
            const hasIndex =
              field.unique ||
              (table.indices &&
                table.indices.some((idx) => idx.fields.includes(field.name)));
            if (!hasIndex) {
              warnings.push(
                `Table '${table.name}': FK column '${field.name}' has no index -- will cause slow joins`,
              );
            }
          }
        }

        // Check for tables with no indices at all
        if (!table.indices || table.indices.length === 0) {
          const fieldCount = table.fields.length;
          if (fieldCount > 3) {
            info.push(
              `Table '${table.name}' has ${fieldCount} fields but no indices defined`,
            );
          }
        }

        // Check for missing comments
        if (!table.comment) {
          info.push(`Table '${table.name}' has no comment/description`);
        }
      }

      // Check for orphan tables (no relationships)
      for (const table of store.tables) {
        const hasRel = store.relationships.some(
          (r) =>
            String(r.startTableId) === String(table.id) ||
            String(r.endTableId) === String(table.id),
        );
        if (!hasRel && store.tables.length > 1) {
          warnings.push(`Table '${table.name}' has no relationships -- orphan table`);
        }
      }

      // Check for missing audit tables
      const tableNames = store.tables.map((t) => t.name.toLowerCase());
      const hasAuditTable = tableNames.some(
        (n) =>
          n.includes("audit") ||
          n.includes("event") ||
          n.includes("log") ||
          n.includes("history"),
      );
      if (store.tables.length > 3 && !hasAuditTable) {
        warnings.push(
          "No audit/event/history table found -- consider adding audit trails for compliance",
        );
      }

      // Check for missing soft-delete pattern
      const hasSoftDelete = store.tables.some((t) =>
        t.fields.some((f) =>
          ["deleted_at", "is_deleted", "deleted"].includes(f.name.toLowerCase()),
        ),
      );
      if (store.tables.length > 2 && !hasSoftDelete) {
        info.push(
          "No soft-delete columns found -- consider deleted_at for data recovery",
        );
      }

      const report = {
        summary: {
          tables: store.tables.length,
          relationships: store.relationships.length,
          issues: issues.length,
          warnings: warnings.length,
          info: info.length,
          score:
            issues.length === 0 && warnings.length <= 2
              ? "GOOD"
              : issues.length === 0
                ? "FAIR"
                : "NEEDS WORK",
        },
        issues,
        warnings,
        info,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    },
  );

  // --- explain_schema ---
  server.tool(
    "explain_schema",
    `Explain the current database schema in plain English. Returns a full breakdown 
of what the schema does, how tables relate, what the data flow looks like, 
and what domain this schema serves. Useful for onboarding, documentation, 
or understanding an unfamiliar diagram.`,
    {},
    async () => {
      if (store.tables.length === 0) {
        return {
          content: [{ type: "text", text: "The diagram is empty -- no tables to explain." }],
        };
      }

      const schemaSnapshot = buildSchemaSnapshot(store);

      const prompt = `${ARCHITECT_SYSTEM_PROMPT}

---

TASK: Explain this database schema in detail. Write as if you're onboarding a new engineer.

${schemaSnapshot}

---

Provide:
1. **Domain Summary** -- What system/product does this schema serve? What's the core business logic?
2. **Table-by-Table Breakdown** -- For each table: its purpose, key columns, and role in the system.
3. **Data Flow** -- How data moves through the system (e.g., user creates X -> triggers Y -> stored in Z).
4. **Relationship Map** -- Explain each FK relationship in business terms (not just "table A references table B").
5. **Design Patterns Detected** -- Identify patterns like event sourcing, soft deletes, polymorphism, audit trails, etc.
6. **Implicit Assumptions** -- What assumptions does this schema make about the business domain?
7. **Missing Context** -- What's NOT in the schema that you'd expect for this domain?`;

      return { content: [{ type: "text", text: prompt }] };
    },
  );

  // --- review_schema ---
  server.tool(
    "review_schema",
    `Perform a senior-level production review of the current schema. 
Returns a detailed critique covering performance, scalability, correctness, 
operational risks, and concrete recommendations -- as if reviewing a PR at Stripe or Coinbase.`,
    {},
    async () => {
      if (store.tables.length === 0) {
        return {
          content: [{ type: "text", text: "The diagram is empty -- nothing to review." }],
        };
      }

      const schemaSnapshot = buildSchemaSnapshot(store);

      const prompt = `${ARCHITECT_SYSTEM_PROMPT}

---

TASK: Perform a rigorous production-readiness review of this schema. Be brutally honest. This is a senior staff engineer review, not a code review from a junior.

${schemaSnapshot}

---

Structure your review as:

## VERDICT
One line: PRODUCTION-READY / NEEDS WORK / NOT PRODUCTION-READY

## CRITICAL ISSUES (must fix before deploy)
- Issues that will cause data loss, corruption, or outages

## PERFORMANCE RISKS
- Missing indices, expensive joins, lock contention, N+1 query patterns
- Tables that will degrade at scale
- Hot spots and write amplification

## SCALABILITY ANALYSIS
- Which tables will hit billions of rows first?
- Partitioning needs
- Sharding considerations
- Read replica strategy

## DATA INTEGRITY
- Missing constraints, orphan risk, cascade dangers
- Race conditions in concurrent writes
- Idempotency gaps

## OPERATIONAL CONCERNS
- Migration complexity (can you ALTER these tables under load?)
- Backup/restore time for large tables
- Monitoring blind spots
- Runbook gaps

## SECURITY & COMPLIANCE
- PII exposure, missing encryption columns
- Audit trail completeness
- GDPR/data deletion feasibility

## WHAT'S MISSING
- Tables/columns this domain typically needs but doesn't have
- Patterns that should be present (event log, outbox, dead letter, etc.)

## CONCRETE RECOMMENDATIONS
For each issue, provide the exact fix -- table name, column to add, index to create, relationship to change. Format as actionable steps the AI can execute with the write tools.`;

      return { content: [{ type: "text", text: prompt }] };
    },
  );

  // --- upgrade_to_production ---
  server.tool(
    "upgrade_to_production",
    `Take the current schema (however basic it is) and generate a concrete action plan 
to upgrade it to production-grade. Returns step-by-step instructions that the AI agent 
can execute using the write tools. Even a simple 3-table CRUD schema will get upgraded 
with proper timestamps, audit trails, indices, partitioning strategy, and event sourcing where appropriate.`,
    {
      target_scale: z
        .string()
        .optional()
        .default("1M users, 10K TPS")
        .describe("Target scale to design for (e.g., '100M users, 50K TPS')"),
      compliance: z
        .string()
        .optional()
        .default("standard")
        .describe("Compliance level: 'standard', 'financial', 'healthcare', 'gdpr'"),
    },
    async ({ target_scale, compliance }) => {
      if (store.tables.length === 0) {
        return {
          content: [{ type: "text", text: "The diagram is empty -- nothing to upgrade. Use design_schema first." }],
        };
      }

      const schemaSnapshot = buildSchemaSnapshot(store);

      const prompt = `${ARCHITECT_SYSTEM_PROMPT}

---

TASK: Upgrade this schema to production-grade. The current schema may be basic/naive -- that's fine. Your job is to transform it into something deployable at scale.

Target scale: ${target_scale}
Compliance level: ${compliance}

CURRENT SCHEMA:
${schemaSnapshot}

---

Provide a COMPLETE upgrade plan. For every change, output the exact MCP tool call needed.

## PHASE 1: Foundation (must-have for any production system)
- Add missing created_at/updated_at timestamps to all tables
- Add proper primary keys (UUID if distributed)
- Add NOT NULL constraints where appropriate
- Add table comments explaining purpose

## PHASE 2: Data Integrity
- Add missing foreign key relationships
- Add CHECK constraints
- Add unique constraints where needed
- Fix any orphan tables

## PHASE 3: Performance
- Add indices on all FK columns
- Add indices for common query patterns
- Identify columns that need composite indices
- Add partial indices where beneficial

## PHASE 4: Audit & Compliance
- Add audit_log / event_store table if missing
- Add soft-delete (deleted_at) where appropriate
- Add version columns for optimistic locking
- Add actor/modified_by tracking

## PHASE 5: Scale Readiness
- Identify tables needing partitioning (and by what key)
- Add archival strategy columns (archived_at, partition keys)
- Separate hot/cold data paths
- Add materialized view candidates

## PHASE 6: Operational Excellence
- Add status/state machine columns where appropriate
- Add idempotency keys for event processing
- Add correlation_id for distributed tracing
- Add schema version tracking

---

OUTPUT FORMAT: After each phase explanation, list the exact actions as:

{"tool": "add_field", "args": {"table_name": "...", "field": {"name": "created_at", "type": "TIMESTAMPTZ", "notNull": true, "default": "CURRENT_TIMESTAMP"}}}
{"tool": "add_index", "args": {"table_name": "...", "index_name": "...", "fields": [...], "unique": false}}
{"tool": "add_table", "args": {"name": "audit_log", "fields": [...], "comment": "..."}}

The AI agent will execute these sequentially to upgrade the schema.`;

      return { content: [{ type: "text", text: prompt }] };
    },
  );

  // --- validate_constraints ---
  server.tool(
    "validate_constraints",
    `Perform deep constraint validation on the current schema. Checks type compatibility 
on FK columns, circular references, naming conventions, redundant indices, missing NOT NULL 
on FKs, default value types, enum consistency, size validation, reserved words, and 
relationship integrity. Returns a structured report with severity levels.`,
    {},
    async () => {
      const report = runConstraintValidation(store);
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    },
  );
}

// --- Constraint Validation Logic ---

const SQL_RESERVED_WORDS = new Set([
  "user", "order", "group", "table", "index", "select", "insert", "update",
  "delete", "from", "where", "join", "on", "create", "drop", "alter",
  "column", "constraint", "primary", "foreign", "key", "references",
  "check", "default", "null", "not", "and", "or", "in", "between",
  "like", "is", "as", "set", "values", "into", "grant", "revoke",
  "commit", "rollback", "transaction", "begin", "end", "case", "when",
  "then", "else", "having", "limit", "offset", "union", "all", "any",
  "exists", "distinct", "count", "sum", "avg", "min", "max", "by",
  "asc", "desc", "with", "recursive", "view", "trigger", "procedure",
  "function", "database", "schema", "role", "session", "type", "enum",
  "boolean", "integer", "float", "double", "decimal", "numeric",
  "varchar", "char", "text", "date", "time", "timestamp", "interval",
  "array", "row", "level", "comment", "sequence", "partition", "range",
]);

function runConstraintValidation(store) {
  const errors = [];
  const warnings = [];
  const infos = [];

  // 1. Type compatibility checks on FK columns
  for (const rel of store.relationships) {
    const startTable = store.findTableById(rel.startTableId);
    const endTable = store.findTableById(rel.endTableId);
    if (!startTable || !endTable) continue;

    const startField = startTable.fields.find((f) => String(f.id) === String(rel.startFieldId));
    const endField = endTable.fields.find((f) => String(f.id) === String(rel.endFieldId));
    if (!startField || !endField) continue;

    const startType = normalizeType(startField.type);
    const endType = normalizeType(endField.type);

    if (startType !== endType) {
      errors.push({
        check: "type_compatibility",
        severity: "error",
        message: `FK type mismatch: ${startTable.name}.${startField.name} (${startField.type}) references ${endTable.name}.${endField.name} (${endField.type})`,
        table: startTable.name,
        field: startField.name,
      });
    }

    // Check size compatibility for sized types
    if (startType === endType && startField.size && endField.size) {
      if (String(startField.size) !== String(endField.size)) {
        warnings.push({
          check: "type_compatibility",
          severity: "warning",
          message: `FK size mismatch: ${startTable.name}.${startField.name} (${startField.type}(${startField.size})) references ${endTable.name}.${endField.name} (${endField.type}(${endField.size}))`,
          table: startTable.name,
          field: startField.name,
        });
      }
    }
  }

  // 2. Circular reference detection
  const circularChains = detectCircularReferences(store);
  for (const chain of circularChains) {
    errors.push({
      check: "circular_reference",
      severity: "error",
      message: `Circular FK chain detected: ${chain.join(" -> ")}`,
      tables: chain,
    });
  }

  // 3. Naming convention checks
  for (const table of store.tables) {
    if (!isSnakeCase(table.name)) {
      warnings.push({
        check: "naming_convention",
        severity: "warning",
        message: `Table '${table.name}' is not snake_case`,
        table: table.name,
      });
    }

    for (const field of table.fields) {
      if (!isSnakeCase(field.name)) {
        warnings.push({
          check: "naming_convention",
          severity: "warning",
          message: `Column '${table.name}.${field.name}' is not snake_case`,
          table: table.name,
          field: field.name,
        });
      }
    }
  }

  // Check FK naming pattern
  for (const rel of store.relationships) {
    const startTable = store.findTableById(rel.startTableId);
    const startField = startTable ? startTable.fields.find((f) => String(f.id) === String(rel.startFieldId)) : null;
    if (startTable && startField) {
      const expectedPattern = "fk_" + startTable.name + "_" + startField.name;
      if (rel.name.toLowerCase() !== expectedPattern.toLowerCase()) {
        infos.push({
          check: "naming_convention",
          severity: "info",
          message: `Relationship '${rel.name}' does not follow pattern 'fk_table_column' (expected: '${expectedPattern}')`,
          relationship: rel.name,
        });
      }
    }
  }

  // 4. Redundant index detection
  for (const table of store.tables) {
    if (!table.indices || table.indices.length < 2) continue;

    for (let i = 0; i < table.indices.length; i++) {
      for (let j = 0; j < table.indices.length; j++) {
        if (i === j) continue;
        const idxA = table.indices[i];
        const idxB = table.indices[j];

        // Check if idxA is a prefix of idxB (making idxA redundant)
        if (idxA.fields.length < idxB.fields.length) {
          const isPrefix = idxA.fields.every(
            (f, k) => f.toLowerCase() === idxB.fields[k].toLowerCase(),
          );
          if (isPrefix && idxA.unique === idxB.unique) {
            warnings.push({
              check: "redundant_index",
              severity: "warning",
              message: `Index '${idxA.name}' on ${table.name}(${idxA.fields.join(", ")}) is redundant -- covered by '${idxB.name}' on (${idxB.fields.join(", ")})`,
              table: table.name,
              index: idxA.name,
            });
          }
        }
      }
    }
  }

  // 5. Missing NOT NULL on FK columns
  for (const rel of store.relationships) {
    const startTable = store.findTableById(rel.startTableId);
    if (!startTable) continue;
    const startField = startTable.fields.find((f) => String(f.id) === String(rel.startFieldId));
    if (!startField) continue;

    if (!startField.notNull) {
      warnings.push({
        check: "missing_not_null_fk",
        severity: "warning",
        message: `FK column '${startTable.name}.${startField.name}' is nullable -- FK columns should typically be NOT NULL`,
        table: startTable.name,
        field: startField.name,
      });
    }
  }

  // 6. Default value type validation
  for (const table of store.tables) {
    for (const field of table.fields) {
      if (!field.default || field.default === "") continue;
      const typeIssue = validateDefaultType(field);
      if (typeIssue) {
        warnings.push({
          check: "default_value_type",
          severity: "warning",
          message: `${table.name}.${field.name}: ${typeIssue}`,
          table: table.name,
          field: field.name,
        });
      }
    }
  }

  // 7. Enum consistency
  for (const table of store.tables) {
    for (const field of table.fields) {
      if ((field.type === "ENUM" || field.type === "SET") && (!field.values || field.values.length === 0)) {
        errors.push({
          check: "enum_consistency",
          severity: "error",
          message: `ENUM/SET column '${table.name}.${field.name}' has no values defined`,
          table: table.name,
          field: field.name,
        });
      }
    }
  }

  // 8. Size validation
  for (const table of store.tables) {
    for (const field of table.fields) {
      const type = (field.type || "").toUpperCase();
      if ((type === "VARCHAR" || type === "CHAR" || type === "NVARCHAR") && !field.size) {
        warnings.push({
          check: "size_validation",
          severity: "warning",
          message: `Column '${table.name}.${field.name}' is ${type} without a size specified`,
          table: table.name,
          field: field.name,
        });
      }
      if ((type === "DECIMAL" || type === "NUMERIC") && !field.size) {
        warnings.push({
          check: "size_validation",
          severity: "warning",
          message: `Column '${table.name}.${field.name}' is ${type} without precision/scale specified`,
          table: table.name,
          field: field.name,
        });
      }
    }
  }

  // 9. Reserved word detection
  for (const table of store.tables) {
    if (SQL_RESERVED_WORDS.has(table.name.toLowerCase())) {
      warnings.push({
        check: "reserved_word",
        severity: "warning",
        message: `Table name '${table.name}' is a SQL reserved word`,
        table: table.name,
      });
    }
    for (const field of table.fields) {
      if (SQL_RESERVED_WORDS.has(field.name.toLowerCase())) {
        warnings.push({
          check: "reserved_word",
          severity: "warning",
          message: `Column name '${table.name}.${field.name}' is a SQL reserved word`,
          table: table.name,
          field: field.name,
        });
      }
    }
  }

  // 10. Relationship integrity
  for (const rel of store.relationships) {
    const startTable = store.findTableById(rel.startTableId);
    const endTable = store.findTableById(rel.endTableId);

    if (!startTable) {
      errors.push({
        check: "relationship_integrity",
        severity: "error",
        message: `Relationship '${rel.name}' references non-existent start table (id: ${rel.startTableId})`,
        relationship: rel.name,
      });
      continue;
    }
    if (!endTable) {
      errors.push({
        check: "relationship_integrity",
        severity: "error",
        message: `Relationship '${rel.name}' references non-existent end table (id: ${rel.endTableId})`,
        relationship: rel.name,
      });
      continue;
    }

    const startField = startTable.fields.find((f) => String(f.id) === String(rel.startFieldId));
    if (!startField) {
      errors.push({
        check: "relationship_integrity",
        severity: "error",
        message: `Relationship '${rel.name}' references non-existent field (id: ${rel.startFieldId}) in table '${startTable.name}'`,
        relationship: rel.name,
        table: startTable.name,
      });
    }

    const endField = endTable.fields.find((f) => String(f.id) === String(rel.endFieldId));
    if (!endField) {
      errors.push({
        check: "relationship_integrity",
        severity: "error",
        message: `Relationship '${rel.name}' references non-existent field (id: ${rel.endFieldId}) in table '${endTable.name}'`,
        relationship: rel.name,
        table: endTable.name,
      });
    }
  }

  return {
    summary: {
      tables: store.tables.length,
      relationships: store.relationships.length,
      errors: errors.length,
      warnings: warnings.length,
      info: infos.length,
      status: errors.length > 0 ? "INVALID" : warnings.length > 0 ? "HAS_WARNINGS" : "VALID",
    },
    errors,
    warnings,
    info: infos,
  };
}

function normalizeType(type) {
  const t = (type || "").toUpperCase();
  if (t === "SERIAL" || t === "BIGSERIAL") return "INT";
  if (t === "INTEGER") return "INT";
  if (t === "BIGINT") return "BIGINT";
  if (t === "SMALLINT") return "SMALLINT";
  if (t === "VARCHAR2") return "VARCHAR";
  if (t === "NVARCHAR") return "VARCHAR";
  if (t === "TIMESTAMPTZ" || t === "DATETIME" || t === "DATETIME2") return "TIMESTAMP";
  if (t === "DOUBLE PRECISION" || t === "FLOAT8") return "FLOAT";
  return t;
}

function isSnakeCase(name) {
  return /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name);
}

function detectCircularReferences(store) {
  const chains = [];
  const tableIds = store.tables.map((t) => String(t.id));

  // Build adjacency list from relationships
  const graph = new Map();
  for (const id of tableIds) {
    graph.set(id, []);
  }
  for (const rel of store.relationships) {
    const from = String(rel.startTableId);
    const to = String(rel.endTableId);
    if (graph.has(from)) {
      graph.get(from).push(to);
    }
  }

  // DFS cycle detection
  const visited = new Set();
  const inStack = new Set();
  const path = [];

  function dfs(node) {
    if (inStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat([node]);
      const tableNames = cycle.map((id) => {
        const t = store.findTableById(Number(id));
        return t ? t.name : "unknown";
      });
      chains.push(tableNames);
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const id of tableIds) {
    if (!visited.has(id)) {
      dfs(id);
    }
  }

  return chains;
}

function validateDefaultType(field) {
  const type = (field.type || "").toUpperCase();
  const val = String(field.default);
  const upper = val.toUpperCase();

  // Skip special defaults
  if (upper === "NULL" || upper === "CURRENT_TIMESTAMP" || upper === "NOW()" || val.startsWith("(")) {
    return null;
  }

  if (type === "INT" || type === "INTEGER" || type === "BIGINT" || type === "SMALLINT") {
    if (!/^-?\d+$/.test(val)) {
      return "Default value '" + val + "' is not a valid integer";
    }
  }

  if (type === "BOOLEAN" || type === "BIT") {
    if (!["true", "false", "0", "1"].includes(val.toLowerCase())) {
      return "Default value '" + val + "' is not a valid boolean";
    }
  }

  if (type === "DECIMAL" || type === "NUMERIC" || type === "FLOAT" || type === "DOUBLE") {
    if (isNaN(Number(val))) {
      return "Default value '" + val + "' is not a valid number";
    }
  }

  return null;
}

// --- Helper: Build a text snapshot of the current schema for prompts ---

function buildSchemaSnapshot(store) {
  const lines = [];

  lines.push(`DATABASE: ${store.database}`);
  lines.push(`TITLE: ${store.title}`);
  lines.push(`TABLES: ${store.tables.length}`);
  lines.push(`RELATIONSHIPS: ${store.relationships.length}`);
  lines.push("");

  for (const table of store.tables) {
    lines.push(`## Table: ${table.name}${table.comment ? ` -- ${table.comment}` : ""}`);
    for (const field of table.fields) {
      const flags = [];
      if (field.primary) flags.push("PK");
      if (field.notNull) flags.push("NOT NULL");
      if (field.unique) flags.push("UNIQUE");
      if (field.increment) flags.push("AUTO_INCREMENT");
      if (field.default) flags.push(`DEFAULT ${field.default}`);
      if (field.check) flags.push(`CHECK(${field.check})`);
      const typeStr = field.size ? `${field.type}(${field.size})` : field.type;
      lines.push(`  - ${field.name}: ${typeStr} ${flags.join(" ")}${field.comment ? ` // ${field.comment}` : ""}`);
    }
    if (table.indices && table.indices.length > 0) {
      lines.push("  Indices:");
      for (const idx of table.indices) {
        lines.push(`    - ${idx.name}: (${idx.fields.join(", ")})${idx.unique ? " UNIQUE" : ""}`);
      }
    }
    lines.push("");
  }

  if (store.relationships.length > 0) {
    lines.push("## Relationships:");
    for (const rel of store.relationships) {
      const fromTable = store.findTableById(rel.startTableId);
      const toTable = store.findTableById(rel.endTableId);
      const fromField = fromTable?.fields.find((f) => String(f.id) === String(rel.startFieldId));
      const toField = toTable?.fields.find((f) => String(f.id) === String(rel.endFieldId));
      lines.push(
        `  - ${rel.name}: ${fromTable?.name}.${fromField?.name} -> ${toTable?.name}.${toField?.name} [${rel.cardinality}] ON DELETE ${rel.deleteConstraint}, ON UPDATE ${rel.updateConstraint}`,
      );
    }
    lines.push("");
  }

  if (store.enums.length > 0) {
    lines.push("## Enums:");
    for (const e of store.enums) {
      lines.push(`  - ${e.name}: [${e.values.join(", ")}]`);
    }
    lines.push("");
  }

  if (store.types.length > 0) {
    lines.push("## Custom Types:");
    for (const t of store.types) {
      lines.push(`  - ${t.name}: { ${t.fields.map((f) => `${f.name}: ${f.type}`).join(", ")} }`);
    }
    lines.push("");
  }

  if (store.notes.length > 0) {
    lines.push("## Notes:");
    for (const n of store.notes) {
      lines.push(`  - ${n.title}: ${n.content}`);
    }
  }

  return lines.join("\n");
}
