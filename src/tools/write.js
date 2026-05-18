import { z } from "zod";
import { getThinkingState, resetThinkingState } from "./thinking.js";

const DEFAULT_TABLE_COLOR = "#175e7a";

const FieldSchema = z.object({
  name: z.string().describe("Column name"),
  type: z.string().describe("Data type (e.g. INT, VARCHAR, TEXT, BOOLEAN)"),
  size: z.union([z.string(), z.number()]).optional().describe("Size or precision"),
  notNull: z.boolean().optional().default(false).describe("NOT NULL constraint"),
  primary: z.boolean().optional().default(false).describe("Primary key"),
  unique: z.boolean().optional().default(false).describe("Unique constraint"),
  autoIncrement: z.boolean().optional().default(false).describe("Auto increment"),
  default: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .default("")
    .describe("Default value"),
  check: z.string().optional().default("").describe("CHECK constraint expression"),
  comment: z.string().optional().default("").describe("Column comment"),
  values: z.array(z.string()).optional().describe("Values for ENUM/SET types"),
});

/**
 * Register write tools for modifying the diagram schema.
 */
export function registerWriteTools(server, store) {
  // --- add_table ---
  server.tool(
    "add_table",
    "Add a new table to the diagram with columns and constraints. IMPORTANT: When designing a NEW schema from scratch, you should call think_about_schema repeatedly FIRST to reason through the design before calling this tool. Direct use is fine when the user is incrementally adding to an existing schema or explicitly asks for a specific table.",
    {
      name: z.string().describe("Table name"),
      fields: z.array(FieldSchema).describe("Array of column definitions"),
      comment: z.string().optional().default("").describe("Table comment"),
      color: z
        .string()
        .optional()
        .default(DEFAULT_TABLE_COLOR)
        .describe("Table header color (hex)"),
    },
    async ({ name, fields, comment, color }) => {
      // Soft gate: warn (don't block) if the AI is creating tables on a fresh
      // schema without any prior thinking. This nudges the AI back to think_about_schema
      // when starting a new design from scratch.
      const thinking = getThinkingState();
      const isFreshSchema = store.tables.length === 0;
      if (isFreshSchema && thinking.thoughtCount < 3) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "blocked",
                  reason: "insufficient_thinking",
                  message: `Cannot create tables yet. You have only ${thinking.thoughtCount} thought(s) recorded. Production schemas require at least 3 thinking steps covering domain analysis, workload analysis, and entity identification before writing.`,
                  required_action: {
                    tool: "think_about_schema",
                    parameters: {
                      thoughtNumber: thinking.lastThoughtNumber + 1,
                      totalThoughts: 12,
                      phase: thinking.thoughtCount === 0 ? "domain_analysis" : thinking.thoughtCount === 1 ? "workload_analysis" : "entity_identification",
                      nextThoughtNeeded: true,
                    },
                  },
                  current_thinking_state: thinking,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      // Check for duplicate
      if (store.findTable(name)) {
        return {
          content: [{ type: "text", text: `Error: Table '${name}' already exists.` }],
          isError: true,
        };
      }

      const tableId = store.nextTableId();
      const table = {
        id: tableId,
        name,
        x: 100 + store.tables.length * 260,
        y: 100,
        fields: fields.map((f, idx) => ({
          id: idx,
          name: f.name,
          type: f.type.toUpperCase(),
          size: f.size ?? "",
          default: f.default ?? "",
          check: f.check ?? "",
          primary: f.primary ?? false,
          unique: f.unique ?? false,
          notNull: f.notNull ?? false,
          increment: f.autoIncrement ?? false,
          comment: f.comment ?? "",
          values: f.values ?? undefined,
        })),
        comment: comment || "",
        indices: [],
        color: color || DEFAULT_TABLE_COLOR,
      };

      store.tables.push(table);
      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Table '${name}' created with ${fields.length} field(s).`,
          },
        ],
      };
    },
  );

  // --- add_field ---
  server.tool(
    "add_field",
    "Add a new column to an existing table",
    {
      table_name: z.string().describe("Target table name"),
      field: FieldSchema.describe("Column definition"),
    },
    async ({ table_name, field }) => {
      const table = store.findTable(table_name);
      if (!table) {
        return {
          content: [{ type: "text", text: `Error: Table '${table_name}' not found.` }],
          isError: true,
        };
      }

      const existing = table.fields.find(
        (f) => f.name.toLowerCase() === field.name.toLowerCase(),
      );
      if (existing) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Field '${field.name}' already exists in table '${table_name}'.`,
            },
          ],
          isError: true,
        };
      }

      const fieldId = store.nextFieldId(table);
      table.fields.push({
        id: fieldId,
        name: field.name,
        type: field.type.toUpperCase(),
        size: field.size ?? "",
        default: field.default ?? "",
        check: field.check ?? "",
        primary: field.primary ?? false,
        unique: field.unique ?? false,
        notNull: field.notNull ?? false,
        increment: field.autoIncrement ?? false,
        comment: field.comment ?? "",
        values: field.values ?? undefined,
      });

      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Field '${field.name}' added to table '${table_name}'.`,
          },
        ],
      };
    },
  );

  // --- update_field ---
  server.tool(
    "update_field",
    "Update an existing column's properties in a table",
    {
      table_name: z.string().describe("Target table name"),
      field_name: z.string().describe("Current column name"),
      updates: z
        .object({
          name: z.string().optional().describe("New column name"),
          type: z.string().optional().describe("New data type"),
          size: z.union([z.string(), z.number()]).optional().describe("New size"),
          notNull: z.boolean().optional().describe("NOT NULL constraint"),
          primary: z.boolean().optional().describe("Primary key"),
          unique: z.boolean().optional().describe("Unique constraint"),
          autoIncrement: z.boolean().optional().describe("Auto increment"),
          default: z
            .union([z.string(), z.number(), z.boolean()])
            .optional()
            .describe("Default value"),
          check: z.string().optional().describe("CHECK constraint"),
          comment: z.string().optional().describe("Column comment"),
          values: z.array(z.string()).optional().describe("ENUM/SET values"),
        })
        .describe("Fields to update"),
    },
    async ({ table_name, field_name, updates }) => {
      const table = store.findTable(table_name);
      if (!table) {
        return {
          content: [{ type: "text", text: `Error: Table '${table_name}' not found.` }],
          isError: true,
        };
      }

      const field = table.fields.find(
        (f) => f.name.toLowerCase() === field_name.toLowerCase(),
      );
      if (!field) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Field '${field_name}' not found in table '${table_name}'.`,
            },
          ],
          isError: true,
        };
      }

      if (updates.name !== undefined) field.name = updates.name;
      if (updates.type !== undefined) field.type = updates.type.toUpperCase();
      if (updates.size !== undefined) field.size = updates.size;
      if (updates.notNull !== undefined) field.notNull = updates.notNull;
      if (updates.primary !== undefined) field.primary = updates.primary;
      if (updates.unique !== undefined) field.unique = updates.unique;
      if (updates.autoIncrement !== undefined) field.increment = updates.autoIncrement;
      if (updates.default !== undefined) field.default = updates.default;
      if (updates.check !== undefined) field.check = updates.check;
      if (updates.comment !== undefined) field.comment = updates.comment;
      if (updates.values !== undefined) field.values = updates.values;

      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Field '${field_name}' in table '${table_name}' updated.`,
          },
        ],
      };
    },
  );

  // --- remove_field ---
  server.tool(
    "remove_field",
    "Remove a column from a table (also removes related relationships)",
    {
      table_name: z.string().describe("Target table name"),
      field_name: z.string().describe("Column name to remove"),
    },
    async ({ table_name, field_name }) => {
      const table = store.findTable(table_name);
      if (!table) {
        return {
          content: [{ type: "text", text: `Error: Table '${table_name}' not found.` }],
          isError: true,
        };
      }

      const fieldIdx = table.fields.findIndex(
        (f) => f.name.toLowerCase() === field_name.toLowerCase(),
      );
      if (fieldIdx === -1) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Field '${field_name}' not found in table '${table_name}'.`,
            },
          ],
          isError: true,
        };
      }

      const field = table.fields[fieldIdx];

      // Remove relationships referencing this field
      const removedRels = store.diagram.relationships.filter(
        (r) =>
          (String(r.startTableId) === String(table.id) &&
            String(r.startFieldId) === String(field.id)) ||
          (String(r.endTableId) === String(table.id) &&
            String(r.endFieldId) === String(field.id)),
      );
      store.diagram.relationships = store.diagram.relationships.filter(
        (r) => !removedRels.includes(r),
      );

      table.fields.splice(fieldIdx, 1);
      await store.save();

      const msg =
        removedRels.length > 0
          ? `Field '${field_name}' removed from '${table_name}'. ${removedRels.length} relationship(s) also removed.`
          : `Field '${field_name}' removed from '${table_name}'.`;

      return { content: [{ type: "text", text: msg }] };
    },
  );

  // --- remove_table ---
  server.tool(
    "remove_table",
    "Remove a table and all its relationships from the diagram",
    {
      table_name: z.string().describe("Table name to remove"),
    },
    async ({ table_name }) => {
      const table = store.findTable(table_name);
      if (!table) {
        return {
          content: [{ type: "text", text: `Error: Table '${table_name}' not found.` }],
          isError: true,
        };
      }

      // Remove relationships
      const removedRels = store.diagram.relationships.filter(
        (r) =>
          String(r.startTableId) === String(table.id) ||
          String(r.endTableId) === String(table.id),
      );
      store.diagram.relationships = store.diagram.relationships.filter(
        (r) => !removedRels.includes(r),
      );

      // Remove table
      const idx = store.tables.findIndex((t) => t.id === table.id);
      store.tables.splice(idx, 1);

      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Table '${table_name}' removed. ${removedRels.length} relationship(s) also removed.`,
          },
        ],
      };
    },
  );

  // --- add_relationship ---
  server.tool(
    "add_relationship",
    "Add a foreign key relationship between two tables",
    {
      name: z.string().describe("Relationship/constraint name"),
      from_table: z.string().describe("Source table (the one with the FK column)"),
      from_field: z.string().describe("Source column name"),
      to_table: z.string().describe("Referenced table (the one being pointed to)"),
      to_field: z.string().describe("Referenced column name"),
      cardinality: z
        .enum(["one_to_one", "one_to_many", "many_to_one"])
        .default("many_to_one")
        .describe("Relationship cardinality"),
      on_update: z
        .enum(["No action", "Restrict", "Cascade", "Set null", "Set default"])
        .default("No action")
        .describe("ON UPDATE action"),
      on_delete: z
        .enum(["No action", "Restrict", "Cascade", "Set null", "Set default"])
        .default("No action")
        .describe("ON DELETE action"),
    },
    async ({ name, from_table, from_field, to_table, to_field, cardinality, on_update, on_delete }) => {
      const fromT = store.findTable(from_table);
      if (!fromT) {
        return {
          content: [{ type: "text", text: `Error: Table '${from_table}' not found.` }],
          isError: true,
        };
      }
      const toT = store.findTable(to_table);
      if (!toT) {
        return {
          content: [{ type: "text", text: `Error: Table '${to_table}' not found.` }],
          isError: true,
        };
      }

      const fromF = fromT.fields.find(
        (f) => f.name.toLowerCase() === from_field.toLowerCase(),
      );
      if (!fromF) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Field '${from_field}' not found in table '${from_table}'.`,
            },
          ],
          isError: true,
        };
      }

      const toF = toT.fields.find(
        (f) => f.name.toLowerCase() === to_field.toLowerCase(),
      );
      if (!toF) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Field '${to_field}' not found in table '${to_table}'.`,
            },
          ],
          isError: true,
        };
      }

      const rel = {
        id: store.nextRelationshipId(),
        name,
        startTableId: fromT.id,
        startFieldId: fromF.id,
        endTableId: toT.id,
        endFieldId: toF.id,
        cardinality,
        updateConstraint: on_update,
        deleteConstraint: on_delete,
      };

      store.relationships.push(rel);
      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Relationship '${name}' created: ${from_table}.${from_field} -> ${to_table}.${to_field} (${cardinality}).`,
          },
        ],
      };
    },
  );

  // --- remove_relationship ---
  server.tool(
    "remove_relationship",
    "Remove a relationship by name",
    {
      name: z.string().describe("Relationship name to remove"),
    },
    async ({ name }) => {
      const idx = store.relationships.findIndex(
        (r) => r.name.toLowerCase() === name.toLowerCase(),
      );
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `Error: Relationship '${name}' not found.` }],
          isError: true,
        };
      }

      store.relationships.splice(idx, 1);
      await store.save();

      return {
        content: [{ type: "text", text: `Relationship '${name}' removed.` }],
      };
    },
  );

  // --- add_index ---
  server.tool(
    "add_index",
    "Add an index to a table",
    {
      table_name: z.string().describe("Target table name"),
      index_name: z.string().describe("Index name"),
      fields: z.array(z.string()).describe("Column names to include in the index"),
      unique: z.boolean().optional().default(false).describe("Whether the index is unique"),
    },
    async ({ table_name, index_name, fields, unique }) => {
      const table = store.findTable(table_name);
      if (!table) {
        return {
          content: [{ type: "text", text: `Error: Table '${table_name}' not found.` }],
          isError: true,
        };
      }

      if (!table.indices) table.indices = [];

      // Validate fields exist
      for (const fieldName of fields) {
        const exists = table.fields.find(
          (f) => f.name.toLowerCase() === fieldName.toLowerCase(),
        );
        if (!exists) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Field '${fieldName}' not found in table '${table_name}'.`,
              },
            ],
            isError: true,
          };
        }
      }

      table.indices.push({ name: index_name, unique: unique ?? false, fields });
      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Index '${index_name}' added to table '${table_name}' on (${fields.join(", ")}).`,
          },
        ],
      };
    },
  );

  // --- add_enum ---
  server.tool(
    "add_enum",
    "Add a new enum type to the schema",
    {
      name: z.string().describe("Enum name"),
      values: z.array(z.string()).describe("Enum values"),
    },
    async ({ name, values }) => {
      // Same gate as add_table -- block creating enums on a fresh schema with insufficient thinking
      const thinking = getThinkingState();
      const isFreshSchema = store.tables.length === 0 && store.enums.length === 0;
      if (isFreshSchema && thinking.thoughtCount < 3) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "blocked",
                  reason: "insufficient_thinking",
                  message: `Cannot create enums yet. ${thinking.thoughtCount} thought(s) recorded, need at least 3. Use think_about_schema first.`,
                  required_action: {
                    tool: "think_about_schema",
                    parameters: {
                      thoughtNumber: thinking.lastThoughtNumber + 1,
                      totalThoughts: 12,
                      phase: thinking.thoughtCount === 0 ? "domain_analysis" : "workload_analysis",
                      nextThoughtNeeded: true,
                    },
                  },
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const existing = store.enums.find(
        (e) => e.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        return {
          content: [{ type: "text", text: `Error: Enum '${name}' already exists.` }],
          isError: true,
        };
      }

      store.enums.push({ name, values });
      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Enum '${name}' created with values: ${values.join(", ")}.`,
          },
        ],
      };
    },
  );

  // --- add_note ---
  server.tool(
    "add_note",
    "Add a note to the diagram",
    {
      title: z.string().describe("Note title"),
      content: z.string().describe("Note content"),
    },
    async ({ title, content }) => {
      const noteId =
        store.notes.length > 0
          ? Math.max(...store.notes.map((n) => n.id)) + 1
          : 0;

      store.notes.push({
        id: noteId,
        x: 100 + store.notes.length * 200,
        y: 500,
        title,
        content,
        color: "#fcf7ac",
        height: 88,
        width: 180,
      });

      await store.save();

      return {
        content: [{ type: "text", text: `Note '${title}' added to diagram.` }],
      };
    },
  );

  // --- new_diagram ---
  server.tool(
    "new_diagram",
    "Clear the current diagram and start fresh. Removes all tables, relationships, notes, types, and enums. Use this when the user wants to design something new instead of editing the existing diagram.",
    {
      database: z
        .enum(["mysql", "postgresql", "sqlite", "mariadb", "transactsql", "oraclesql"])
        .optional()
        .describe("Database dialect for the new diagram. Keeps current dialect if omitted."),
      title: z.string().optional().describe("Title for the new diagram"),
    },
    async ({ database, title }) => {
      store.diagram.tables = [];
      store.diagram.relationships = [];
      store.diagram.notes = [];
      store.diagram.subjectAreas = [];
      store.diagram.types = [];
      store.diagram.enums = [];
      if (database) store.diagram.database = database;
      if (title) store.diagram.title = title;

      // Reset thinking state so the gate applies to the new design
      resetThinkingState();
      // New diagramId so DrawDB treats this as a fresh diagram
      store.diagram.diagramId = store._generateUUID();

      await store.save();

      return {
        content: [
          {
            type: "text",
            text: `Diagram cleared. New diagram ready.\n  Database: ${store.diagram.database || "(not set -- will be asked)"}\n  Title: ${store.diagram.title}\n\nNext step: call design_schema with the product requirements, or think_about_schema to start reasoning.`,
          },
        ],
      };
    },
  );
}
