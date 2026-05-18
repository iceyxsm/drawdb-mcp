import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";

/**
 * Production-grade schema deployment tools.
 * Exports the diagram as runnable SQL files that can be executed against
 * a real database (psql, mysql, sqlcmd, etc.) with proper ordering,
 * transactions, safety guards, and rollback scripts.
 */

const HEADER_BORDER = "-- ============================================================";

export function registerDeployTools(server, store) {
  // --- export_to_file ---
  server.tool(
    "export_to_file",
    `Export the schema as a complete, production-ready SQL file that can be run directly 
against a database. Generates a single self-contained file with proper ordering 
(extensions -> enums/types -> tables -> indices -> foreign keys), transactions 
where supported, IF NOT EXISTS guards, and a header with metadata.

Use this when the user is done designing and wants a deployable schema.sql file.`,
    {
      output_path: z
        .string()
        .describe("Output file path (e.g. './schema.sql', './migrations/001_init.sql')"),
      dialect: z
        .enum(["mysql", "postgresql", "sqlite", "mariadb", "transactsql", "oraclesql"])
        .optional()
        .describe("Target SQL dialect. Defaults to the diagram's database setting."),
      include_drop: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include DROP statements at the top (DESTRUCTIVE - use only for fresh installs)"),
      transactional: z
        .boolean()
        .optional()
        .default(true)
        .describe("Wrap statements in BEGIN/COMMIT (ignored for SQLite/MySQL DDL)"),
      tables: z
        .array(z.string())
        .optional()
        .describe("Subset of table names to export. Exports all if omitted."),
    },
    async ({ output_path, dialect, include_drop, transactional, tables: tableNames }) => {
      const db = dialect || store.database;
      const sql = buildDeployableSchema(store, db, {
        includeDrop: include_drop,
        transactional,
        tableNames,
      });

      const resolvedPath = resolve(output_path);
      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, sql, "utf-8");

      const stats = {
        file: resolvedPath,
        dialect: db,
        tables: tableNames ? tableNames.length : store.tables.length,
        relationships: store.relationships.length,
        indices: store.tables.reduce((sum, t) => sum + (t.indices?.length || 0), 0),
        size_bytes: Buffer.byteLength(sql, "utf-8"),
      };

      const runCmd = getRunCommand(db, resolvedPath);

      return {
        content: [
          {
            type: "text",
            text: `Schema exported to ${resolvedPath}\n\nStats:\n  Dialect: ${db}\n  Tables: ${stats.tables}\n  Relationships: ${stats.relationships}\n  Indices: ${stats.indices}\n  File size: ${stats.size_bytes} bytes\n\nTo run:\n  ${runCmd}`,
          },
        ],
      };
    },
  );

  // --- export_deployment_bundle ---
  server.tool(
    "export_deployment_bundle",
    `Export a complete deployment bundle as multiple files: schema.sql, indices.sql, 
rollback.sql, and README.md. This is the production-grade output for handing off 
to a DBA or running through a migration system.

Use this when the user wants a full deployment-ready directory, not just one file.`,
    {
      output_dir: z
        .string()
        .describe("Output directory (will be created if it doesn't exist)"),
      dialect: z
        .enum(["mysql", "postgresql", "sqlite", "mariadb", "transactsql", "oraclesql"])
        .optional()
        .describe("Target SQL dialect. Defaults to the diagram's database setting."),
    },
    async ({ output_dir, dialect }) => {
      const db = dialect || store.database;
      const resolvedDir = resolve(output_dir);
      await mkdir(resolvedDir, { recursive: true });

      // 1. schema.sql - tables + types/enums + foreign keys (no indices)
      const schemaSql = buildDeployableSchema(store, db, {
        includeDrop: false,
        transactional: true,
        skipIndices: true,
      });
      const schemaPath = join(resolvedDir, "schema.sql");
      await writeFile(schemaPath, schemaSql, "utf-8");

      // 2. indices.sql - all indices separately (safer to apply after data load)
      const indicesSql = buildIndicesOnly(store, db);
      const indicesPath = join(resolvedDir, "indices.sql");
      await writeFile(indicesPath, indicesSql, "utf-8");

      // 3. rollback.sql - drops everything
      const rollbackSql = buildRollbackScript(store, db);
      const rollbackPath = join(resolvedDir, "rollback.sql");
      await writeFile(rollbackPath, rollbackSql, "utf-8");

      // 4. README.md
      const readme = buildReadme(store, db);
      const readmePath = join(resolvedDir, "README.md");
      await writeFile(readmePath, readme, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `Deployment bundle written to ${resolvedDir}\n\nFiles created:\n  schema.sql    -- tables, types, enums, foreign keys\n  indices.sql   -- all indices (apply after data load for speed)\n  rollback.sql  -- drops all schema objects\n  README.md     -- deployment instructions\n\nDeployment order:\n  1. Run schema.sql to create tables and constraints\n  2. Load any seed/migration data\n  3. Run indices.sql to create indices\n\nDialect: ${db}\nTables: ${store.tables.length}\nRelationships: ${store.relationships.length}`,
          },
        ],
      };
    },
  );
}

