import { z } from "zod";

/**
 * Register migration tools for generating schema diffs and ALTER statements.
 */
export function registerMigrationTools(server, store) {
  // --- snapshot_schema ---
  server.tool(
    "snapshot_schema",
    "Returns the current diagram state as a JSON string. Save this as a baseline to later generate migrations by comparing against the current state.",
    {},
    async () => {
      const snapshot = JSON.stringify(store.diagram, null, 2);
      return { content: [{ type: "text", text: snapshot }] };
    },
  );

  // --- generate_migration ---
  server.tool(
    "generate_migration",
    "Generate ALTER TABLE migration SQL by comparing a previous schema snapshot to the current diagram state. Outputs safe migration statements for the current dialect.",
    {
      from_snapshot: z
        .string()
        .describe("JSON string of the previous diagram state (from snapshot_schema)"),
      dialect: z
        .enum(["mysql", "postgresql", "sqlite", "mariadb", "transactsql", "oraclesql"])
        .optional()
        .describe("Target SQL dialect. Defaults to the diagram's database setting."),
    },
    async ({ from_snapshot, dialect }) => {
      let oldDiagram;
      try {
        oldDiagram = JSON.parse(from_snapshot);
      } catch (e) {
        return {
          content: [{ type: "text", text: "Error: Invalid JSON in from_snapshot." }],
          isError: true,
        };
      }

      const db = dialect || store.database;
      const currentDiagram = store.diagram;

      const statements = generateMigrationStatements(oldDiagram, currentDiagram, db);

      if (statements.length === 0) {
        return {
          content: [{ type: "text", text: "-- No changes detected between snapshots." }],
        };
      }

      const header = `-- Migration generated for dialect: ${db}\n-- Changes detected: ${statements.length} statement(s)\n`;
      const sql = header + "\n" + statements.join("\n\n");

      return { content: [{ type: "text", text: sql }] };
    },
  );
}

// --- Migration Generation Logic ---

function quoteId(name, dialect) {
  if (dialect === "mysql" || dialect === "mariadb") return "`" + name + "`";
  if (dialect === "transactsql") return "[" + name + "]";
  return '"' + name + '"';
}

