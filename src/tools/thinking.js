import { z } from "zod";
import { TEMPLATE_SUMMARIES } from "./templates.js";

/**
 * Sequential thinking for database design.
 * The AI calls this tool repeatedly, one thought at a time, building up
 * a complete database architecture through structured reasoning.
 *
 * Each response injects senior-engineer persona context so the AI thinks
 * like a Stripe/Coinbase/Jane Street architect at every step.
 */

const SENIOR_DEV_PERSONA = `You are reasoning as a senior database architect with deep expertise in:
high-scale financial systems, event sourcing, CQRS, ledger/accounting, PostgreSQL internals, 
TimescaleDB, distributed transactions, low-latency OLTP, analytics pipelines, 
audit/compliance systems, multi-region architectures, schema evolution at scale.
Think like engineers from Stripe, Coinbase, Jane Street, Bloomberg, AWS Aurora, Uber, Snowflake.`;

const PHASE_GUIDANCE = {
  domain_analysis: `What is the business domain? What are the actors? What are the invariants 
that must NEVER be violated (e.g. balances cannot go negative without explicit overdraft, 
events must be immutable once posted)? What's the consistency model required -- strong, 
eventual, or somewhere in between? What regulatory/compliance constraints apply?`,

  workload_analysis: `Estimate read/write ratios. What are the hot paths -- the queries that 
will run thousands of times per second? What are the cold paths -- analytics, reports, 
admin queries? What's the data volume in 1 year, 5 years? What are the access patterns 
(point lookups, range scans, joins)? What's the latency budget per query? Think P99, not P50.`,

  entity_identification: `What are the core nouns? Distinguish between entities (have identity, 
mutable attributes) and value objects (immutable, identified by their values). What needs 
its own table vs. what can be denormalized? Aim for tables that have a clear scaling rationale.`,

  relationship_mapping: `For each FK: what's the cardinality? What's the cascade behavior on 
delete/update? Should it be RESTRICT (fail) or CASCADE (cleanup) or SET NULL? Think about 
business consequences, not just technical correctness. Avoid orphans but avoid silent 
data loss too.`,

  normalization_decisions: `Default to 3NF. Denormalize ONLY when: (a) the read pattern is 
truly hot, (b) you have measurements showing the join is expensive, (c) the write 
amplification is acceptable. Document every denormalization with a comment explaining why.`,

  indexing_strategy: `Every FK needs an index. Composite indices for multi-column WHERE clauses 
(left-prefix rule). Partial indices where most rows don't match (e.g. status='active'). 
Covering indices for hot read paths. Avoid over-indexing -- writes pay the cost.`,

  partitioning_strategy: `Which tables will hit 100M+ rows? Partition by time (events, logs), 
by tenant (multi-tenant), or by key range (sharded). Define the partition key carefully -- 
you cannot easily change it later. Consider TimescaleDB hypertables for time-series.`,

  audit_compliance: `Every state change should leave a trail. Add audit_log or event_log tables. 
Use soft deletes (deleted_at) for recoverable data. Add created_by, updated_by, deleted_by 
for accountability. For financial data, NEVER UPDATE -- always append immutable events.`,

  event_sourcing: `Where does append-only make sense? Ledgers, transactions, state machines, 
audit logs. Define event types as discriminated unions. Store the full event payload. 
Build read models (projections) on top. Think replay-ability.`,

  performance_optimization: `Materialized views for expensive aggregates. Read replicas for 
analytics. Caching columns (denormalized counters) for hot reads. Connection pooling 
strategy. Query result caching at the application layer.`,

  migration_strategy: `Every schema change must be zero-downtime safe. Break breaking changes 
into multiple deploys: add nullable column -> backfill -> add NOT NULL -> remove old 
column. Use the expand/contract pattern. Always have a rollback plan.`,

  review_and_revise: `Self-critique time. Where will this schema fail at 10x scale? What's 
the most likely failure mode in production? Which queries are hidden N+1 disasters? 
Where are the lock contention hot spots? What did I assume that I shouldn't have?`,

  final_plan: `Concrete list of actions. Each action is one MCP write tool call. Order them 
correctly: tables first, then indices, then relationships. Include validation steps.`,
};

const THINKING_PHASES = [
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
];

// In-memory thought log per session
let thoughtHistory = [];
let branches = {};