// --- Schema Builder ---

function buildDeployableSchema(store, dialect, opts = {}) {
  const { includeDrop = false, transactional = true, tableNames, skipIndices = false } = opts;

  const lines = [];
  const tables = filterTables(store.tables, tableNames);

  // Header
  lines.push(HEADER_BORDER);
  lines.push(`-- Schema: ${store.title || "Untitled"}`);
  lines.push(`-- Dialect: ${dialect}`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Tables: ${tables.length}, Relationships: ${store.relationships.length}`);
  lines.push(`-- Generated by drawdb-mcp`);
  lines.push(HEADER_BORDER);
  lines.push("");

  // Begin transaction (PostgreSQL, MSSQL, Oracle support DDL transactions)
  const supportsTx = transactional && supportsDDLTransactions(dialect);
  if (supportsTx) {
    lines.push("BEGIN;");
    lines.push("");
  }

  // Drop section (optional)
  if (includeDrop) {
    lines.push("-- =====================================");
    lines.push("-- DROP existing objects (DESTRUCTIVE)");
    lines.push("-- =====================================");
    lines.push("");
    lines.push(buildRollbackBody(store, dialect, tables));
    lines.push("");
  }

  // Extensions (PostgreSQL only)
  if (dialect === "postgresql") {
    lines.push("-- =====================================");
    lines.push("-- Extensions");
    lines.push("-- =====================================");
    lines.push('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    lines.push("");
  }

  // Enums and custom types
  if (store.enums.length > 0 || store.types.length > 0) {
    lines.push("-- =====================================");
    lines.push("-- Types and enums");
    lines.push("-- =====================================");
    lines.push(buildTypesAndEnums(store, dialect));
    lines.push("");
  }

  // Inline ENUM types for PostgreSQL
  if (dialect === "postgresql") {
    const inlineEnums = buildInlineEnumTypes(tables);
    if (inlineEnums) {
      lines.push(inlineEnums);
      lines.push("");
    }
  }

  // Tables
  lines.push("-- =====================================");
  lines.push("-- Tables");
  lines.push("-- =====================================");
  for (const table of tables) {
    lines.push(buildCreateTable(table, dialect, store));
    lines.push("");
  }

  // Comments (PostgreSQL/Oracle separately)
  if (dialect === "postgresql" || dialect === "oraclesql") {
    const comments = buildComments(tables, dialect);
    if (comments) {
      lines.push("-- =====================================");
      lines.push("-- Comments");
      lines.push("-- =====================================");
      lines.push(comments);
      lines.push("");
    }
  }

  // Indices
  if (!skipIndices) {
    const indicesSql = buildIndices(tables, dialect);
    if (indicesSql) {
      lines.push("-- =====================================");
      lines.push("-- Indices");
      lines.push("-- =====================================");
      lines.push(indicesSql);
      lines.push("");
    }
  }

  // Foreign keys (separate ALTER statements, except SQLite which inlines them)
  if (dialect !== "sqlite") {
    const fks = buildForeignKeys(store, dialect, tables);
    if (fks) {
      lines.push("-- =====================================");
      lines.push("-- Foreign keys");
      lines.push("-- =====================================");
      lines.push(fks);
      lines.push("");
    }
  }

  if (supportsTx) {
    lines.push("COMMIT;");
    lines.push("");
  }

  return lines.join("\n");
}

function buildIndicesOnly(store, dialect) {
  const lines = [];
  lines.push(HEADER_BORDER);
  lines.push(`-- Indices for: ${store.title || "Untitled"}`);
  lines.push(`-- Dialect: ${dialect}`);
  lines.push(`-- Apply after schema.sql and any seed data load`);
  lines.push(HEADER_BORDER);
  lines.push("");

  const indicesSql = buildIndices(store.tables, dialect);
  lines.push(indicesSql || "-- No indices defined.");
  lines.push("");
  return lines.join("\n");
}

function buildRollbackScript(store, dialect) {
  const lines = [];
  lines.push(HEADER_BORDER);
  lines.push(`-- Rollback script for: ${store.title || "Untitled"}`);
  lines.push(`-- Dialect: ${dialect}`);
  lines.push(`-- WARNING: This DROPS all schema objects. Data will be lost.`);
  lines.push(HEADER_BORDER);
  lines.push("");

  if (supportsDDLTransactions(dialect)) {
    lines.push("BEGIN;");
    lines.push("");
  }

  lines.push(buildRollbackBody(store, dialect, store.tables));

  if (supportsDDLTransactions(dialect)) {
    lines.push("");
    lines.push("COMMIT;");
  }
  lines.push("");
  return lines.join("\n");
}

function buildRollbackBody(store, dialect, tables) {
  const lines = [];
  const q = (name) => quoteId(name, dialect);

  // Drop FKs first (some dialects require this)
  if (dialect !== "sqlite") {
    for (const rel of store.relationships) {
      const startTable = store.findTableById
        ? store.findTableById(rel.startTableId)
        : tables.find((t) => String(t.id) === String(rel.startTableId));
      if (!startTable) continue;
      if (dialect === "mysql" || dialect === "mariadb") {
        lines.push(`ALTER TABLE ${q(startTable.name)} DROP FOREIGN KEY ${q(rel.name)};`);
      } else {
        lines.push(`ALTER TABLE ${q(startTable.name)} DROP CONSTRAINT IF EXISTS ${q(rel.name)};`);
      }
    }
    if (lines.length > 0) lines.push("");
  }

  // Drop tables in reverse order
  for (const table of [...tables].reverse()) {
    if (dialect === "transactsql") {
      lines.push(`IF OBJECT_ID('${table.name}', 'U') IS NOT NULL DROP TABLE ${q(table.name)};`);
    } else {
      lines.push(`DROP TABLE IF EXISTS ${q(table.name)} CASCADE;`.replace(" CASCADE", dialect === "postgresql" ? " CASCADE" : ""));
    }
  }

  // Drop enums (PostgreSQL)
  if (dialect === "postgresql") {
    lines.push("");
    for (const e of store.enums) {
      lines.push(`DROP TYPE IF EXISTS "${e.name}" CASCADE;`);
    }
    for (const table of tables) {
      for (const field of table.fields) {
        if ((field.type === "ENUM" || field.type === "SET") && field.values?.length > 0) {
          lines.push(`DROP TYPE IF EXISTS "${table.name}_${field.name}_enum" CASCADE;`);
        }
      }
    }
  }

  return lines.join("\n");
}

function buildReadme(store, dialect) {
  const runCmd = getRunCommand(dialect, "schema.sql");
  return `# ${store.title || "Database Schema"}

Generated by drawdb-mcp on ${new Date().toISOString()}.

## Contents

- **schema.sql** -- creates tables, types, enums, and foreign keys
- **indices.sql** -- creates all indices (apply after schema and seed data)
- **rollback.sql** -- drops all schema objects (DESTRUCTIVE)
- **README.md** -- this file

## Stats

- Dialect: ${dialect}
- Tables: ${store.tables.length}
- Relationships: ${store.relationships.length}
- Indices: ${store.tables.reduce((sum, t) => sum + (t.indices?.length || 0), 0)}
- Enums: ${store.enums.length}
- Custom types: ${store.types.length}

## Deployment

Run the files in this order:

1. **Create the schema:**
   \`\`\`
   ${runCmd}
   \`\`\`

2. **Load any seed/initial data** (your application-specific scripts)

3. **Create indices:**
   \`\`\`
   ${getRunCommand(dialect, "indices.sql")}
   \`\`\`

## Rollback

To completely tear down the schema:

\`\`\`
${getRunCommand(dialect, "rollback.sql")}
\`\`\`

**Warning:** This will permanently delete all data in these tables.

## Tables

${store.tables.map((t) => `- \`${t.name}\`${t.comment ? ` -- ${t.comment}` : ""} (${t.fields.length} columns)`).join("\n")}

