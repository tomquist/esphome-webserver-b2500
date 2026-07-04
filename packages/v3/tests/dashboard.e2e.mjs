// End-to-end regression test for the B2500 web UI dashboard.
//
// Boots the real single-file build (../../_static/v3/index.html, produced by
// `vite build`) in a headless browser against a mock ESPHome web server, then
// asserts the behaviour we care about at the HTTP boundary:
//
//   1. More than three storages render (up to MAX_STORAGES), and storages that
//      report no data collapse instead of leaving gaps.
//   2. Control POSTs carry `Content-Type: application/x-www-form-urlencoded`
//      (issue #276 — web_server_idf rejects the browser default text/plain).
//   3. The storage output toggle actually issues a POST to its switch endpoint
//      (regression guard for the duplicate-`case` bug that left it dead).
//
// Run with: npm run test:e2e  (which builds first). Requires the Playwright
// browsers to be installed (`npx playwright install chromium`).

import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(__dirname, "..", "..", "..", "_static", "v3", "index.html");

if (!fs.existsSync(INDEX)) {
  console.error(`Build output not found at ${INDEX}. Run \`vite build\` first.`);
  process.exit(2);
}

// Which storages report data (non-contiguous on purpose: proves each storage is
// addressed independently, not just "the first N").
const ONLINE_STORAGES = [1, 2, 3, 4, 5];
const posts = []; // control POSTs captured at the mock server (shared in-process)

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      posts.push({ url, contentType: req.headers["content-type"] || null, body });
      res.writeHead(200);
      res.end("OK");
    });
    return;
  }

  if (url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event, data) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send("ping", { title: "Test B2500", uptime: 123 });

    for (const idx of ONLINE_STORAGES) {
      send("state", { id: `text-b2500_-_${idx}_-_x__device_type`, value: `HMB-${idx}` });
      send("state", { id: `sensor-b2500_-_${idx}_-_x__battery_level`, value: 40 + idx });
    }

    // Make storage 1 a gen-1 device with an interactive output toggle, backed by
    // a real switch entity so the toggle has something to POST to.
    send("state", { id: `text-b2500_-_1_-_x__generation`, value: "1" });
    send("state", { id: `sensor-b2500_-_1_-_x__out_1_-_power`, value: 120 });
    send("state", { id: `switch-b2500_-_1_-_x__out_1_-_active`, value: false });

    // Entities whose object id (sanitized ESPHome name) must be matched exactly.
    // Guards against regressions like `dod` vs `depth_of_discharge` and
    // `mac` vs `mac_address`.
    send("state", {
      id: `number-b2500_-_1_-_x__depth_of_discharge`,
      value: 80,
      min_value: 0,
      max_value: 90,
    });
    send("state", { id: `text_sensor-b2500_-_1_-_x__mac_address`, value: "AA:BB:CC:DD:EE:FF" });

    // A standard assumed-state switch in the entity table -> plain ❌/✔️ buttons.
    send("state", {
      id: "switch-test_relay",
      name: "Test Relay",
      domain: "switch",
      assumed_state: true,
      state: "OFF",
      value: "OFF",
      entity_category: 0,
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fs.readFileSync(INDEX));
});

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exitCode = 1;
};