function generateMigrationStatements(oldDiagram, newDiagram, dialect) {
  const statements = [];
  const q = (name) => quoteId(name, dialect);

  const oldTables = oldDiagram.tables || [];
  const newTables = newDiagram.tables || [];
  const oldRels = oldDiagram.relationships || [];
  const newRels = newDiagram.relationships || [];

  const oldTableMap = new Map(oldTables.map((t) => [String(t.id), t]));
  const newTableMap = new Map(newTables.map((t) => [String(t.id), t]));
  const oldTableByName = new Map(oldTables.map((t) => [t.name.toLowerCase(), t]));
  const newTableByName = new Map(newTables.map((t) => [t.name.toLowerCase(), t]));

  // --- Added tables ---
  for (const table of newTables) {
    if (!oldTableMap.has(String(table.id)) && !oldTableByName.has(table.name.toLowerCase())) {
      statements.push(generateCreateTable(table, dialect));
    }
  }

  // --- Removed tables ---
  for (const table of oldTables) {
    if (!newTableMap.has(String(table.id)) && !newTableByName.has(table.name.toLowerCase())) {
      statements.push(`DROP TABLE IF EXISTS ${q(table.name)};`);
    }
  }

  // --- Modified tables (column changes) ---
  for (const newTable of newTables) {
    const oldTable = oldTableMap.get(String(newTable.id)) || oldTableByName.get(newTable.name.toLowerCase());
    if (!oldTable) continue;

    const oldFieldMap = new Map(oldTable.fields.map((f) => [String(f.id), f]));
    const newFieldMap = new Map(newTable.fields.map((f) => [String(f.id), f]));
    const oldFieldByName = new Map(oldTable.fields.map((f) => [f.name.toLowerCase(), f]));
    const newFieldByName = new Map(newTable.fields.map((f) => [f.name.toLowerCase(), f]));

    // Added columns
    for (const field of newTable.fields) {
      if (!oldFieldMap.has(String(field.id)) && !oldFieldByName.has(field.name.toLowerCase())) {
        const colDef = buildColumnDef(field, dialect);
        let stmt = `ALTER TABLE ${q(newTable.name)} ADD COLUMN ${q(field.name)} ${colDef}`;
        // Add safe default for NOT NULL columns
        if (field.notNull && !field.default && !field.primary && !field.increment) {
          const safeDefault = getSafeDefault(field.type);
          if (safeDefault !== null) {
            stmt += ` DEFAULT ${safeDefault}`;
          }
        }
        stmt += ";";
        statements.push(stmt);
      }
    }

    // Removed columns
    for (const field of oldTable.fields) {
      if (!newFieldMap.has(String(field.id)) && !newFieldByName.has(field.name.toLowerCase())) {
        if (dialect === "sqlite") {
          statements.push(`-- SQLite: Cannot drop column ${q(field.name)} from ${q(newTable.name)}. Requires table rebuild.`);
        } else {
          statements.push(`ALTER TABLE ${q(newTable.name)} DROP COLUMN ${q(field.name)};`);
        }
      }
    }

    // Modified columns
    for (const newField of newTable.fields) {
      const oldField = oldFieldMap.get(String(newField.id)) || oldFieldByName.get(newField.name.toLowerCase());
      if (!oldField) continue;

      const changes = detectColumnChanges(oldField, newField);
      if (changes.length === 0) continue;

      if (dialect === "sqlite") {
        statements.push(`-- SQLite: Cannot ALTER COLUMN ${q(oldField.name)} in ${q(newTable.name)}. Requires table rebuild.`);
        statements.push(`-- Changes: ${changes.join(", ")}`);
      } else if (dialect === "mysql" || dialect === "mariadb") {
        const colDef = buildColumnDef(newField, dialect);
        statements.push(`ALTER TABLE ${q(newTable.name)} MODIFY COLUMN ${q(newField.name)} ${colDef};`);
      } else if (dialect === "transactsql") {
        const colDef = buildColumnDef(newField, dialect);
        statements.push(`ALTER TABLE ${q(newTable.name)} ALTER COLUMN ${q(newField.name)} ${colDef};`);
      } else {
        // PostgreSQL, Oracle
        for (const change of changes) {
          if (change === "type") {
            const typeDef = formatMigrationType(newField, dialect);
            statements.push(`ALTER TABLE ${q(newTable.name)} ALTER COLUMN ${q(newField.name)} TYPE ${typeDef};`);
          } else if (change === "notNull_added") {
            statements.push(`ALTER TABLE ${q(newTable.name)} ALTER COLUMN ${q(newField.name)} SET NOT NULL;`);
          } else if (change === "notNull_removed") {
            statements.push(`ALTER TABLE ${q(newTable.name)} ALTER COLUMN ${q(newField.name)} DROP NOT NULL;`);
          } else if (change === "default_changed") {
            if (newField.default) {
              statements.push(`ALTER TABLE ${q(newTable.name)} ALTER COLUMN ${q(newField.name)} SET DEFAULT ${formatDefaultValue(newField)};`);
            } else {
              statements.push(`ALTER TABLE ${q(newTable.name)} ALTER COLUMN ${q(newField.name)} DROP DEFAULT;`);
            }
          } else if (change === "rename") {
            statements.push(`ALTER TABLE ${q(newTable.name)} RENAME COLUMN ${q(oldField.name)} TO ${q(newField.name)};`);
          }
        }
      }
    }

    // --- Index changes ---
    const oldIndices = oldTable.indices || [];
    const newIndices = newTable.indices || [];
    const oldIdxNames = new Set(oldIndices.map((i) => i.name.toLowerCase()));
    const newIdxNames = new Set(newIndices.map((i) => i.name.toLowerCase()));

    // Added indices
    for (const idx of newIndices) {
      if (!oldIdxNames.has(idx.name.toLowerCase())) {
        const unique = idx.unique ? "UNIQUE " : "";
        const cols = idx.fields.map((f) => q(f)).join(", ");
        if (dialect === "postgresql") {
          const concurrently = idx.unique ? "" : " CONCURRENTLY";
          statements.push(`CREATE ${unique}INDEX${concurrently} ${q(idx.name)} ON ${q(newTable.name)} (${cols});`);
        } else {
          statements.push(`CREATE ${unique}INDEX ${q(idx.name)} ON ${q(newTable.name)} (${cols});`);
        }
      }
    }

    // Removed indices
    for (const idx of oldIndices) {
      if (!newIdxNames.has(idx.name.toLowerCase())) {
        if (dialect === "mysql" || dialect === "mariadb") {
          statements.push(`DROP INDEX ${q(idx.name)} ON ${q(newTable.name)};`);
        } else {
          statements.push(`DROP INDEX IF EXISTS ${q(idx.name)};`);
        }
      }
    }
  }

  // --- Relationship changes (FK constraints) ---
  const oldRelMap = new Map(oldRels.map((r) => [r.name.toLowerCase(), r]));
  const newRelMap = new Map(newRels.map((r) => [r.name.toLowerCase(), r]));

  // Added relationships
  for (const rel of newRels) {
    if (!oldRelMap.has(rel.name.toLowerCase())) {
      const startTable = newTables.find((t) => String(t.id) === String(rel.startTableId));
      const endTable = newTables.find((t) => String(t.id) === String(rel.endTableId));
      if (!startTable || !endTable) continue;

      const startField = startTable.fields.find((f) => String(f.id) === String(rel.startFieldId));
      const endField = endTable.fields.find((f) => String(f.id) === String(rel.endFieldId));
      if (!startField || !endField) continue;

      if (dialect === "sqlite") {
        statements.push(`-- SQLite: Cannot add FK constraint after table creation. FK: ${rel.name}`);
      } else {
        let fk = `ALTER TABLE ${q(startTable.name)} ADD CONSTRAINT ${q(rel.name)} FOREIGN KEY (${q(startField.name)}) REFERENCES ${q(endTable.name)}(${q(endField.name)})`;
        if (rel.updateConstraint && rel.updateConstraint !== "No action") {
          fk += ` ON UPDATE ${rel.updateConstraint.toUpperCase()}`;
        }
        if (rel.deleteConstraint && rel.deleteConstraint !== "No action") {
          fk += ` ON DELETE ${rel.deleteConstraint.toUpperCase()}`;
        }
        fk += ";";
        statements.push(fk);
      }
    }
  }

  // Removed relationships
  for (const rel of oldRels) {
    if (!newRelMap.has(rel.name.toLowerCase())) {
      const startTable = oldTables.find((t) => String(t.id) === String(rel.startTableId));
      if (!startTable) continue;

      // Find the table in new diagram (it might have been renamed)
      const currentTable = newTables.find((t) => String(t.id) === String(rel.startTableId)) || startTable;

      if (dialect === "sqlite") {
        statements.push(`-- SQLite: Cannot drop FK constraint. FK: ${rel.name}`);
      } else if (dialect === "mysql" || dialect === "mariadb") {
        statements.push(`ALTER TABLE ${q(currentTable.name)} DROP FOREIGN KEY ${q(rel.name)};`);
      } else {
        statements.push(`ALTER TABLE ${q(currentTable.name)} DROP CONSTRAINT IF EXISTS ${q(rel.name)};`);
      }
    }
  }

  return statements;
}