/** Allow other tools to inspect the thinking state. */
export function getThinkingState() {
  return {
    thoughtCount: thoughtHistory.length,
    hasMainThreadThoughts: thoughtHistory.length > 0,
    lastPhase: thoughtHistory.length > 0 ? thoughtHistory[thoughtHistory.length - 1].phase : null,
    lastThoughtNumber: thoughtHistory.length > 0 ? thoughtHistory[thoughtHistory.length - 1].number : 0,
  };
}

export function registerThinkingTools(server, store) {
  // --- think_about_schema ---
  server.tool(
    "think_about_schema",
    `STEP 1 OF DATABASE DESIGN: Sequential thinking tool. You MUST call this BEFORE any add_table, 
add_field, or add_relationship calls when designing a NEW schema. 

Call this REPEATEDLY (typically 10-15 times, once per design phase) to reason through the design 
step by step. Each call is one thought. After calling, IMMEDIATELY call this tool again with 
the next thought number. Only stop when nextThoughtNeeded=false.

Workflow:
1. Call this tool with thoughtNumber=1, phase="domain_analysis", totalThoughts=12, nextThoughtNeeded=true
2. Reason about the next phase, call again with thoughtNumber=2, etc.
3. Continue through all phases (workload, entities, relationships, indexing, partitioning, audit, etc.)
4. Final call sets nextThoughtNeeded=false and phase="final_plan"
5. THEN call add_table / add_field / add_relationship / add_index to execute the plan

PHASES (work through in order, but you can revisit/revise):
- domain_analysis: What is this system? Business rules?
- workload_analysis: Read/write ratios, TPS, data volume, access patterns
- entity_identification: Core tables and their purpose
- relationship_mapping: FKs, cardinality, referential actions
- normalization_decisions: Normalize vs denormalize and why
- indexing_strategy: Which columns need indices and why
- partitioning_strategy: Which tables need partitioning and by what key
- audit_compliance: Audit trails, event logs, soft deletes
- event_sourcing: Where to use append-only patterns
- performance_optimization: Materialized views, caching, read replicas
- migration_strategy: How to deploy this schema safely
- review_and_revise: Self-critique -- find flaws in your own design
- final_plan: Complete list of actions to execute

You can revise earlier thoughts (isRevision=true, revisesThought=N) or branch (branchId="alt-a").`,
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

      // Build response with senior-engineer persona + phase guidance
      const phaseIdx = THINKING_PHASES.indexOf(phase);
      const nextPhase =
        phaseIdx >= 0 && phaseIdx < THINKING_PHASES.length - 1
          ? THINKING_PHASES[phaseIdx + 1]
          : null;

      // Match templates against accumulated thought text using keyword scoring
      const relevantTemplates = matchTemplates(thoughtHistory);

      const response = {
        persona: SENIOR_DEV_PERSONA,
        thoughtRecorded: {
          number: thoughtNumber,
          totalThoughts: needsMoreThoughts ? totalThoughts + 3 : totalThoughts,
          phase,
          thoughtsRecorded: thoughtHistory.length,
        },
        currentSchema: {
          database: store.database || "(not yet decided -- ask user)",
          tables: store.tables.length,
          relationships: store.relationships.length,
        },
      };

      // Surface relevant templates during entity_identification phase
      if ((phase === "entity_identification" || nextPhase === "entity_identification") && relevantTemplates.length > 0) {
        response.relevant_templates = {
          note: "These pre-built templates closely match what you are designing. Consider apply_template to seed the schema, then customize with add_table/add_field. This saves significant time and ensures production patterns are followed.",
          matches: relevantTemplates,
        };
      }

      if (isRevision && revisesThought) {
        response.revisedThought = revisesThought;
        response.note = `Thought ${revisesThought} has been revised. Previous reasoning superseded.`;
      }

      if (nextThoughtNeeded) {
        const guidance = nextPhase
          ? PHASE_GUIDANCE[nextPhase]
          : "Continue reasoning toward the final plan.";
        response.next_action = {
          instruction: `IMMEDIATELY call think_about_schema again with thoughtNumber=${thoughtNumber + 1}. Do NOT call add_table or any write tools yet. Continue thinking like a senior architect.`,
          suggested_next_phase: nextPhase || phase,
          guidance_for_next_phase: guidance,
          remaining_thoughts: Math.max(0, totalThoughts - thoughtNumber),
        };
      } else {
        response.note =
          "Thinking complete. Now execute the design using add_table, add_field, add_relationship, add_index. After execution call validate_schema_quality and validate_constraints. Then export_to_file for a deployable SQL file.";
        response.thoughtSummary = thoughtHistory.map(
          (t) => `[${t.phase}] #${t.number}: ${t.thought.substring(0, 120)}`,
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

      const REVIEW_PHASES = [
        "structural_analysis",
        "relationship_analysis",
        "performance_analysis",
        "scalability_analysis",
        "integrity_analysis",
        "compliance_analysis",
        "operational_analysis",
        "recommendations",
      ];
      const phaseIdx = REVIEW_PHASES.indexOf(phase);
      const nextPhase =
        phaseIdx >= 0 && phaseIdx < REVIEW_PHASES.length - 1
          ? REVIEW_PHASES[phaseIdx + 1]
          : null;

      const response = {
        persona: SENIOR_DEV_PERSONA,
        thoughtRecorded: {
          number: thoughtNumber,
          totalThoughts,
          phase,
          severity,
        },
        findingsCount: {
          critical: thoughtHistory.filter((t) => t.severity === "critical").length,
          warning: thoughtHistory.filter((t) => t.severity === "warning").length,
          info: thoughtHistory.filter((t) => t.severity === "info").length,
          suggestion: thoughtHistory.filter((t) => t.severity === "suggestion").length,
        },
      };

      if (nextThoughtNeeded) {
        response.next_action = {
          instruction: `IMMEDIATELY call think_about_review again with thoughtNumber=${thoughtNumber + 1}. Continue the production review.`,
          suggested_next_phase: nextPhase || phase,
          remaining_thoughts: Math.max(0, totalThoughts - thoughtNumber),
        };
      } else {
        response.note =
          "Review complete. Use upgrade_to_production for a phased fix plan, or execute fixes directly with update_field, add_index, add_field, etc.";
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

      const EDIT_PHASES = [
        "impact_analysis",
        "backward_compatibility",
        "data_migration",
        "rollback_plan",
        "execution_order",
        "validation",
      ];
      const phaseIdx = EDIT_PHASES.indexOf(phase);
      const nextPhase =
        phaseIdx >= 0 && phaseIdx < EDIT_PHASES.length - 1
          ? EDIT_PHASES[phaseIdx + 1]
          : null;

      const response = {
        persona: SENIOR_DEV_PERSONA,
        thoughtRecorded: {
          number: thoughtNumber,
          totalThoughts,
          phase,
          risk,
          proposedChange: proposedChange || null,
        },
        currentSchema: {
          tables: store.tables.map((t) => t.name),
          relationships: store.relationships.length,
        },
      };

      if (nextThoughtNeeded) {
        response.next_action = {
          instruction: `IMMEDIATELY call think_about_edit again with thoughtNumber=${thoughtNumber + 1}. Reason like a senior engineer thinking about production safety.`,
          suggested_next_phase: nextPhase || phase,
          remaining_thoughts: Math.max(0, totalThoughts - thoughtNumber),
        };
      } else {
        response.note =
          "Edit planning complete. Execute the changes in the order determined during execution_order phase. Call validate_schema_quality and validate_constraints after.";
      }

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );
}


// --- Helpers ---

/**
 * Score templates against accumulated thought history using keyword matching.
 * Returns up to 3 best matches, sorted by score, only those with score > 0.
 */
function matchTemplates(thoughts) {
  if (!thoughts || thoughts.length === 0) return [];

  const corpus = thoughts
    .map((t) => (t.thought || "").toLowerCase())
    .join(" ");

  const scored = TEMPLATE_SUMMARIES.map((tmpl) => {
    let score = 0;
    for (const kw of tmpl.keywords) {
      if (corpus.includes(kw.toLowerCase())) score += 1;
    }
    if (corpus.includes(tmpl.domain.toLowerCase())) score += 2;
    return { ...tmpl, score };
  })
    .filter((t) => t.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored.map((t) => ({
    name: t.name,
    domain: t.domain,
    description: t.description,
    matched_keywords: t.score,
    apply_with: `apply_template({"template_name": "${t.name}"})`,
  }));
}