## Notes

- Indices are kept in a separate file because applying them after a bulk data load is significantly faster than maintaining them during inserts.
- Foreign key constraints are added at the end of schema.sql so tables can be created in any order.
- The schema is wrapped in a transaction where the dialect supports DDL transactions (PostgreSQL, MSSQL, Oracle). MySQL/MariaDB DDL is auto-committed.
`;
}

// --- Helpers ---

function filterTables(tables, names) {
  if (!names || names.length === 0) return tables;
  const lower = names.map((n) => n.toLowerCase());
  return tables.filter((t) => lower.includes(t.name.toLowerCase()));
}

function supportsDDLTransactions(dialect) {
  return dialect === "postgresql" || dialect === "transactsql" || dialect === "oraclesql";
}

function quoteId(name, dialect) {
  if (dialect === "mysql" || dialect === "mariadb") return "`" + name + "`";
  if (dialect === "transactsql") return "[" + name + "]";
  return '"' + name + '"';
}

function buildTypesAndEnums(store, dialect) {
  const lines = [];

  if (dialect === "postgresql") {
    for (const e of store.enums) {
      lines.push(
        `DO $$ BEGIN\n  CREATE TYPE "${e.name}" AS ENUM (${e.values.map((v) => "'" + v + "'").join(", ")});\nEXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      );
    }
    for (const t of store.types) {
      lines.push(
        `DO $$ BEGIN\n  CREATE TYPE "${t.name}" AS (${t.fields.map((f) => '"' + f.name + '" ' + f.type).join(", ")});\nEXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
      );
    }
  }

  return lines.join("\n\n");
}

function buildInlineEnumTypes(tables) {
  const lines = [];
  for (const table of tables) {
    for (const field of table.fields) {
      if ((field.type === "ENUM" || field.type === "SET") && field.values?.length > 0) {
        const typeName = `${table.name}_${field.name}_enum`;
        lines.push(
          `DO $$ BEGIN\n  CREATE TYPE "${typeName}" AS ENUM (${field.values.map((v) => "'" + v + "'").join(", ")});\nEXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
        );
      }
    }
  }
  return lines.join("\n\n");
}

