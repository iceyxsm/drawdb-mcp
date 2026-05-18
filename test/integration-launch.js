/**
 * Live integration test for launch_browser + full flow.
 * Run: node test/integration-launch.js
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DiagramStore } from "../src/store.js";
import { registerBrowserTools } from "../src/tools/browser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "fixtures/sample.json");

const handlers = {};
const fakeServer = {
  tool(name, _description, _schema, handler) {
    handlers[name] = handler;
  },
};

async function main() {
  const store = new DiagramStore(fixturePath);
  await store.load();

  registerBrowserTools(fakeServer, store);

  console.log("Registered tools:", Object.keys(handlers).join(", "));
  console.log();

  // Test 1: launch_browser (auto-find Chrome)
  console.log("=== Test 1: launch_browser (auto-detect) ===");
  const launchResult = await handlers.launch_browser({
    port: 9222,
    url: "https://drawdb.app/editor",
  });
  console.log(launchResult.content[0].text);
  console.log();

  if (launchResult.isError) {
    console.error("FAIL: launch_browser failed");
    process.exit(1);
  }

  // Wait a bit more for DrawDB to fully load
  await new Promise((r) => setTimeout(r, 3000));

  // Test 2: find_drawdb_tab
  console.log("=== Test 2: find_drawdb_tab ===");
  const findResult = await handlers.find_drawdb_tab({ host: "127.0.0.1", port: 9222 });
  console.log(findResult.content[0].text);
  console.log();

  if (findResult.isError) {
    console.error("FAIL: find_drawdb_tab failed");
    process.exit(1);
  }

  // Test 3: open_in_drawdb
  console.log("=== Test 3: open_in_drawdb ===");
  const openResult = await handlers.open_in_drawdb({
    host: "127.0.0.1",
    port: 9222,
    new_tab: true,
  });
  console.log(openResult.content[0].text);
  console.log();

  if (openResult.isError) {
    console.error("FAIL: open_in_drawdb failed");
    process.exit(1);
  }

  // Test 4: launch_browser again (should detect already running)
  console.log("=== Test 4: launch_browser (re-run, should detect existing) ===");
  const relaunchResult = await handlers.launch_browser({
    port: 9222,
    url: "https://drawdb.app/editor",
  });
  console.log(relaunchResult.content[0].text);
  console.log();

  console.log("[OK] Full launch flow works end-to-end");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
