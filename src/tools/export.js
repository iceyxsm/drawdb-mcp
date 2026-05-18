import { z } from "zod";

/**
 * Register export tools for generating SQL DDL, DBML, and other formats.
 */
export function registerExportTools(server, store) {
  // --- export_ddl ---
  server.tool(
    "export_ddl",
    "Export the full schema as SQL DDL statements for the diagram's database dialect (or a specified one)",
    {
      dialect: z
        .enum(["mysql", "postgresql", "sqlite", "mariadb", "transactsql", "oraclesql"])
        .optional()
        .describe("Target SQL dialect. Defaults to the diagram's database setting."),
      tables: z
        .array(z.string())
        .optional()
        .describe("Subset of table names to export. Exports all if omitted."),
    },
    async ({ dialect, tables: tableNames }) => {
      const db = dialect || store.database;
      const ddl = generateDDL(store, db, tableNames);
      return { content: [{ type: "text", text: ddl }] };
    },
  );

  // --- export_dbml ---
  server.tool(
    "export_dbml",
    "Export the schema in DBML format (human-readable, database-agnostic)",
    {},
    async () => {
      const dbml = generateDBML(store);
      return { content: [{ type: "text", text: dbml }] };
    },
  );

  // --- export_json ---
  server.tool(
    "export_json",
    "Export the full diagram as JSON (the native DrawDB format)",
    {},
    async () => {
      const json = JSON.stringify(store.diagram, null, 2);
      return { content: [{ type: "text", text: json }] };
    },
  );
}

// --- DDL Generation ---

function quoteId(name, dialect) {
  if (dialect === "mysql" || dialect === "mariadb") return "`" + name + "`";
  if (dialect === "transactsql") return "[" + name + "]";
  // PostgreSQL, Oracle, SQLite use double quotes
  return '"' + name + '"';
}