function buildCreateTable(table, dialect, store) {
  const q = (name) => quoteId(name, dialect);
  const lines = [];

  for (const field of table.fields) {
    let col = "  " + q(field.name) + " " + formatType(field, table, dialect);

    if (field.increment) {
      if (dialect === "mysql" || dialect === "mariadb") col += " AUTO_INCREMENT";
      else if (dialect === "sqlite") col = "  " + q(field.name) + " INTEGER";
      else if (dialect === "transactsql") col += " IDENTITY(1,1)";
      else if (dialect === "oraclesql") col += " GENERATED ALWAYS AS IDENTITY";
    }

    if (field.notNull) col += " NOT NULL";
    if (field.unique && !(dialect === "sqlite" && field.increment)) col += " UNIQUE";

    if (
      field.default !== "" &&
      field.default !== undefined &&
      field.default !== null &&
      !field.increment
    ) {
      col += " DEFAULT " + formatDefault(field, dialect);
    }

    if (field.check) col += ` CHECK(${field.check})`;

    if (
      dialect === "sqlite" &&
      (field.type === "ENUM" || field.type === "SET") &&
      field.values?.length > 0
    ) {
      const checkVals = field.values.map((v) => "'" + v + "'").join(", ");
      col += ` CHECK(${field.name} IN (${checkVals}))`;
    }

    if ((dialect === "mysql" || dialect === "mariadb") && field.comment) {
      col += ` COMMENT '${escapeQuotes(field.comment)}'`;
    }

    if (dialect === "sqlite" && field.increment && field.primary) {
      col += " PRIMARY KEY AUTOINCREMENT";
    }

    lines.push(col);
  }

  const pks = table.fields.filter((f) => f.primary);
  if (pks.length > 0) {
    const skipPkConstraint = dialect === "sqlite" && pks.length === 1 && pks[0].increment;
    if (!skipPkConstraint) {
      lines.push(`  PRIMARY KEY (${pks.map((f) => q(f.name)).join(", ")})`);
    }
  }

  // SQLite inline FKs
  if (dialect === "sqlite") {
    const tableRels = store.relationships.filter(
      (r) => String(r.startTableId) === String(table.id),
    );
    for (const rel of tableRels) {
      const endTable = store.findTableById(rel.endTableId);
      if (!endTable) continue;
      const startField = table.fields.find((f) => String(f.id) === String(rel.startFieldId));
      const endField = endTable.fields.find((f) => String(f.id) === String(rel.endFieldId));
      if (!startField || !endField) continue;
      let fkLine = `  FOREIGN KEY (${q(startField.name)}) REFERENCES ${q(endTable.name)}(${q(endField.name)})`;
      if (rel.updateConstraint && rel.updateConstraint !== "No action") {
        fkLine += ` ON UPDATE ${rel.updateConstraint.toUpperCase()}`;
      }
      if (rel.deleteConstraint && rel.deleteConstraint !== "No action") {
        fkLine += ` ON DELETE ${rel.deleteConstraint.toUpperCase()}`;
      }
      lines.push(fkLine);
    }
  }

  let prefix = "CREATE TABLE";
  if (dialect === "mariadb") prefix = "CREATE TABLE IF NOT EXISTS";
  else if (dialect === "postgresql" || dialect === "mysql" || dialect === "sqlite")
    prefix = "CREATE TABLE IF NOT EXISTS";

  let suffix = "";
  if (dialect === "mysql" || dialect === "mariadb") {
    suffix = " ENGINE=InnoDB";
    if (table.comment) suffix += ` COMMENT='${escapeQuotes(table.comment)}'`;
  }

  return `${prefix} ${q(table.name)} (\n${lines.join(",\n")}\n)${suffix};`;
}

