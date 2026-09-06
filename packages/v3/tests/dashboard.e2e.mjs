// End-to-end regression test for the B2500 web UI dashboard.
//
// Boots the real single-file build (../../_static/v3/index.html, produced by
// `vite build`) in a headless browser against a mock ESPHome web server, then
// asserts the behaviour we care about at the HTTP boundary:
//
//   1. Storages are discovered dynamically, one card per ESPHome sub-device,
//      working with ALL three id formats ESPHome has shipped: the hierarchical
//      "domain/device/name" sent as `name_id` (<= 2026.7) and as `id` (>= 2026.8,
//      which dropped `name_id`), plus the legacy object-id format.
//   2. Sensor ids map correctly (guards `dod`/`mac` object-id regressions).
//   3. An event stream in which nothing parses (a future format change) is
//      reported in the UI instead of silently rendering an empty dashboard.
//   4. Control POSTs carry `Content-Type: application/x-www-form-urlencoded`
//      (issue #276) and target the right endpoint: the hierarchical
//      /{domain}/{device}/{name}/{action} for sub-devices (object ids collide
//      across devices with simplified names), and the legacy object-id endpoint
//      otherwise.
//   5. Entity-table rows spend their width on the name rather than on an empty
//      value column, so long entity names are not ellipsized while half the row
//      sits unused next to them (issue #308).
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

const posts = []; // control POSTs captured at the mock server (shared in-process)

