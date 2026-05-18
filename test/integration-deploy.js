/**
 * Live integration test for deploy tools.
 * Exports schemas in all 6 dialects + bundles, verifies outputs.
 * Run: node test/integration-deploy.js
 */
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DiagramStore } from "../src/store.js";
import { registerDeployTools } from "../src/tools/deploy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "fixtures/sample.json");
const outDir = resolve(__dirname, "tmp-deploy-output");

const handlers = {};
const fakeServer = {
  tool(name, _description, _schema, handler) {
    handlers[name] = handler;
  },
};

let pass = 0;
let fail = 0;

function check(condition, msg) {
  if (condition) {
    pass++;
    console.log(`  [OK] ${msg}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${msg}`);
  }
}

async function main() {
  // Clean output dir
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const store = new DiagramStore(fixturePath);
  await store.load();

  registerDeployTools(fakeServer, store);

  const dialects = ["postgresql", "mysql", "sqlite", "mariadb", "transactsql", "oraclesql"];

  // Test export_to_file for each dialect
  for (const dialect of dialects) {
    console.log(`\n=== Testing export_to_file: ${dialect} ===`);
    const file = join(outDir, `schema_${dialect}.sql`);
    const result = await handlers.export_to_file({
      output_path: file,
      dialect,
      include_drop: false,
      transactional: true,
    });

    check(!result.isError, "tool returned without error");
    check(existsSync(file), "file was created");

    const content = await readFile(file, "utf-8");
    check(content.length > 0, "file has content");
    check(content.includes("CREATE TABLE"), "contains CREATE TABLE");
    check(content.includes("users"), "contains users table");
    check(content.includes("posts"), "contains posts table");
    check(content.includes("comments"), "contains comments table");

    // Dialect-specific checks
    if (dialect === "postgresql") {
      check(content.includes("BEGIN;"), "PG: has transaction");
      check(content.includes("TIMESTAMPTZ"), "PG: uses TIMESTAMPTZ");
      check(content.includes('"users"'), "PG: double-quoted identifiers");
    }
    if (dialect === "mysql") {
      check(content.includes("AUTO_INCREMENT"), "MySQL: AUTO_INCREMENT");
      check(content.includes("ENGINE=InnoDB"), "MySQL: ENGINE=InnoDB");
      check(content.includes("`users`"), "MySQL: backtick-quoted identifiers");
    }
    if (dialect === "sqlite") {
      check(content.includes("AUTOINCREMENT"), "SQLite: AUTOINCREMENT");
      check(content.includes("FOREIGN KEY"), "SQLite: inline FKs");
    }
    if (dialect === "mariadb") {
      check(content.includes("CREATE TABLE IF NOT EXISTS"), "MariaDB: IF NOT EXISTS");
    }
    if (dialect === "transactsql") {
      check(content.includes("IDENTITY(1,1)"), "MSSQL: IDENTITY");
      check(content.includes("[users]"), "MSSQL: bracket-quoted identifiers");
    }
    if (dialect === "oraclesql") {
      check(content.includes("VARCHAR2"), "Oracle: VARCHAR2");
      check(content.includes("GENERATED ALWAYS AS IDENTITY"), "Oracle: GENERATED IDENTITY");
    }
  }

  // Test export_deployment_bundle for postgresql
  console.log("\n=== Testing export_deployment_bundle ===");
  const bundleDir = join(outDir, "bundle_pg");
  const bundleResult = await handlers.export_deployment_bundle({
    output_dir: bundleDir,
    dialect: "postgresql",
  });

  check(!bundleResult.isError, "bundle export succeeded");
  check(existsSync(join(bundleDir, "schema.sql")), "schema.sql created");
  check(existsSync(join(bundleDir, "indices.sql")), "indices.sql created");
  check(existsSync(join(bundleDir, "rollback.sql")), "rollback.sql created");
  check(existsSync(join(bundleDir, "README.md")), "README.md created");

  const schemaContent = await readFile(join(bundleDir, "schema.sql"), "utf-8");
  const indicesContent = await readFile(join(bundleDir, "indices.sql"), "utf-8");
  const rollbackContent = await readFile(join(bundleDir, "rollback.sql"), "utf-8");
  const readmeContent = await readFile(join(bundleDir, "README.md"), "utf-8");

  check(schemaContent.includes("CREATE TABLE"), "schema.sql has CREATE TABLE");
  check(!schemaContent.includes("CREATE INDEX"), "schema.sql does NOT have indices (separated)");
  check(indicesContent.includes("CREATE"), "indices.sql has CREATE statements");
  check(rollbackContent.includes("DROP TABLE"), "rollback.sql has DROP TABLE");
  check(readmeContent.includes("Deployment"), "README has deployment instructions");
  check(readmeContent.includes("psql"), "README has psql command");

  // Test with include_drop
  console.log("\n=== Testing include_drop option ===");
  const dropFile = join(outDir, "schema_with_drop.sql");
  const dropResult = await handlers.export_to_file({
    output_path: dropFile,
    dialect: "postgresql",
    include_drop: true,
  });
  check(!dropResult.isError, "include_drop succeeded");
  const dropContent = await readFile(dropFile, "utf-8");
  check(dropContent.includes("DROP TABLE"), "include_drop adds DROP TABLE");
  check(dropContent.indexOf("DROP TABLE") < dropContent.indexOf("CREATE TABLE"), "DROP comes before CREATE");

  // Test subset of tables
  console.log("\n=== Testing tables filter ===");
  const subsetFile = join(outDir, "subset.sql");
  await handlers.export_to_file({
    output_path: subsetFile,
    dialect: "postgresql",
    tables: ["users"],
  });
  const subsetContent = await readFile(subsetFile, "utf-8");
  check(subsetContent.includes('"users"'), "subset includes users");
  check(!subsetContent.includes('CREATE TABLE IF NOT EXISTS "posts"'), "subset excludes posts");

  // Cleanup
  await rm(outDir, { recursive: true, force: true });

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