function generateDDL(store, dialect, tableNames) {
  let tables = store.tables;
  if (tableNames && tableNames.length > 0) {
    const names = tableNames.map((n) => n.toLowerCase());
    tables = tables.filter((t) => names.includes(t.name.toLowerCase()));
  }

  const statements = [];

  // --- Enums ---
  if (dialect === "postgresql") {
    // PostgreSQL: CREATE TYPE for enums defined in the schema
    if (store.enums.length > 0) {
      for (const e of store.enums) {
        statements.push(
          `CREATE TYPE "${e.name}" AS ENUM (\n${e.values.map((v) => "  '" + v + "'").join(",\n")}\n);`,
        );
      }
      statements.push("");
    }
    // Also create types for inline ENUM fields
    for (const table of tables) {
      for (const field of table.fields) {
        if ((field.type === "ENUM" || field.type === "SET") && field.values && field.values.length > 0) {
          const typeName = table.name + "_" + field.name + "_enum";
          statements.push(
            `CREATE TYPE "${typeName}" AS ENUM (\n${field.values.map((v) => "  '" + v + "'").join(",\n")}\n);`,
          );
        }
      }
    }
    if (statements.length > 0 && statements[statements.length - 1] !== "") {
      statements.push("");
    }
  }

  // --- Tables ---
  for (const table of tables) {
    const q = (name) => quoteId(name, dialect);
    const lines = [];

    for (const field of table.fields) {
      let col = "  " + q(field.name) + " " + formatType(field, table, dialect);

      // Auto-increment handling
      if (field.increment) {
        if (dialect === "mysql" || dialect === "mariadb") {
          // Type already set, add AUTO_INCREMENT
          col += " AUTO_INCREMENT";
        } else if (dialect === "sqlite") {
          // SQLite: INTEGER PRIMARY KEY AUTOINCREMENT
          // Override the type to INTEGER for autoincrement
          col = "  " + q(field.name) + " INTEGER";
          // PRIMARY KEY AUTOINCREMENT is added inline for SQLite
        } else if (dialect === "transactsql") {
          col += " IDENTITY(1,1)";
        } else if (dialect === "oraclesql") {
          col += " GENERATED ALWAYS AS IDENTITY";
        }
        // PostgreSQL: handled in formatType (SERIAL/BIGSERIAL)
      }

      if (field.notNull) col += " NOT NULL";
      if (field.unique && !(dialect === "sqlite" && field.increment)) col += " UNIQUE";

      if (field.default !== "" && field.default !== undefined && field.default !== null) {
        // Skip default for auto-increment columns
        if (!field.increment) {
          col += " DEFAULT " + formatDefault(field, dialect);
        }
      }

      if (field.check) {
        col += " CHECK(" + field.check + ")";
      }

      // SQLite: ENUM as CHECK constraint
      if (dialect === "sqlite" && (field.type === "ENUM" || field.type === "SET") && field.values && field.values.length > 0) {
        const checkVals = field.values.map((v) => "'" + v + "'").join(", ");
        col += " CHECK(" + field.name + " IN (" + checkVals + "))";
      }

      // MySQL/MariaDB: inline column comment
      if ((dialect === "mysql" || dialect === "mariadb") && field.comment) {
        col += " COMMENT '" + escapeQuotes(field.comment) + "'";
      }

      // SQLite: PRIMARY KEY AUTOINCREMENT inline
      if (dialect === "sqlite" && field.increment && field.primary) {
        col += " PRIMARY KEY AUTOINCREMENT";
      }

      lines.push(col);
    }

    // Primary key constraint (skip for SQLite autoincrement which is inline)
    const pks = table.fields.filter((f) => f.primary);
    if (pks.length > 0) {
      const skipPkConstraint = dialect === "sqlite" && pks.length === 1 && pks[0].increment;
      if (!skipPkConstraint) {
        lines.push("  PRIMARY KEY (" + pks.map((f) => q(f.name)).join(", ") + ")");
      }
    }

    // SQLite: inline foreign keys (since ALTER TABLE ADD CONSTRAINT is not supported)
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

        let fkLine = "  FOREIGN KEY (" + q(startField.name) + ") REFERENCES " + q(endTable.name) + "(" + q(endField.name) + ")";
        if (rel.updateConstraint && rel.updateConstraint !== "No action") {
          fkLine += " ON UPDATE " + rel.updateConstraint.toUpperCase();
        }
        if (rel.deleteConstraint && rel.deleteConstraint !== "No action") {
          fkLine += " ON DELETE " + rel.deleteConstraint.toUpperCase();
        }
        lines.push(fkLine);
      }
    }

    // Build CREATE TABLE statement
    let createPrefix = "CREATE TABLE";
    if (dialect === "mariadb") {
      createPrefix = "CREATE OR REPLACE TABLE";
    }

    let tableSuffix = "";
    if (dialect === "mysql" || dialect === "mariadb") {
      tableSuffix = " ENGINE=InnoDB";
      if (table.comment) {
        tableSuffix += " COMMENT='" + escapeQuotes(table.comment) + "'";
      }
    }

    const createStmt = createPrefix + " " + q(table.name) + " (\n" + lines.join(",\n") + "\n)" + tableSuffix + ";";
    statements.push(createStmt);

    // PostgreSQL: COMMENT ON TABLE and COMMENT ON COLUMN
    if (dialect === "postgresql") {
      if (table.comment) {
        statements.push(
          'COMMENT ON TABLE "' + table.name + '" IS \'' + escapeQuotes(table.comment) + "';",
        );
      }
      for (const field of table.fields) {
        if (field.comment) {
          statements.push(
            'COMMENT ON COLUMN "' + table.name + '"."' + field.name + '" IS \'' + escapeQuotes(field.comment) + "';",
          );
        }
      }
    }

    // Oracle: COMMENT ON TABLE and COMMENT ON COLUMN
    if (dialect === "oraclesql") {
      if (table.comment) {
        statements.push(
          'COMMENT ON TABLE "' + table.name + '" IS \'' + escapeQuotes(table.comment) + "';",
        );
      }
      for (const field of table.fields) {
        if (field.comment) {
          statements.push(
            'COMMENT ON COLUMN "' + table.name + '"."' + field.name + '" IS \'' + escapeQuotes(field.comment) + "';",
          );
        }
      }
    }

    // Indices (CREATE INDEX statements)
    if (table.indices && table.indices.length > 0) {
      for (const idx of table.indices) {
        const unique = idx.unique ? "UNIQUE " : "";
        const cols = idx.fields.map((f) => q(f)).join(", ");
        if (dialect === "postgresql" && !idx.unique) {
          // PostgreSQL: CREATE INDEX CONCURRENTLY for non-unique indices
          statements.push(
            "CREATE INDEX CONCURRENTLY " + q(idx.name) + " ON " + q(table.name) + " (" + cols + ");",
          );
        } else {
          statements.push(
            "CREATE " + unique + "INDEX " + q(idx.name) + " ON " + q(table.name) + " (" + cols + ");",
          );
        }
      }
    }

    statements.push("");

    // MSSQL: GO separator after each table block
    if (dialect === "transactsql") {
      statements.push("GO");
      statements.push("");
    }
  }

  // --- Foreign keys as ALTER TABLE (all dialects except SQLite) ---
  if (dialect !== "sqlite") {
    const rels = tableNames
      ? store.relationships.filter((r) => {
          const startT = store.findTableById(r.startTableId);
          return startT && tables.includes(startT);
        })
      : store.relationships;

    for (const rel of rels) {
      const startTable = store.findTableById(rel.startTableId);
      const endTable = store.findTableById(rel.endTableId);
      if (!startTable || !endTable) continue;

      const startField = startTable.fields.find(
        (f) => String(f.id) === String(rel.startFieldId),
      );
      const endField = endTable.fields.find(
        (f) => String(f.id) === String(rel.endFieldId),
      );
      if (!startField || !endField) continue;

      const q = (name) => quoteId(name, dialect);
      let fk = "ALTER TABLE " + q(startTable.name) + " ADD CONSTRAINT " + q(rel.name) + " FOREIGN KEY (" + q(startField.name) + ") REFERENCES " + q(endTable.name) + "(" + q(endField.name) + ")";

      if (rel.updateConstraint && rel.updateConstraint !== "No action") {
        fk += " ON UPDATE " + rel.updateConstraint.toUpperCase();
      }
      if (rel.deleteConstraint && rel.deleteConstraint !== "No action") {
        fk += " ON DELETE " + rel.deleteConstraint.toUpperCase();
      }
      fk += ";";
      statements.push(fk);
    }

    if (dialect === "transactsql" && rels.length > 0) {
      statements.push("");
      statements.push("GO");
    }
  }

  return statements.join("\n");
}