await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[page error]", e.message));

  await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });

  // Wait for the dashboard + entity-table + the interactive output toggle.
  const ui = await page
    .waitForFunction(
      () => {
        const app = document.querySelector("esp-app");
        const dash = app?.shadowRoot?.querySelector("solar-storage-dashboard");
        const table = app?.shadowRoot?.querySelector("esp-entity-table");
        if (!dash || !table) return false;
        const uis = Array.from(dash.shadowRoot.querySelectorAll("solar-storage-ui"));
        const visible = uis.filter((el) => el.hasAttribute("active"));
        const relayBtn = Array.from(
          table.shadowRoot.querySelectorAll("button.abutton")
        ).find((b) => b.textContent.includes("✔️"));
        const storage1 = uis.find((el) => el.getAttribute("number") === "1");
        const outBoxEl =
          storage1 &&
          Array.from(storage1.shadowRoot.querySelectorAll("wattage-status-box")).find(
            (b) => b.getAttribute("label") === "🔼 Out1"
          );
        // The clickable <button> lives inside the box's own shadow root.
        const outBtn = outBoxEl?.shadowRoot?.querySelector("button");
        if (visible.length < 4 || !relayBtn || !outBtn) return false;
        return {
          total: uis.length,
          visible: visible.length,
          storages: visible.map((e) => e.getAttribute("number")),
          hiddenCollapsed: uis
            .filter((e) => !e.hasAttribute("active"))
            .every((e) => getComputedStyle(e).display === "none"),
        };
      },
      { timeout: 10000 }
    )
    .then((h) => h.jsonValue())
    .catch(() => null);

  if (!ui) {
    fail("dashboard/entity-table/output-toggle did not render in time");
  } else {
    console.log("rendered:", JSON.stringify(ui));

    // (1) multi-storage + collapse
    if (ui.total !== 9) fail(`expected 9 storage slots, got ${ui.total}`);
    if (ui.visible !== ONLINE_STORAGES.length)
      fail(`expected ${ONLINE_STORAGES.length} visible storages, got ${ui.visible}`);
    if (!ui.hiddenCollapsed) fail("storages without data did not collapse to display:none");

    // (1b) sensor id mappings resolve (guards `dod`/`mac` object-id regressions)
    const mapped = await page.evaluate(() => {
      const s1 = Array.from(
        document
          .querySelector("esp-app")
          .shadowRoot.querySelector("solar-storage-dashboard")
          .shadowRoot.querySelectorAll("solar-storage-ui")
      ).find((el) => el.getAttribute("number") === "1");
      return { dod: s1.dod, dodMax: s1.dodMax, mac: s1.mac };
    });
    console.log("mapped sensors:", JSON.stringify(mapped));
    if (mapped.dod !== 80) fail(`depth_of_discharge not mapped to dod (got ${mapped.dod})`);
    if (mapped.mac !== "AA:BB:CC:DD:EE:FF") fail(`mac_address not mapped to mac (got ${mapped.mac})`);

    // (2) entity-table switch -> POST content type (issue #276)
    await page.evaluate(() => {
      const table = document
        .querySelector("esp-app")
        .shadowRoot.querySelector("esp-entity-table");
      Array.from(table.shadowRoot.querySelectorAll("button.abutton"))
        .find((b) => b.textContent.includes("✔️"))
        .click();
    });

    // (3) storage output toggle -> POST to switch endpoint (duplicate-case fix)
    await page.evaluate(() => {
      const dash = document
        .querySelector("esp-app")
        .shadowRoot.querySelector("solar-storage-dashboard");
      const s1 = Array.from(dash.shadowRoot.querySelectorAll("solar-storage-ui")).find(
        (el) => el.getAttribute("number") === "1"
      );
      const box = Array.from(s1.shadowRoot.querySelectorAll("wattage-status-box")).find(
        (b) => b.getAttribute("label") === "🔼 Out1"
      );
      box.shadowRoot.querySelector("button").click();
    });

    await page.waitForTimeout(400);

    console.log("captured POSTs:", JSON.stringify(posts));

    const badType = posts.filter(
      (p) => p.contentType !== "application/x-www-form-urlencoded"
    );
    if (posts.length < 2) fail(`expected >=2 control POSTs, got ${posts.length}`);
    if (badType.length) fail(`POST(s) with wrong Content-Type: ${JSON.stringify(badType)}`);
    if (!posts.some((p) => p.url === "/switch/test_relay/turn_on"))
      fail("entity-table switch did not POST /switch/test_relay/turn_on");
    if (!posts.some((p) => p.url.startsWith("/switch/") && p.url.endsWith("/turn_on") && p.url.includes("out_1_-_active")))
      fail("storage output toggle did not POST to its switch turn_on endpoint");
  }
} finally {
  await browser.close();
  server.close();
}

if (process.exitCode) {
  console.error("\nE2E RESULT: FAIL ✗");
} else {
  console.log("\nE2E RESULT: PASS ✓");
}
