/**
 * Smoke test -- verifies the DiagramStore loads correctly and tools produce output.
 * Run: node test/smoke.js
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DiagramStore } from "../src/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "fixtures/sample.json");

async function main() {
  const store = new DiagramStore(fixturePath);
  await store.load();

  console.log("=== Schema Summary ===");
  console.log(`Title: ${store.title}`);
  console.log(`Database: ${store.database}`);
  console.log(`Tables: ${store.tables.length}`);
  console.log(`Relationships: ${store.relationships.length}`);
  console.log(`Notes: ${store.notes.length}`);
  console.log();

  console.log("=== Tables ===");
  for (const t of store.tables) {
    console.log(`  ${t.name} (${t.fields.length} fields)`);
  }
  console.log();

  console.log("=== Describe 'users' ===");
  const users = store.findTable("users");
  if (users) {
    for (const f of users.fields) {
      const flags = [];
      if (f.primary) flags.push("PK");
      if (f.notNull) flags.push("NOT NULL");
      if (f.unique) flags.push("UNIQUE");
      if (f.increment) flags.push("AUTO_INCREMENT");
      console.log(`  ${f.name} ${f.type}${f.size ? `(${f.size})` : ""} ${flags.join(" ")}`);
    }
  }
  console.log();

  console.log("=== Relationships ===");
  for (const r of store.relationships) {
    const from = store.findTableById(r.startTableId);
    const to = store.findTableById(r.endTableId);
    const fromField = from?.fields.find((f) => String(f.id) === String(r.startFieldId));
    const toField = to?.fields.find((f) => String(f.id) === String(r.endFieldId));
    console.log(
      `  ${r.name}: ${from?.name}.${fromField?.name} -> ${to?.name}.${toField?.name} (${r.cardinality})`,
    );
  }
  console.log();

  console.log("=== Search 'user' ===");
  const q = "user";
  for (const table of store.tables) {
    const matchingFields = table.fields.filter((f) => f.name.toLowerCase().includes(q));
    if (table.name.toLowerCase().includes(q) || matchingFields.length > 0) {
      console.log(`  ${table.name}: [${matchingFields.map((f) => f.name).join(", ")}]`);
    }
  }

  console.log("\n[OK] All checks passed");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