function formatType(field, table, dialect) {
  let type = (field.type || "VARCHAR").toUpperCase();

  // --- PostgreSQL specifics ---
  if (dialect === "postgresql") {
    if (field.increment) {
      if (type === "BIGINT") return "BIGSERIAL";
      return "SERIAL";
    }
    if (type === "UUID") return "UUID";
    if (type === "TIMESTAMP" || type === "DATETIME") return "TIMESTAMPTZ";
    if (type === "BOOLEAN") return "BOOLEAN";
    if ((type === "ENUM" || type === "SET") && field.values) {
      // Reference the created type
      return '"' + table.name + "_" + field.name + '_enum"';
    }
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  // --- MySQL / MariaDB specifics ---
  if (dialect === "mysql" || dialect === "mariadb") {
    if ((type === "ENUM" || type === "SET") && field.values) {
      return type + "(" + field.values.map((v) => "'" + v + "'").join(", ") + ")";
    }
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  // --- SQLite specifics ---
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

  // --- MSSQL (transactsql) specifics ---
  if (dialect === "transactsql") {
    if (type === "VARCHAR") {
      return "NVARCHAR(" + (field.size || "255") + ")";
    }
    if (type === "TEXT") return "NVARCHAR(MAX)";
    if (type === "BOOLEAN") return "BIT";
    if (type === "UUID") return "UNIQUEIDENTIFIER";
    if (type === "TIMESTAMP") return "DATETIME2";
    if (type === "DATETIME") return "DATETIME2";
    if (type === "TIMESTAMPTZ") return "DATETIMEOFFSET";
    if ((type === "ENUM" || type === "SET") && field.values) {
      // MSSQL has no ENUM, use NVARCHAR with CHECK
      return "NVARCHAR(50)";
    }
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  // --- Oracle specifics ---
  if (dialect === "oraclesql") {
    if (type === "VARCHAR") return "VARCHAR2(" + (field.size || "255") + ")";
    if (type === "TEXT") return "CLOB";
    if (type === "BOOLEAN") return "NUMBER(1)";
    if (type === "UUID") return "RAW(16)";
    if (type === "TIMESTAMP" || type === "DATETIME") return "TIMESTAMP WITH TIME ZONE";
    if (type === "TIMESTAMPTZ") return "TIMESTAMP WITH TIME ZONE";
    if (type === "INT" || type === "INTEGER") return "NUMBER(10)";
    if (type === "BIGINT") return "NUMBER(19)";
    if (type === "SMALLINT") return "NUMBER(5)";
    if ((type === "ENUM" || type === "SET") && field.values) {
      return "VARCHAR2(50)";
    }
    if (type === "DECIMAL" || type === "NUMERIC") {
      return type + "(" + (field.size || "18,2") + ")";
    }
    if (field.size) return type + "(" + field.size + ")";
    return type;
  }

  // --- Fallback ---
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
  if (upper === "NULL" || upper === "CURRENT_TIMESTAMP" || upper === "NOW()" || String(val).startsWith("(")) {
    // Oracle uses SYSTIMESTAMP instead of CURRENT_TIMESTAMP
    if (dialect === "oraclesql" && upper === "CURRENT_TIMESTAMP") {
      return "SYSTIMESTAMP";
    }
    // MSSQL uses GETDATE() or SYSDATETIME()
    if (dialect === "transactsql" && upper === "CURRENT_TIMESTAMP") {
      return "SYSDATETIME()";
    }
    return String(val);
  }
  return "'" + escapeQuotes(String(val)) + "'";
}

function escapeQuotes(str) {
  return str.replace(/'/g, "''");
}

// --- DBML Generation ---

function generateDBML(store) {
  const lines = [];

  // Enums
  for (const e of store.enums) {
    lines.push("enum " + quoteDbml(e.name) + " {");
    for (const v of e.values) {
      lines.push("  " + quoteDbml(v));
    }
    lines.push("}\n");
  }

  // Tables
  for (const table of store.tables) {
    const header = table.comment
      ? "Table " + quoteDbml(table.name) + " [note: '" + escapeQuotes(table.comment) + "'] {"
      : "Table " + quoteDbml(table.name) + " {";
    lines.push(header);

    for (const field of table.fields) {
      let line = "  " + quoteDbml(field.name) + " " + field.type.toLowerCase();
      const settings = [];
      if (field.primary) settings.push("pk");
      if (field.increment) settings.push("increment");
      if (field.notNull) settings.push("not null");
      if (field.unique) settings.push("unique");
      if (field.default !== "" && field.default !== undefined) {
        settings.push("default: '" + field.default + "'");
      }
      if (field.comment) settings.push("note: '" + escapeQuotes(field.comment) + "'");
      if (settings.length > 0) line += " [" + settings.join(", ") + "]";
      lines.push(line);
    }

    // Indices
    if (table.indices && table.indices.length > 0) {
      lines.push("");
      lines.push("  indexes {");
      for (const idx of table.indices) {
        const cols = idx.fields.map((f) => quoteDbml(f)).join(", ");
        const opts = [];
        if (idx.name) opts.push("name: '" + idx.name + "'");
        if (idx.unique) opts.push("unique");
        const optStr = opts.length > 0 ? " [" + opts.join(", ") + "]" : "";
        lines.push("    (" + cols + ")" + optStr);
      }
      lines.push("  }");
    }

    lines.push("}\n");
  }

  // Relationships
  for (const rel of store.relationships) {
    const startTable = store.findTableById(rel.startTableId);
    const endTable = store.findTableById(rel.endTableId);
    if (!startTable || !endTable) continue;

    const startField = startTable.fields.find(
      (f) => String(f.id) === String(rel.startFieldId),
    );
    const endField = endTable.fields.find(
      (f) => String(f.id) === String(rel.endFieldId),
    );
    if (!startField || !endField) continue;

    const card = dbmlCardinality(rel.cardinality);
    const settings = [];
    if (rel.deleteConstraint && rel.deleteConstraint !== "No action") {
      settings.push("delete: " + rel.deleteConstraint.toLowerCase());
    }
    if (rel.updateConstraint && rel.updateConstraint !== "No action") {
      settings.push("update: " + rel.updateConstraint.toLowerCase());
    }
    const settingsStr = settings.length > 0 ? " [" + settings.join(", ") + "]" : "";

    lines.push("Ref " + quoteDbml(rel.name) + " {");
    lines.push(
      "  " + quoteDbml(startTable.name) + "." + quoteDbml(startField.name) + " " + card + " " + quoteDbml(endTable.name) + "." + quoteDbml(endField.name) + settingsStr,
    );
    lines.push("}\n");
  }

  return lines.join("\n");
}

function dbmlCardinality(cardinality) {
  switch (cardinality) {
    case "one_to_one":
      return "-";
    case "one_to_many":
      return "<";
    case "many_to_one":
      return ">";
    default:
      return "-";
  }
}

function quoteDbml(name) {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  return '"' + name + '"';
}
