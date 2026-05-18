import { z } from "zod";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Browser integration tools using Chrome DevTools Protocol (CDP).
 *
 * The user launches Chrome once with:
 *   chrome --remote-debugging-port=9222
 * Then opens DrawDB in any tab (drawdb.app/editor or localhost:5173/editor).
 *
 * These tools connect to that running Chrome instance, find the DrawDB tab,
 * and inject the diagram directly into DrawDB's Dexie/IndexedDB store.
 * DrawDB then loads it normally on the next reload.
 */

const DEFAULT_CDP_HOST = "127.0.0.1";
const DEFAULT_CDP_PORT = 9222;

/**
 * Find Chrome/Chromium executable across platforms.
 */
function findChromePath() {
  const plat = platform();
  const candidates = [];

  if (plat === "win32") {
    candidates.push(
      join(process.env["ProgramFiles"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
      join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
      join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
      join(process.env["ProgramFiles"] || "C:\\Program Files", "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
    );
  } else if (plat === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    );
  } else {
    // Linux
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/brave-browser",
      "/snap/bin/chromium",
      "/snap/bin/google-chrome",
    );
  }

  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return null;
}

async function fetchTabs(host, port) {
  const res = await fetch(`http://${host}:${port}/json`);
  if (!res.ok) {
    throw new Error(
      `Failed to reach Chrome DevTools at ${host}:${port}. Make sure Chrome was started with --remote-debugging-port=${port}.`,
    );
  }
  return await res.json();
}

function findDrawDBTab(tabs) {
  return tabs.find(
    (t) =>
      t.type === "page" &&
      (t.url.includes("drawdb.app") ||
        t.url.includes("/editor") ||
        t.title.toLowerCase().includes("drawdb")),
  );
}

/**
 * Send a CDP command and wait for response.
 */
function cdpCall(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.off("message", handler);
        if (msg.error) {
          reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/**
 * Evaluate JavaScript in the target page and return the result.
 */
async function runInTab(wsUrl, jsExpression) {
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  try {
    const result = await cdpCall(ws, 1, "Runtime.evaluate", {
      expression: jsExpression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          "Script execution failed",
      );
    }

    return result.result?.value;
  } finally {
    ws.close();
  }
}

/**
 * Reload the target tab.
 */
async function reloadTab(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  try {
    await cdpCall(ws, 1, "Page.reload", { ignoreCache: true });
  } finally {
    ws.close();
  }
}

export function registerBrowserTools(server, store) {
  // --- launch_browser ---
  server.tool(
    "launch_browser",
    `Auto-detect and launch Chrome (Edge/Brave/Chromium) with remote debugging enabled,
then open DrawDB directly on the current diagram URL. The browser tab will land on
the empty diagram so the user can watch it fill in live as the AI pushes updates
via open_in_drawdb. If a debug-enabled browser is already running, this navigates
the existing tab to the diagram URL instead of opening a new one.`,
    {
      port: z
        .number()
        .int()
        .optional()
        .default(DEFAULT_CDP_PORT)
        .describe("CDP debug port to use"),
      base_url: z
        .string()
        .optional()
        .default("https://drawdb.app")
        .describe("DrawDB origin (e.g. https://drawdb.app or http://localhost:5173). The /editor/diagrams/<id> path is appended automatically."),
      browser_path: z
        .string()
        .optional()
        .describe("Optional explicit path to a Chromium-based browser executable"),
    },
    async ({ port, base_url, browser_path }) => {
      // Build the target URL pointing at our stable diagramId
      const cleanBase = base_url.replace(/\/+$/, "");
      const targetUrl = `${cleanBase}/editor/diagrams/${store.diagramId}`;

      // Make sure the diagram exists in DrawDB's IndexedDB before navigating,
      // otherwise the editor will show "diagram not found". We do this by
      // first opening DrawDB at /editor (so IndexedDB is initialized), seeding
      // our diagram, then navigating to the diagram URL.
      const seedUrl = `${cleanBase}/editor`;

      // First check if debug port is already open
      let alreadyRunning = false;
      try {
        await fetchTabs(DEFAULT_CDP_HOST, port);
        alreadyRunning = true;
      } catch {
        // Debug port not open -- launch browser
      }

      if (!alreadyRunning) {
        // Find browser executable
        const chromePath = browser_path || findChromePath();
        if (!chromePath) {
          return {
            content: [
              {
                type: "text",
                text: `Could not find Chrome, Edge, Brave, or Chromium installed.\nPlease install one of them, or pass browser_path explicitly.\n\nAlternatively, launch your browser manually with:\n  chrome --remote-debugging-port=${port}\nthen open ${seedUrl}`,
              },
            ],
            isError: true,
          };
        }

        // Launch with isolated user data dir to avoid conflicts with running Chrome
        const userDataDir = join(tmpdir(), "drawdb-mcp-browser");
        const args = [
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${userDataDir}`,
          "--no-first-run",
          "--no-default-browser-check",
          seedUrl,
        ];

        try {
          const child = spawn(chromePath, args, {
            detached: true,
            stdio: "ignore",
          });
          child.unref();

          // Wait up to 8 seconds for the debug port and DrawDB to be reachable
          let ready = false;
          for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 200));
            try {
              const tabs = await fetchTabs(DEFAULT_CDP_HOST, port);
              const tab = findDrawDBTab(tabs);
              if (tab) {
                ready = true;
                break;
              }
            } catch {
              // not ready yet
            }
          }

          if (!ready) {
            return {
              content: [
                {
                  type: "text",
                  text: `Browser launched but DrawDB did not become reachable within 8 seconds. Try find_drawdb_tab to check.`,
                },
              ],
              isError: true,
            };
          }
        } catch (e) {
          return {
            content: [{ type: "text", text: `Failed to launch browser: ${e.message}` }],
            isError: true,
          };
        }
      }

      // At this point the browser is running with a DrawDB tab. Find it.
      const tabs = await fetchTabs(DEFAULT_CDP_HOST, port);
      let drawdbTab = findDrawDBTab(tabs);

      if (!drawdbTab) {
        // Browser is running but no DrawDB tab -- open one
        await fetch(`http://${DEFAULT_CDP_HOST}:${port}/json/new?${encodeURIComponent(seedUrl)}`, {
          method: "PUT",
        });
        // Wait for it to register
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const tabs2 = await fetchTabs(DEFAULT_CDP_HOST, port);
          drawdbTab = findDrawDBTab(tabs2);
          if (drawdbTab) break;
        }
        if (!drawdbTab) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to open a DrawDB tab. Check that ${seedUrl} loads in the browser.`,
              },
            ],
            isError: true,
          };
        }
      }

      // Wait briefly for DrawDB JS to fully load IndexedDB before seeding
      await new Promise((r) => setTimeout(r, 1500));

      // Seed our (likely empty) diagram into IndexedDB so the diagram URL works
      const seedScript = buildUpsertScript({
        diagramId: store.diagramId,
        database: store.database,
        name: store.title || "MCP Generated Diagram",
        tables: store.tables,
        references: store.relationships,
        notes: store.notes,
        areas: store.subjectAreas,
        types: store.types,
        enums: store.enums,
      });

      try {
        await runInTab(drawdbTab.webSocketDebuggerUrl, seedScript);
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Browser is open but failed to seed diagram into IndexedDB: ${e.message}\n\nThe AI can still call open_in_drawdb -- it will retry the seed.`,
            },
          ],
        };
      }

      // Navigate the tab to the diagram URL
      await runInTab(
        drawdbTab.webSocketDebuggerUrl,
        `window.location.href = ${JSON.stringify(targetUrl)};`,
      );

      return {
        content: [
          {
            type: "text",
            text: `Browser ready and showing the diagram.\n  URL: ${targetUrl}\n  Diagram ID: ${store.diagramId}\n  Tables: ${store.tables.length}\n  Relationships: ${store.relationships.length}\n\nFlow:\n  1. The browser is now on the diagram page.\n  2. Continue designing -- each open_in_drawdb call updates the SAME diagram and reloads this tab.\n  3. The user can watch the diagram fill in live.`,
          },
        ],
      };
    },
  );

  // --- find_drawdb_tab ---
  server.tool(
    "find_drawdb_tab",
    "Check if Chrome is running with remote debugging enabled and find an open DrawDB tab. Use this to verify the browser connection is set up correctly.",
    {
      host: z.string().optional().default(DEFAULT_CDP_HOST).describe("CDP host"),
      port: z.number().int().optional().default(DEFAULT_CDP_PORT).describe("CDP port"),
    },
    async ({ host, port }) => {
      try {
        const tabs = await fetchTabs(host, port);
        const drawdbTab = findDrawDBTab(tabs);

        if (!drawdbTab) {
          return {
            content: [
              {
                type: "text",
                text: `Chrome is reachable at ${host}:${port} but no DrawDB tab is open.\n\nFound ${tabs.filter((t) => t.type === "page").length} page tab(s):\n${tabs
                  .filter((t) => t.type === "page")
                  .map((t) => `  - ${t.title} (${t.url})`)
                  .join("\n")}\n\nOpen drawdb.app/editor or localhost:5173/editor in Chrome and try again.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Found DrawDB tab:\n  Title: ${drawdbTab.title}\n  URL: ${drawdbTab.url}\n  WebSocket: ${drawdbTab.webSocketDebuggerUrl}\n\nReady to push diagrams to this tab.`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${e.message}\n\nTo enable browser integration:\n1. Close all Chrome windows\n2. Launch Chrome with: chrome --remote-debugging-port=9222\n3. Open drawdb.app/editor or your local DrawDB instance\n4. Try again.`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // --- open_in_drawdb ---
  server.tool(
    "open_in_drawdb",
    `Push the current diagram into a running DrawDB browser tab via Chrome DevTools Protocol.
Requires Chrome to be launched with --remote-debugging-port=9222 and DrawDB open in a tab.
The diagram is written directly into DrawDB's IndexedDB store. By default, opens the new
diagram in a new tab so previous work stays visible. Pass new_tab: false to navigate the
existing tab instead.`,
    {
      host: z.string().optional().default(DEFAULT_CDP_HOST).describe("CDP host"),
      port: z.number().int().optional().default(DEFAULT_CDP_PORT).describe("CDP port"),
      new_tab: z
        .boolean()
        .optional()
        .default(true)
        .describe("Open the diagram in a new browser tab (default true). Set false to navigate the existing tab."),
    },
    async ({ host, port, new_tab }) => {
      try {
        const tabs = await fetchTabs(host, port);
        const drawdbTab = findDrawDBTab(tabs);

        if (!drawdbTab) {
          return {
            content: [
              {
                type: "text",
                text: `No DrawDB tab found at ${host}:${port}. Open drawdb.app/editor or your local DrawDB instance in Chrome.`,
              },
            ],
            isError: true,
          };
        }

        // Build upsert script using shared helper.
        // Use the stable diagramId from the store so each push UPDATES the same diagram.
        const injectScript = buildUpsertScript({
          diagramId: store.diagramId,
          database: store.database,
          name: store.title || "MCP Generated Diagram",
          tables: store.tables,
          references: store.relationships,
          notes: store.notes,
          areas: store.subjectAreas,
          types: store.types,
          enums: store.enums,
        });

        const result = await runInTab(drawdbTab.webSocketDebuggerUrl, injectScript);

        if (!result || !result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to inject diagram. Result: ${JSON.stringify(result)}`,
              },
            ],
            isError: true,
          };
        }

        // Determine the target URL (preserve origin: drawdb.app or localhost)
        let origin;
        try {
          origin = new URL(drawdbTab.url).origin;
        } catch {
          origin = "https://drawdb.app";
        }
        const targetUrl = `${origin}/editor/diagrams/${result.diagramId}`;

        // If the tab is already showing this exact diagram (same diagramId in URL),
        // just reload to pick up the latest data instead of opening a new tab.
        const tabAlreadyOnDiagram = drawdbTab.url.includes(result.diagramId);

        if (tabAlreadyOnDiagram) {
          // Reload the existing tab so DrawDB re-reads from IndexedDB
          await reloadTab(drawdbTab.webSocketDebuggerUrl);
        } else if (new_tab && result.action === "created") {
          // Only open a new tab when this is the first push of a new diagram.
          // Subsequent updates to the same diagramId will reload the existing tab.
          const newTabRes = await fetch(
            `http://${host}:${port}/json/new?${encodeURIComponent(targetUrl)}`,
            { method: "PUT" },
          );
          if (!newTabRes.ok) {
            // Fallback: navigate the existing tab
            const navScript = `window.location.href = '${targetUrl}';`;
            await runInTab(drawdbTab.webSocketDebuggerUrl, navScript);
          }
        } else {
          // Navigate the existing tab to the diagram URL
          const navScript = `window.location.href = '${targetUrl}';`;
          await runInTab(drawdbTab.webSocketDebuggerUrl, navScript);
        }

        const actionDescription = tabAlreadyOnDiagram
          ? "Existing tab reloaded to show updated diagram."
          : result.action === "updated"
            ? "Diagram updated in DrawDB. Tab navigated to it."
            : new_tab
              ? "Opened in a new tab."
              : "Existing tab navigated to the new diagram.";

        return {
          content: [
            {
              type: "text",
              text: `Diagram synced to DrawDB.\n  Action: ${result.action}\n  Diagram ID: ${result.diagramId}\n  Tables: ${store.tables.length}\n  Relationships: ${store.relationships.length}\n  ${actionDescription}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${e.message}\n\nTroubleshooting:\n1. Make sure Chrome is running with --remote-debugging-port=${port}\n2. Make sure DrawDB is open in a tab\n3. Run find_drawdb_tab to verify the connection`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // --- reload_drawdb_tab ---
  server.tool(
    "reload_drawdb_tab",
    "Reload the DrawDB tab in the connected Chrome instance. Useful after manual edits to the diagram file.",
    {
      host: z.string().optional().default(DEFAULT_CDP_HOST).describe("CDP host"),
      port: z.number().int().optional().default(DEFAULT_CDP_PORT).describe("CDP port"),
    },
    async ({ host, port }) => {
      try {
        const tabs = await fetchTabs(host, port);
        const drawdbTab = findDrawDBTab(tabs);

        if (!drawdbTab) {
          return {
            content: [{ type: "text", text: `No DrawDB tab found at ${host}:${port}.` }],
            isError: true,
          };
        }

        await reloadTab(drawdbTab.webSocketDebuggerUrl);

        return {
          content: [{ type: "text", text: "DrawDB tab reloaded." }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    },
  );
}

function randomUUID() {
  // Simple UUID v4 generator (works in Node 18+ which has crypto.randomUUID, but stay compatible)
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Build the JS expression that upserts a diagram into DrawDB's IndexedDB.
 * Looks up by diagramId index; updates if found, inserts if not.
 */
function buildUpsertScript(diagram) {
  const dexieDiagram = {
    diagramId: diagram.diagramId,
    database: diagram.database || "",
    name: diagram.name || "Untitled",
    gistId: "",
    lastModified: new Date().toISOString(),
    tables: diagram.tables || [],
    references: diagram.references || [],
    notes: diagram.notes || [],
    areas: diagram.areas || [],
    types: diagram.types || [],
    enums: diagram.enums || [],
    pan: { x: 0, y: 0 },
    zoom: 1,
    loadedFromGistId: null,
  };

  return `
(async () => {
  const diagramData = ${JSON.stringify(dexieDiagram)};
  const dbRequest = indexedDB.open('drawDB');

  return new Promise((resolve, reject) => {
    dbRequest.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction(['diagrams'], 'readwrite');
      const store = tx.objectStore('diagrams');
      const idx = store.index('diagramId');
      const lookup = idx.get(diagramData.diagramId);

      lookup.onsuccess = () => {
        const existing = lookup.result;
        if (existing) {
          const updated = { ...existing, ...diagramData, id: existing.id };
          const putReq = store.put(updated);
          putReq.onsuccess = () => resolve({ success: true, diagramId: diagramData.diagramId, internalId: existing.id, action: 'updated' });
          putReq.onerror = (e) => reject(new Error('Failed to update diagram: ' + e.target.error.message));
        } else {
          const addReq = store.add(diagramData);
          addReq.onsuccess = () => resolve({ success: true, diagramId: diagramData.diagramId, internalId: addReq.result, action: 'created' });
          addReq.onerror = (e) => reject(new Error('Failed to add diagram: ' + e.target.error.message));
        }
      };
      lookup.onerror = (e) => reject(new Error('Lookup failed: ' + e.target.error.message));
    };
    dbRequest.onerror = (event) => reject(new Error('Failed to open drawDB IndexedDB: ' + event.target.error.message));
    dbRequest.onblocked = () => reject(new Error('IndexedDB access blocked'));
  });
})()`;
}