function generateCreateTable(table, dialect) {
  const q = (name) => quoteId(name, dialect);
  const lines = [];

  for (const field of table.fields) {
    const colDef = buildColumnDef(field, dialect);
    lines.push(`  ${q(field.name)} ${colDef}`);
  }

  const pks = table.fields.filter((f) => f.primary);
  if (pks.length > 0) {
    lines.push(`  PRIMARY KEY (${pks.map((f) => q(f.name)).join(", ")})`);
  }

  let prefix = "CREATE TABLE";
  if (dialect === "mariadb") {
    prefix = "CREATE TABLE IF NOT EXISTS";
  }

  let suffix = "";
  if (dialect === "mysql" || dialect === "mariadb") {
    suffix = " ENGINE=InnoDB";
  }

  return `${prefix} ${q(table.name)} (\n${lines.join(",\n")}\n)${suffix};`;
}

function buildColumnDef(field, dialect) {
  let parts = [];
  let typeDef = formatMigrationType(field, dialect);

  if (field.increment) {
    if (dialect === "mysql" || dialect === "mariadb") {
      parts.push(typeDef);
      parts.push("AUTO_INCREMENT");
    } else if (dialect === "postgresql") {
      // Use SERIAL/BIGSERIAL
      if (field.type.toUpperCase() === "BIGINT") {
        parts.push("BIGSERIAL");
      } else {
        parts.push("SERIAL");
      }
    } else if (dialect === "sqlite") {
      parts.push("INTEGER");
      // AUTOINCREMENT only with INTEGER PRIMARY KEY in SQLite
    } else if (dialect === "transactsql") {
      parts.push(typeDef);
      parts.push("IDENTITY(1,1)");
    } else if (dialect === "oraclesql") {
      parts.push(typeDef);
      parts.push("GENERATED ALWAYS AS IDENTITY");
    } else {
      parts.push(typeDef);
    }
  } else {
    parts.push(typeDef);
  }

  if (field.notNull) parts.push("NOT NULL");
  if (field.unique) parts.push("UNIQUE");
  if (field.default !== "" && field.default !== undefined && field.default !== null && !field.increment) {
    parts.push("DEFAULT " + formatDefaultValue(field));
  }
  if (field.check) parts.push("CHECK(" + field.check + ")");

  return parts.join(" ");
}