function buildComments(tables, dialect) {
  const lines = [];
  for (const table of tables) {
    if (table.comment) {
      lines.push(`COMMENT ON TABLE "${table.name}" IS '${escapeQuotes(table.comment)}';`);
    }
    for (const field of table.fields) {
      if (field.comment) {
        lines.push(
          `COMMENT ON COLUMN "${table.name}"."${field.name}" IS '${escapeQuotes(field.comment)}';`,
        );
      }
    }
  }
  return lines.join("\n");
}

function buildIndices(tables, dialect) {
  const lines = [];
  const q = (name) => quoteId(name, dialect);
  for (const table of tables) {
    if (!table.indices || table.indices.length === 0) continue;
    for (const idx of table.indices) {
      const unique = idx.unique ? "UNIQUE " : "";
      const cols = idx.fields.map((f) => q(f)).join(", ");
      const ifNotExists = dialect === "transactsql" ? "" : "IF NOT EXISTS ";
      lines.push(
        `CREATE ${unique}INDEX ${ifNotExists}${q(idx.name)} ON ${q(table.name)} (${cols});`,
      );
    }
  }
  return lines.join("\n");
}

function buildForeignKeys(store, dialect, tables) {
  const lines = [];
  const q = (name) => quoteId(name, dialect);
  const tableSet = new Set(tables.map((t) => String(t.id)));

  for (const rel of store.relationships) {
    if (!tableSet.has(String(rel.startTableId))) continue;
    const startTable = store.findTableById(rel.startTableId);
    const endTable = store.findTableById(rel.endTableId);
    if (!startTable || !endTable) continue;
    const startField = startTable.fields.find((f) => String(f.id) === String(rel.startFieldId));
    const endField = endTable.fields.find((f) => String(f.id) === String(rel.endFieldId));
    if (!startField || !endField) continue;

    let fk = `ALTER TABLE ${q(startTable.name)} ADD CONSTRAINT ${q(rel.name)} FOREIGN KEY (${q(startField.name)}) REFERENCES ${q(endTable.name)}(${q(endField.name)})`;
    if (rel.updateConstraint && rel.updateConstraint !== "No action") {
      fk += ` ON UPDATE ${rel.updateConstraint.toUpperCase()}`;
    }
    if (rel.deleteConstraint && rel.deleteConstraint !== "No action") {
      fk += ` ON DELETE ${rel.deleteConstraint.toUpperCase()}`;
    }
    fk += ";";
    lines.push(fk);
  }

  return lines.join("\n");
}

