import { z } from "zod";

/**
 * Sequential thinking for database design.
 * The AI calls this tool repeatedly, one thought at a time, building up
 * a complete database architecture through structured reasoning.
 */

const THINKING_PHASES = {
  DOMAIN_ANALYSIS: "domain_analysis",
  WORKLOAD_ANALYSIS: "workload_analysis",
  ENTITY_IDENTIFICATION: "entity_identification",
  RELATIONSHIP_MAPPING: "relationship_mapping",
  NORMALIZATION_DECISIONS: "normalization_decisions",
  INDEXING_STRATEGY: "indexing_strategy",
  PARTITIONING_STRATEGY: "partitioning_strategy",
  AUDIT_COMPLIANCE: "audit_compliance",
  EVENT_SOURCING: "event_sourcing",
  PERFORMANCE_OPTIMIZATION: "performance_optimization",
  MIGRATION_STRATEGY: "migration_strategy",
  REVIEW_AND_REVISE: "review_and_revise",
  FINAL_PLAN: "final_plan",
};

// In-memory thought log per session
let thoughtHistory = [];
let branches = {};

export function registerThinkingTools(server, store) {
  // --- think_about_schema ---
  server.tool(
    "think_about_schema",
    `A sequential thinking tool for database design. Call this REPEATEDLY to reason 
through a schema design step by step. Each call is one thought -- you can revise 
previous thoughts, branch into alternatives, and adjust the plan as you go.

WORKFLOW:
1. Start with thought 1: analyze the domain
2. Each subsequent thought builds on previous ones
3. You can revise earlier thoughts if you realize a mistake
4. You can branch to explore alternative designs
5. When done (nextThoughtNeeded=false), execute the final plan with write tools

PHASES to work through (in order, but you can revisit):
- domain_analysis: What is this system? What are the business rules?
- workload_analysis: Read/write ratios, TPS, data volume, access patterns
- entity_identification: Core tables and their purpose
- relationship_mapping: FKs, cardinality, referential actions
- normalization_decisions: What to normalize vs denormalize and why
- indexing_strategy: Which columns need indices and why
- partitioning_strategy: Which tables need partitioning and by what key
- audit_compliance: Audit trails, event logs, soft deletes
- event_sourcing: Where to use append-only patterns
- performance_optimization: Materialized views, caching columns, read replicas
- migration_strategy: How to deploy this schema safely
- review_and_revise: Self-critique -- find flaws in your own design
- final_plan: The complete list of actions to execute`,
    {
      thought: z.string().describe("Your current thinking step -- what you are reasoning about right now"),
      nextThoughtNeeded: z.boolean().describe("Whether another thought step is needed after this one"),
      thoughtNumber: z.number().int().describe("Current thought number (starts at 1)"),
      totalThoughts: z.number().int().describe("Estimated total thoughts needed (can be adjusted)"),
      phase: z
        .enum([
          "domain_analysis",
          "workload_analysis",
          "entity_identification",
          "relationship_mapping",
          "normalization_decisions",
          "indexing_strategy",
          "partitioning_strategy",
          "audit_compliance",
          "event_sourcing",
          "performance_optimization",
          "migration_strategy",
          "review_and_revise",
          "final_plan",
        ])
        .describe("Which design phase this thought belongs to"),
      isRevision: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether this revises a previous thought"),
      revisesThought: z
        .number()
        .int()
        .optional()
        .describe("Which thought number is being revised"),
      branchFromThought: z
        .number()
        .int()
        .optional()
        .describe("If branching, which thought to branch from"),
      branchId: z
        .string()
        .optional()
        .describe("Branch identifier (e.g., 'alternative-a', 'event-sourced-variant')"),
      needsMoreThoughts: z
        .boolean()
        .optional()
        .default(false)
        .describe("If you realize you need more thoughts than originally estimated"),
    },
    async ({
      thought,
      nextThoughtNeeded,
      thoughtNumber,
      totalThoughts,
      phase,
      isRevision,
      revisesThought,
      branchFromThought,
      branchId,
      needsMoreThoughts,
    }) => {
      // Store the thought
      const entry = {
        number: thoughtNumber,
        total: totalThoughts,
        phase,
        thought,
        isRevision: isRevision || false,
        revisesThought: revisesThought || null,
        branchFromThought: branchFromThought || null,
        branchId: branchId || null,
        timestamp: new Date().toISOString(),
      };

      if (branchId) {
        if (!branches[branchId]) branches[branchId] = [];
        branches[branchId].push(entry);
      } else {
        thoughtHistory.push(entry);
      }

      // Build response with context
      const response = {
        status: nextThoughtNeeded ? "continue" : "complete",
        thoughtNumber,
        totalThoughts: needsMoreThoughts ? totalThoughts + 3 : totalThoughts,
        phase,
        thoughtsRecorded: thoughtHistory.length,
        branches: Object.keys(branches),
        currentSchema: {
          tables: store.tables.length,
          relationships: store.relationships.length,
        },
      };

      if (isRevision && revisesThought) {
        response.revisedThought = revisesThought;
        response.note = `Thought ${revisesThought} has been revised. Previous reasoning superseded.`;
      }

      if (!nextThoughtNeeded) {
        response.note =
          "Thinking complete. Now execute the design using add_table, add_field, add_relationship, add_index tools. Call validate_schema_quality when done.";
        response.thoughtSummary = thoughtHistory.map(
          (t) => `[${t.phase}] #${t.number}: ${t.thought.substring(0, 100)}...`,
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // --- get_thinking_context ---
  server.tool(
    "get_thinking_context",
    `Retrieve the full thought history for the current design session. 
Use this to review what you have reasoned about so far before continuing 
or before executing the final plan.`,
    {},
    async () => {
      if (thoughtHistory.length === 0 && Object.keys(branches).length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No thoughts recorded yet. Start by calling think_about_schema.",
            },
          ],
        };
      }

      const context = {
        mainThread: thoughtHistory.map((t) => ({
          number: t.number,
          phase: t.phase,
          thought: t.thought,
          isRevision: t.isRevision,
          revisesThought: t.revisesThought,
        })),
        branches: Object.fromEntries(
          Object.entries(branches).map(([id, thoughts]) => [
            id,
            thoughts.map((t) => ({
              number: t.number,
              phase: t.phase,
              thought: t.thought,
            })),
          ]),
        ),
        currentSchema: {
          database: store.database,
          tables: store.tables.map((t) => ({
            name: t.name,
            fields: t.fields.length,
          })),
          relationships: store.relationships.length,
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(context, null, 2) }],
      };
    },
  );

  // --- reset_thinking ---
  server.tool(
    "reset_thinking",
    "Clear the thought history to start a fresh design session.",
    {},
    async () => {
      const count = thoughtHistory.length;
      thoughtHistory = [];
      branches = {};
      return {
        content: [
          {
            type: "text",
            text: `Thinking reset. Cleared ${count} thoughts and all branches. Ready for a new design session.`,
          },
        ],
      };
    },
  );

  // --- think_about_review ---
  server.tool(
    "think_about_review",
    `Sequential thinking specifically for REVIEWING an existing schema. 
Call this repeatedly to analyze the current diagram step by step -- 
identifying flaws, performance risks, and improvements.

REVIEW PHASES:
- structural_analysis: Table structure, field types, constraints
- relationship_analysis: FK integrity, cardinality correctness, cascade risks
- performance_analysis: Missing indices, expensive joins, hot tables
- scalability_analysis: Partitioning needs, row growth projections
- integrity_analysis: Race conditions, constraint gaps, orphan risks
- compliance_analysis: Audit trails, PII handling, retention
- operational_analysis: Migration safety, backup complexity, monitoring gaps
- recommendations: Concrete fixes with priority ordering`,
    {
      thought: z.string().describe("Your current review observation or analysis"),
      nextThoughtNeeded: z.boolean().describe("Whether more review steps are needed"),
      thoughtNumber: z.number().int().describe("Current thought number"),
      totalThoughts: z.number().int().describe("Estimated total review thoughts"),
      phase: z
        .enum([
          "structural_analysis",
          "relationship_analysis",
          "performance_analysis",
          "scalability_analysis",
          "integrity_analysis",
          "compliance_analysis",
          "operational_analysis",
          "recommendations",
        ])
        .describe("Which review phase this thought belongs to"),
      severity: z
        .enum(["critical", "warning", "info", "suggestion"])
        .optional()
        .default("info")
        .describe("Severity of the finding"),
      affectedTables: z
        .array(z.string())
        .optional()
        .describe("Which tables this finding affects"),
      isRevision: z.boolean().optional().default(false),
      revisesThought: z.number().int().optional(),
    },
    async ({
      thought,
      nextThoughtNeeded,
      thoughtNumber,
      totalThoughts,
      phase,
      severity,
      affectedTables,
      isRevision,
      revisesThought,
    }) => {
      const entry = {
        number: thoughtNumber,
        total: totalThoughts,
        phase,
        thought,
        severity: severity || "info",
        affectedTables: affectedTables || [],
        isRevision: isRevision || false,
        revisesThought: revisesThought || null,
        timestamp: new Date().toISOString(),
      };

      thoughtHistory.push(entry);

      const response = {
        status: nextThoughtNeeded ? "continue" : "review_complete",
        thoughtNumber,
        totalThoughts,
        phase,
        severity,
        findingsCount: {
          critical: thoughtHistory.filter((t) => t.severity === "critical").length,
          warning: thoughtHistory.filter((t) => t.severity === "warning").length,
          info: thoughtHistory.filter((t) => t.severity === "info").length,
          suggestion: thoughtHistory.filter((t) => t.severity === "suggestion").length,
        },
      };

      if (!nextThoughtNeeded) {
        response.note =
          "Review complete. Use upgrade_to_production or execute fixes directly with update_field, add_index, add_field, etc.";
        response.summary = thoughtHistory
          .filter((t) => t.severity === "critical" || t.severity === "warning")
          .map((t) => `[${t.severity.toUpperCase()}] ${t.thought.substring(0, 120)}`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // --- think_about_edit ---
  server.tool(
    "think_about_edit",
    `Sequential thinking for EDITING an existing schema safely. 
Call this before making changes to reason through the impact of modifications.

EDIT PHASES:
- impact_analysis: What will this change affect? Which queries, relationships, indices?
- backward_compatibility: Will this break existing code or migrations?
- data_migration: How to migrate existing data for this change?
- rollback_plan: How to undo this change if something goes wrong?
- execution_order: What order should changes be applied in?
- validation: How to verify the change worked correctly?`,
    {
      thought: z.string().describe("Your reasoning about the edit"),
      nextThoughtNeeded: z.boolean().describe("Whether more thinking is needed"),
      thoughtNumber: z.number().int().describe("Current thought number"),
      totalThoughts: z.number().int().describe("Estimated total thoughts"),
      phase: z
        .enum([
          "impact_analysis",
          "backward_compatibility",
          "data_migration",
          "rollback_plan",
          "execution_order",
          "validation",
        ])
        .describe("Which edit-planning phase this thought belongs to"),
      proposedChange: z
        .string()
        .optional()
        .describe("The specific change being considered (e.g., 'add column status to orders')"),
      risk: z
        .enum(["low", "medium", "high", "critical"])
        .optional()
        .default("low")
        .describe("Risk level of this change"),
      affectedTables: z.array(z.string()).optional().describe("Tables affected by this change"),
    },
    async ({
      thought,
      nextThoughtNeeded,
      thoughtNumber,
      totalThoughts,
      phase,
      proposedChange,
      risk,
      affectedTables,
    }) => {
      const entry = {
        number: thoughtNumber,
        total: totalThoughts,
        phase,
        thought,
        proposedChange: proposedChange || null,
        risk: risk || "low",
        affectedTables: affectedTables || [],
        timestamp: new Date().toISOString(),
      };

      thoughtHistory.push(entry);

      const response = {
        status: nextThoughtNeeded ? "continue" : "ready_to_execute",
        thoughtNumber,
        totalThoughts,
        phase,
        risk,
        currentSchema: {
          tables: store.tables.map((t) => t.name),
          relationships: store.relationships.length,
        },
      };

      if (!nextThoughtNeeded) {
        response.note =
          "Edit planning complete. Execute the changes in the order determined during execution_order phase. Call validate_schema_quality after.";
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );
}
