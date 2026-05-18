import { z } from "zod";

/**
 * Register read-only tools for inspecting the diagram schema.
 */
export function registerReadTools(server, store) {
  // --- get_schema_summary ---
  server.tool(
    "get_schema_summary",
    "Get a high-level overview of the database schema: table count, relationship count, database dialect, title, subject areas, and notes",
    {},
    async () => {
      const summary = {
        title: store.title,
        database: store.database,
        tableCount: store.tables.length,
        relationshipCount: store.relationships.length,
        noteCount: store.notes.length,
        subjectAreaCount: store.subjectAreas.length,
        enumCount: store.enums.length,
        typeCount: store.types.length,
        tables: store.tables.map((t) => t.name),
        subjectAreas: store.subjectAreas.map((a) => a.name),
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  );

  // --- list_tables ---
  server.tool(
    "list_tables",
    "Return all table names with field counts and optional comments",
    {},
    async () => {
      const tables = store.tables.map((t) => ({
        name: t.name,
        fieldCount: t.fields.length,
        comment: t.comment || null,
        indexCount: t.indices ? t.indices.length : 0,
      }));
      return { content: [{ type: "text", text: JSON.stringify(tables, null, 2) }] };
    },
  );

  // --- describe_table ---
  server.tool(
    "describe_table",
    "Return full column definitions for a given table including name, type, nullable, default, constraints, and indices",
    { table_name: z.string().describe("Name of the table to describe") },
    async ({ table_name }) => {
      const table = store.findTable(table_name);
      if (!table) {
        return {
          content: [{ type: "text", text: `Error: Table '${table_name}' not found.` }],
          isError: true,
        };
      }

      const result = {
        name: table.name,
        comment: table.comment || null,
        fields: table.fields.map((f) => ({
          name: f.name,
          type: f.type,
          size: f.size || null,
          nullable: !f.notNull,
          primary: f.primary,
          unique: f.unique,
          autoIncrement: f.increment,
          default: f.default !== "" ? f.default : null,
          check: f.check || null,
          comment: f.comment || null,
          values: f.values || null,
        })),
        indices: (table.indices || []).map((idx) => ({
          name: idx.name,
          unique: idx.unique,
          fields: idx.fields,
        })),
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- list_relationships ---
  server.tool(
    "list_relationships",
    "Return all foreign key relationships with cardinality and referential actions",
    {},
    async () => {
      const rels = store.relationships.map((r) => {
        const startTable = store.findTableById(r.startTableId);
        const endTable = store.findTableById(r.endTableId);
        const startField = startTable?.fields.find(
          (f) => String(f.id) === String(r.startFieldId),
        );
        const endField = endTable?.fields.find(
          (f) => String(f.id) === String(r.endFieldId),
        );

        return {
          name: r.name,
          from: {
            table: startTable?.name || `unknown(${r.startTableId})`,
            field: startField?.name || `unknown(${r.startFieldId})`,
          },
          to: {
            table: endTable?.name || `unknown(${r.endTableId})`,
            field: endField?.name || `unknown(${r.endFieldId})`,
          },
          cardinality: r.cardinality,
          onUpdate: r.updateConstraint,
          onDelete: r.deleteConstraint,
        };
      });

      return { content: [{ type: "text", text: JSON.stringify(rels, null, 2) }] };
    },
  );

  // --- describe_relationship ---
  server.tool(
    "describe_relationship",
    "Return detailed relationship info between two specific tables",
    {
      from_table: z.string().describe("Source table name"),
      to_table: z.string().describe("Target table name"),
    },
    async ({ from_table, to_table }) => {
      const fromT = store.findTable(from_table);
      const toT = store.findTable(to_table);

      if (!fromT) {
        return {
          content: [{ type: "text", text: `Error: Table '${from_table}' not found.` }],
          isError: true,
        };
      }
      if (!toT) {
        return {
          content: [{ type: "text", text: `Error: Table '${to_table}' not found.` }],
          isError: true,
        };
      }

      const rels = store.relationships.filter(
        (r) =>
          (String(r.startTableId) === String(fromT.id) &&
            String(r.endTableId) === String(toT.id)) ||
          (String(r.startTableId) === String(toT.id) &&
            String(r.endTableId) === String(fromT.id)),
      );

      if (rels.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No relationships found between '${from_table}' and '${to_table}'.`,
            },
          ],
        };
      }

      const result = rels.map((r) => {
        const startTable = store.findTableById(r.startTableId);
        const endTable = store.findTableById(r.endTableId);
        const startField = startTable?.fields.find(
          (f) => String(f.id) === String(r.startFieldId),
        );
        const endField = endTable?.fields.find(
          (f) => String(f.id) === String(r.endFieldId),
        );

        return {
          name: r.name,
          from: { table: startTable?.name, field: startField?.name },
          to: { table: endTable?.name, field: endField?.name },
          cardinality: r.cardinality,
          onUpdate: r.updateConstraint,
          onDelete: r.deleteConstraint,
        };
      });

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // --- list_enums ---
  server.tool(
    "list_enums",
    "Return all user-defined enums with their values",
    {},
    async () => {
      const enums = store.enums.map((e) => ({
        name: e.name,
        values: e.values,
      }));
      return { content: [{ type: "text", text: JSON.stringify(enums, null, 2) }] };
    },
  );

  // --- list_types ---
  server.tool(
    "list_types",
    "Return all user-defined custom types with their fields",
    {},
    async () => {
      const types = store.types.map((t) => ({
        name: t.name,
        comment: t.comment || null,
        fields: t.fields.map((f) => ({
          name: f.name,
          type: f.type,
        })),
      }));
      return { content: [{ type: "text", text: JSON.stringify(types, null, 2) }] };
    },
  );

  // --- search_tables ---
  server.tool(
    "search_tables",
    "Search tables and columns by name or comment (useful for large schemas)",
    { query: z.string().describe("Search query to match against table/column names and comments") },
    async ({ query }) => {
      const q = query.toLowerCase();
      const results = [];

      for (const table of store.tables) {
        const tableMatch =
          table.name.toLowerCase().includes(q) ||
          (table.comment && table.comment.toLowerCase().includes(q));

        const matchingFields = table.fields.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            (f.comment && f.comment.toLowerCase().includes(q)),
        );

        if (tableMatch || matchingFields.length > 0) {
          results.push({
            table: table.name,
            tableMatch,
            matchingFields: matchingFields.map((f) => f.name),
          });
        }
      }

      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );
}