// Entity names long enough that the pre-fix layout (a fixed 40%/50% split)
// ellipsized them even though the row had room to spare.
const LONG_READONLY_NAME = "B2500 - 1 - Balkon: Total Battery Charging Energy";
const LONG_SLIDER_NAME = "B2500 - 1 - Balkon: Output Power Limit Setting";

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

    // --- Device M: modern sub-device with simplified names (name_id present).
    // object ids collide across devices, so control actions must use the
    // hierarchical /{domain}/{device}/{name}/{action} endpoint.
    const m = (domain, name, extra = {}) =>
      send("state", {
        id: `${domain}-${name.toLowerCase().replace(/[^a-z0-9-]+/g, "_")}`,
        name_id: `${domain}/Balkon/${name}`,
        ...extra,
      });
    m("text_sensor", "Device Type", { value: "HMB" });
    m("sensor", "Battery Level", { value: 61 });
    m("text_sensor", "Generation", { value: "1" });
    m("sensor", "Out 1 - Power", { value: 120 });
    m("switch", "Out 1 - Active", { value: false });
    m("number", "Depth of Discharge", { value: 80, min_value: 0, max_value: 90 });
    m("text_sensor", "MAC Address", { value: "AA:BB:CC:DD:EE:FF" });

    // --- Device G: modern firmware with legacy entity names (the current
    // config-generator default): name_id carries the "B2500 - N - store:" prefix,
    // which must be stripped down to the bare sensor key.
    const g = (domain, name, extra = {}) =>
      send("state", {
        id: `${domain}-b2500_-_2_-_garage__${name.toLowerCase().replace(/[^a-z0-9-]+/g, "_")}`,
        name_id: `${domain}/Garage/B2500 - 2 - Garage: ${name}`,
        ...extra,
      });
    g("text_sensor", "Device Type", { value: "HMB" });
    g("number", "Depth of Discharge", { value: 55, min_value: 0, max_value: 90 });

    // --- Device D: ESPHome >= 2026.8, which removed `name_id` and moved the
    // hierarchical "domain/device/name" form into `id` (discussion #305).
    const d = (domain, name, extra = {}) =>
      send("state", { id: `${domain}/Dach/B2500 - 4 - Dach: ${name}`, ...extra });
    d("text_sensor", "Device Type", { value: "HMB" });
    d("sensor", "Battery Level", { value: 33 });
    d("text_sensor", "Generation", { value: "1" });
    d("switch", "Out 1 - Active", { value: false });

    // --- Device L: legacy object-id format, no name_id (older firmware).
    const l = (domain, key, extra = {}) =>
      send("state", { id: `${domain}-b2500_-_3_-_keller__${key}`, ...extra });
    l("text_sensor", "device_type", { value: "HMA" });
    l("sensor", "battery_level", { value: 47 });

    // Long-named global entities for the entity-table layout check (issue #308).
    // Like the relay below they carry no sub-device, so the dashboard ignores
    // them and only the entity table renders them.
    send("state", {
      id: "sensor-layout_probe_readonly",
      name: LONG_READONLY_NAME,
      domain: "sensor",
      state: "61 %",
      value: 61,
      entity_category: 0,
    });
    send("state", {
      id: "number-layout_probe_slider",
      name: LONG_SLIDER_NAME,
      domain: "number",
      state: "80",
      value: 80,
      min_value: 0,
      max_value: 90,
      step: 1,
      uom: "%",
      mode: 0,
      entity_category: 0,
    });

    // A standard global assumed-state switch in the entity table (issue #276);
    // it has no sub-device, so the dashboard ignores it.
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

  // Wait for both storage cards + the modern card's interactive output toggle.
  const ui = await page
    .waitForFunction(
      () => {
        const app = document.querySelector("esp-app");
        const dash = app?.shadowRoot?.querySelector("solar-storage-dashboard");
        const table = app?.shadowRoot?.querySelector("esp-entity-table");
        if (!dash || !table) return false;
        const cards = Array.from(dash.shadowRoot.querySelectorAll("solar-storage-ui"));
        const relayBtn = Array.from(
          table.shadowRoot.querySelectorAll("button.abutton")
        ).find((b) => b.textContent.includes("✔️"));
        const balkon = cards.find((c) => c.device === "Balkon");
        const garage = cards.find((c) => c.device === "Garage");
        const dach = cards.find((c) => c.device === "Dach");
        const outButton = (card) =>
          card &&
          Array.from(card.shadowRoot.querySelectorAll("wattage-status-box"))
            .find((b) => b.getAttribute("label") === "🔼 Out1")
            ?.shadowRoot?.querySelector("button");
        if (cards.length < 4 || !relayBtn || !outButton(balkon) || !garage) return false;
        if (!outButton(dach)) return false;
        return {
          devices: cards.map((c) => c.device),
          active: cards.map((c) => c.hasAttribute("active")),
          headers: cards.map((c) => c.shadowRoot.querySelector(".tab-header")?.textContent),
          balkon: { dod: balkon.dod, dodMax: balkon.dodMax, mac: balkon.mac, gen: balkon.deviceGeneration },
          garageDod: garage.dod,
          dachBattery: dach.batteryPercentage,
        };
      },
      { timeout: 10000 }
    )
    .then((h) => h.jsonValue())
    .catch(() => null);

  if (!ui) {
    fail("storage cards / entity-table / output toggle did not render in time");
  } else {
    console.log("ui:", JSON.stringify(ui));

    // (1) dynamic discovery: one card per sub-device, all id formats
    if (ui.devices.length !== 4) fail(`expected 4 storage cards, got ${ui.devices.length}`);
    if (!ui.devices.includes("Balkon")) fail("modern simplified-name device 'Balkon' not discovered");
    if (!ui.devices.includes("Garage")) fail("modern legacy-name device 'Garage' not discovered");
    if (!ui.devices.includes("Dach")) fail("ESPHome >= 2026.8 device 'Dach' (id without name_id) not discovered");
    if (!ui.devices.includes("#3")) fail("legacy object-id device '#3' not discovered");
    if (!ui.active.every(Boolean)) fail(`some storage card is not active: ${JSON.stringify(ui.active)}`);
    if (!ui.headers.includes("Balkon")) fail(`modern card header should be device name: ${ui.headers}`);
    if (!ui.headers.includes("Storage 3")) fail(`legacy card header should be "Storage 3": ${ui.headers}`);

    // (2) sensor id mapping across naming modes
    if (ui.balkon.dod !== 80) fail(`simplified: Depth of Discharge not mapped (got ${ui.balkon.dod})`);
    if (ui.balkon.mac !== "AA:BB:CC:DD:EE:FF") fail(`simplified: MAC Address not mapped (got ${ui.balkon.mac})`);
    if (ui.garageDod !== 55) fail(`legacy-name prefix not stripped: Depth of Discharge not mapped (got ${ui.garageDod})`);
    if (ui.dachBattery !== 33) fail(`2026.8 id format: Battery Level not mapped (got ${ui.dachBattery})`);

    // (3a) modern sub-device toggle -> hierarchical, url-encoded endpoint
    const clickOut1 = (device) =>
      page.evaluate((name) => {
        const card = Array.from(
          document.querySelector("esp-app").shadowRoot
            .querySelector("solar-storage-dashboard").shadowRoot
            .querySelectorAll("solar-storage-ui")
        ).find((c) => c.device === name);
        Array.from(card.shadowRoot.querySelectorAll("wattage-status-box"))
          .find((b) => b.getAttribute("label") === "🔼 Out1")
          .shadowRoot.querySelector("button")
          .click();
      }, device);
    await clickOut1("Balkon");
    await clickOut1("Dach");

    // (3b) global entity-table switch -> POST content type (issue #276)
    await page.evaluate(() => {
      const table = document
        .querySelector("esp-app")
        .shadowRoot.querySelector("esp-entity-table");
      Array.from(table.shadowRoot.querySelectorAll("button.abutton"))
        .find((b) => b.textContent.includes("✔️"))
        .click();
    });

    await page.waitForTimeout(400);
    console.log("captured POSTs:", JSON.stringify(posts));

    if (posts.some((p) => p.contentType !== "application/x-www-form-urlencoded"))
      fail(`POST(s) with wrong Content-Type: ${JSON.stringify(posts)}`);
    if (!posts.some((p) => p.url === "/switch/Balkon/Out%201%20-%20Active/turn_on"))
      fail("sub-device toggle did not POST the hierarchical endpoint");
    if (!posts.some((p) => p.url === "/switch/Dach/B2500%20-%204%20-%20Dach%3A%20Out%201%20-%20Active/turn_on"))
      fail("2026.8 id format: toggle did not POST the hierarchical endpoint");
    if (!posts.some((p) => p.url === "/switch/test_relay/turn_on"))
      fail("entity-table switch did not POST /switch/test_relay/turn_on");
  }

  // (4) A stream whose entities parse to nothing at all -- what an unhandled
  // ESPHome format change looks like -- must say so rather than render nothing.
  const brokenServer = http.createServer((req, res) => {
    if (req.url.split("?")[0] === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: ping\ndata: ${JSON.stringify({ title: "Broken", uptime: 1 })}\n\n`);
      for (const key of ["device_type", "battery_level", "out_1_-_power"]) {
        // A shape neither parser branch understands (no slash, no b2500 prefix).
        res.write(
          `event: state\ndata: ${JSON.stringify({ id: `sensor-future_format_${key}`, value: 1 })}\n\n`
        );
      }
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(INDEX));
  });
  await new Promise((r) => brokenServer.listen(0, r));
  const brokenPort = brokenServer.address().port;

  try {
    const page2 = await browser.newPage();
    const warnings = [];
    page2.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
    await page2.goto(`http://localhost:${brokenPort}/`, { waitUntil: "load" });

    const notice = await page2
      .waitForFunction(
        () =>
          document
            .querySelector("esp-app")
            ?.shadowRoot?.querySelector("solar-storage-dashboard")
            ?.shadowRoot?.querySelector(".unrecognized")?.textContent ?? false,
        { timeout: 10000 }
      )
      .then((h) => h.jsonValue())
      .catch(() => null);

    if (!notice) fail("unrecognized event format was not reported in the UI");
    else console.log("notice:", notice.replace(/\s+/g, " ").trim());
    if (!warnings.some((w) => w.includes("no storage entities recognized")))
      fail(`unrecognized event format was not warned about: ${JSON.stringify(warnings)}`);
  } finally {
    brokenServer.close();
  }

  // (5) Row layout: the name column may only be ellipsized when the row really
  // is too narrow, not because a two-character state reserved half of it.
  const layout = await page.evaluate(
    ([readonlyName, sliderName]) => {
      const table = document
        .querySelector("esp-app")
        .shadowRoot.querySelector("esp-entity-table");
      const measure = (wanted) => {
        const row = Array.from(
          table.shadowRoot.querySelectorAll(".entity-row")
        ).find((r) => r.children[1]?.textContent.trim() === wanted);
        if (!row) return null;
        const [, name, value] = row.children;
        return {
          nameWidth: name.clientWidth,
          nameNeeded: name.scrollWidth,
          valueWidth: value.clientWidth,
        };
      };
      return { readonly: measure(readonlyName), slider: measure(sliderName) };
    },
    [LONG_READONLY_NAME, LONG_SLIDER_NAME]
  );
  console.log("layout:", JSON.stringify(layout));

  if (!layout.readonly || !layout.slider) {
    fail(`layout probe rows did not render: ${JSON.stringify(layout)}`);
  } else {
    // A short state must not push the name into an ellipsis.
    if (layout.readonly.nameNeeded > layout.readonly.nameWidth + 1)
      fail(
        `read-only row truncates its name with ${
          layout.readonly.valueWidth
        }px of value column next to it: ${JSON.stringify(layout.readonly)}`
      );
    // ...but a control still has to be wide enough to be usable.
    if (layout.slider.valueWidth < 150)
      fail(
        `slider row control column shrank to ${layout.slider.valueWidth}px: ${JSON.stringify(layout.slider)}`
      );
    if (layout.slider.nameWidth < layout.readonly.nameWidth / 2)
      fail(
        `slider row name column starved at ${layout.slider.nameWidth}px: ${JSON.stringify(layout.slider)}`
      );
  }
} finally {
  await browser.close();
  server.close();
}

if (process.exitCode) console.error("\nE2E RESULT: FAIL ✗");
else console.log("\nE2E RESULT: PASS ✓");