function formatMigrationType(field, dialect) {
  let type = field.type ? field.type.toUpperCase() : "VARCHAR";

  // Dialect-specific type mappings
  if (dialect === "transactsql") {
    if (type === "VARCHAR" || type === "TEXT") {
      type = field.size ? `NVARCHAR(${field.size})` : "NVARCHAR(MAX)";
      return type;
    }
    if (type === "BOOLEAN") return "BIT";
  }

  if (dialect === "oraclesql") {
    if (type === "VARCHAR") type = "VARCHAR2";
    if (type === "BOOLEAN") return "NUMBER(1)";
    if (type === "TEXT") return "CLOB";
    if (field.size) return `${type}(${field.size})`;
    return type;
  }

  if (dialect === "postgresql") {
    if (type === "TIMESTAMP") return "TIMESTAMPTZ";
    if (type === "DATETIME") return "TIMESTAMPTZ";
  }

  if ((type === "ENUM" || type === "SET") && field.values) {
    if (dialect === "sqlite") {
      // SQLite has no ENUM, use TEXT with CHECK
      return "TEXT";
    }
    if (dialect === "postgresql") {
      return "TEXT"; // Would use CREATE TYPE separately
    }
    // MySQL/MariaDB inline ENUM
    return `${type}(${field.values.map((v) => "'" + v + "'").join(", ")})`;
  }

  if (field.size) return `${type}(${field.size})`;
  return type;
}

function formatDefaultValue(field) {
  const val = field.default;
  if (val === "" || val === undefined || val === null) return "NULL";
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  const upper = String(val).toUpperCase();
  if (upper === "NULL" || upper === "CURRENT_TIMESTAMP" || upper === "NOW()" || String(val).startsWith("(")) {
    return String(val);
  }
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function getSafeDefault(type) {
  const upper = (type || "").toUpperCase();
  if (upper.includes("INT") || upper.includes("SERIAL") || upper === "BIGINT") return "0";
  if (upper.includes("VARCHAR") || upper === "TEXT" || upper.includes("CHAR")) return "''";
  if (upper === "BOOLEAN" || upper === "BIT") return "false";
  if (upper.includes("DECIMAL") || upper.includes("NUMERIC") || upper === "FLOAT" || upper === "DOUBLE") return "0";
  if (upper === "TIMESTAMP" || upper === "TIMESTAMPTZ" || upper === "DATETIME") return "CURRENT_TIMESTAMP";
  if (upper === "UUID") return null;
  return null;
}

function detectColumnChanges(oldField, newField) {
  const changes = [];

  if (oldField.name !== newField.name) {
    changes.push("rename");
  }

  const oldType = (oldField.type || "").toUpperCase();
  const newType = (newField.type || "").toUpperCase();
  const oldSize = String(oldField.size || "");
  const newSize = String(newField.size || "");

  if (oldType !== newType || oldSize !== newSize) {
    changes.push("type");
  }

  if (!oldField.notNull && newField.notNull) {
    changes.push("notNull_added");
  } else if (oldField.notNull && !newField.notNull) {
    changes.push("notNull_removed");
  }

  const oldDefault = String(oldField.default || "");
  const newDefault = String(newField.default || "");
  if (oldDefault !== newDefault) {
    changes.push("default_changed");
  }

  return changes;
}
