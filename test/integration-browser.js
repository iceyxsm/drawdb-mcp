/**
 * Live integration test for browser tools.
 * Requires Chrome running with --remote-debugging-port=9222 and DrawDB open.
 * Run: node test/integration-browser.js
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiagramStore } from "../src/store.js";
import { registerBrowserTools } from "../src/tools/browser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "fixtures/sample.json");

// Capture registered tool handlers
const handlers = {};
const fakeServer = {
  tool(name, description, schema, handler) {
    handlers[name] = handler;
  },
};

async function main() {
  const store = new DiagramStore(fixturePath);
  await store.load();

  registerBrowserTools(fakeServer, store);

  console.log("Registered tools:", Object.keys(handlers).join(", "));
  console.log();

  // Test 1: find_drawdb_tab
  console.log("=== Test 1: find_drawdb_tab ===");
  const findResult = await handlers.find_drawdb_tab({ host: "127.0.0.1", port: 9222 });
  console.log(findResult.content[0].text);
  console.log();

  if (findResult.isError) {
    console.error("FAIL: Cannot find DrawDB tab. Aborting.");
    process.exit(1);
  }

  // Test 2: open_in_drawdb
  console.log("=== Test 2: open_in_drawdb ===");
  const openResult = await handlers.open_in_drawdb({
    host: "127.0.0.1",
    port: 9222,
    reload: true,
  });
  console.log(openResult.content[0].text);
  console.log();

  if (openResult.isError) {
    console.error("FAIL: Could not push diagram to DrawDB.");
    process.exit(1);
  }

  console.log("[OK] All browser integration tests passed");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