function formatType(field, table, dialect) {
  let type = (field.type || "VARCHAR").toUpperCase();

  if (dialect === "postgresql") {
    if (field.increment) {
      if (type === "BIGINT") return "BIGSERIAL";
      return "SERIAL";
    }
    if (type === "TIMESTAMP" || type === "DATETIME") return "TIMESTAMPTZ";
    if ((type === "ENUM" || type === "SET") && field.values) {
      return '"' + table.name + "_" + field.name + '_enum"';
    }
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  if (dialect === "mysql" || dialect === "mariadb") {
    if ((type === "ENUM" || type === "SET") && field.values) {
      return type + "(" + field.values.map((v) => "'" + v + "'").join(", ") + ")";
    }
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  if (dialect === "sqlite") {
    if (field.increment) return "INTEGER";
    if (type === "UUID") return "TEXT";
    if (type === "BOOLEAN") return "INTEGER";
    if (type === "TIMESTAMP" || type === "DATETIME" || type === "TIMESTAMPTZ") return "TEXT";
    if (type === "DECIMAL" || type === "NUMERIC") return "REAL";
    if (type === "ENUM" || type === "SET") return "TEXT";
    if (type === "BIGINT") return "INTEGER";
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  if (dialect === "transactsql") {
    if (type === "VARCHAR") return "NVARCHAR(" + (field.size || "255") + ")";
    if (type === "TEXT") return "NVARCHAR(MAX)";
    if (type === "BOOLEAN") return "BIT";
    if (type === "UUID") return "UNIQUEIDENTIFIER";
    if (type === "TIMESTAMP" || type === "DATETIME") return "DATETIME2";
    if (type === "TIMESTAMPTZ") return "DATETIMEOFFSET";
    if ((type === "ENUM" || type === "SET") && field.values) return "NVARCHAR(50)";
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  if (dialect === "oraclesql") {
    if (type === "VARCHAR") return "VARCHAR2(" + (field.size || "255") + ")";
    if (type === "TEXT") return "CLOB";
    if (type === "BOOLEAN") return "NUMBER(1)";
    if (type === "UUID") return "RAW(16)";
    if (type === "TIMESTAMP" || type === "DATETIME" || type === "TIMESTAMPTZ")
      return "TIMESTAMP WITH TIME ZONE";
    if (type === "INT" || type === "INTEGER") return "NUMBER(10)";
    if (type === "BIGINT") return "NUMBER(19)";
    if (type === "SMALLINT") return "NUMBER(5)";
    if ((type === "ENUM" || type === "SET") && field.values) return "VARCHAR2(50)";
    if (type === "DECIMAL" || type === "NUMERIC") return type + "(" + (field.size || "18,2") + ")";
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  if ((type === "ENUM" || type === "SET") && field.values) {
    return type + "(" + field.values.map((v) => "'" + v + "'").join(", ") + ")";
  }
  if (field.size) return type + "(" + field.size + ")";
  return type;
}

function formatDefault(field, dialect) {
  const val = field.default;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  const upper = String(val).toUpperCase();
  if (
    upper === "NULL" ||
    upper === "CURRENT_TIMESTAMP" ||
    upper === "NOW()" ||
    String(val).startsWith("(")
  ) {
    if (dialect === "oraclesql" && upper === "CURRENT_TIMESTAMP") return "SYSTIMESTAMP";
    if (dialect === "transactsql" && upper === "CURRENT_TIMESTAMP") return "SYSDATETIME()";
    return String(val);
  }
  return "'" + escapeQuotes(String(val)) + "'";
}

function escapeQuotes(str) {
  return String(str).replace(/'/g, "''");
}

function getRunCommand(dialect, file) {
  const fname = basename(file);
  switch (dialect) {
    case "postgresql":
      return `psql -h <host> -U <user> -d <dbname> -f ${fname}`;
    case "mysql":
      return `mysql -h <host> -u <user> -p <dbname> < ${fname}`;
    case "mariadb":
      return `mariadb -h <host> -u <user> -p <dbname> < ${fname}`;
    case "sqlite":
      return `sqlite3 <dbfile> < ${fname}`;
    case "transactsql":
      return `sqlcmd -S <server> -d <dbname> -U <user> -P <password> -i ${fname}`;
    case "oraclesql":
      return `sqlplus <user>/<password>@<connection> @${fname}`;
    default:
      return `<run ${fname} against your database>`;
  }
}
