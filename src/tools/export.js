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
  if (dialect === "mysql" || dialect === "mariadb") return `\`${name}\``;
  if (dialect === "transactsql") return `[${name}]`;
  return `"${name}"`;
}

function generateDDL(store, dialect, tableNames) {
  let tables = store.tables;
  if (tableNames && tableNames.length > 0) {
    const names = tableNames.map((n) => n.toLowerCase());
    tables = tables.filter((t) => names.includes(t.name.toLowerCase()));
  }

  const statements = [];

  // Enums (PostgreSQL only)
  if (dialect === "postgresql" && store.enums.length > 0) {
    for (const e of store.enums) {
      statements.push(
        `CREATE TYPE "${e.name}" AS ENUM (\n${e.values.map((v) => `  '${v}'`).join(",\n")}\n);`,
      );
    }
    statements.push("");
  }

  // Tables
  for (const table of tables) {
    const q = (name) => quoteId(name, dialect);
    const lines = [];

    for (const field of table.fields) {
      let col = `  ${q(field.name)} ${formatType(field, dialect)}`;
      if (field.notNull) col += " NOT NULL";
      if (field.increment) {
        if (dialect === "mysql" || dialect === "mariadb") col += " AUTO_INCREMENT";
        else if (dialect === "postgresql") col = `  ${q(field.name)} SERIAL`;
        else if (dialect === "sqlite") col += " AUTOINCREMENT";
        else if (dialect === "transactsql") col += " IDENTITY(1,1)";
      }
      if (field.unique) col += " UNIQUE";
      if (field.default !== "" && field.default !== undefined && field.default !== null) {
        col += ` DEFAULT ${formatDefault(field, dialect)}`;
      }
      if (field.check) col += ` CHECK(${field.check})`;
      lines.push(col);
    }

    // Primary key
    const pks = table.fields.filter((f) => f.primary);
    if (pks.length > 0) {
      lines.push(`  PRIMARY KEY (${pks.map((f) => q(f.name)).join(", ")})`);
    }

    const createStmt = `CREATE TABLE ${q(table.name)} (\n${lines.join(",\n")}\n);`;
    statements.push(createStmt);

    // Table comment
    if (table.comment && dialect === "postgresql") {
      statements.push(
        `COMMENT ON TABLE "${table.name}" IS '${escapeQuotes(table.comment)}';`,
      );
    }

    statements.push("");
  }

  // Foreign keys as ALTER TABLE
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

  return statements.join("\n");
}

function formatType(field, dialect) {
  let type = field.type;

  if ((type === "ENUM" || type === "SET") && field.values) {
    if (dialect === "postgresql") {
      // Use the enum type name or inline
      return `"${field.name}_enum"`;
    }
    return `${type}(${field.values.map((v) => `'${v}'`).join(", ")})`;
  }

  if (field.size) {
    return `${type}(${field.size})`;
  }

  return type;
}

function formatDefault(field, dialect) {
  const val = field.default;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (
    val.toUpperCase() === "NULL" ||
    val.toUpperCase() === "CURRENT_TIMESTAMP" ||
    val.startsWith("(")
  ) {
    return val;
  }
  return `'${escapeQuotes(val)}'`;
}

function escapeQuotes(str) {
  return str.replace(/'/g, "''");
}

// --- DBML Generation ---

function generateDBML(store) {
  const lines = [];

  // Enums
  for (const e of store.enums) {
    lines.push(`enum ${quoteDbml(e.name)} {`);
    for (const v of e.values) {
      lines.push(`  ${quoteDbml(v)}`);
    }
    lines.push("}\n");
  }

  // Tables
  for (const table of store.tables) {
    const header = table.comment
      ? `Table ${quoteDbml(table.name)} [note: '${escapeQuotes(table.comment)}'] {`
      : `Table ${quoteDbml(table.name)} {`;
    lines.push(header);

    for (const field of table.fields) {
      let line = `  ${quoteDbml(field.name)} ${field.type.toLowerCase()}`;
      const settings = [];
      if (field.primary) settings.push("pk");
      if (field.increment) settings.push("increment");
      if (field.notNull) settings.push("not null");
      if (field.unique) settings.push("unique");
      if (field.default !== "" && field.default !== undefined) {
        settings.push(`default: '${field.default}'`);
      }
      if (field.comment) settings.push(`note: '${escapeQuotes(field.comment)}'`);
      if (settings.length > 0) line += ` [${settings.join(", ")}]`;
      lines.push(line);
    }

    // Indices
    if (table.indices && table.indices.length > 0) {
      lines.push("");
      lines.push("  indexes {");
      for (const idx of table.indices) {
        const cols = idx.fields.map((f) => quoteDbml(f)).join(", ");
        const opts = [];
        if (idx.name) opts.push(`name: '${idx.name}'`);
        if (idx.unique) opts.push("unique");
        const optStr = opts.length > 0 ? ` [${opts.join(", ")}]` : "";
        lines.push(`    (${cols})${optStr}`);
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
      settings.push(`delete: ${rel.deleteConstraint.toLowerCase()}`);
    }
    if (rel.updateConstraint && rel.updateConstraint !== "No action") {
      settings.push(`update: ${rel.updateConstraint.toLowerCase()}`);
    }
    const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";

    lines.push(
      `Ref ${quoteDbml(rel.name)} {`,
    );
    lines.push(
      `  ${quoteDbml(startTable.name)}.${quoteDbml(startField.name)} ${card} ${quoteDbml(endTable.name)}.${quoteDbml(endField.name)}${settingsStr}`,
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
  return `"${name}"`;
}
