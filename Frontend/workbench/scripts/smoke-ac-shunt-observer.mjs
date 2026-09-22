// Real frontend with simulated, read-only backend transports; no instruments.
// Run with node scripts/smoke-ac-shunt-observer.mjs (Playwright Chromium).
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 4317 } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => { errors.push(error.message); console.error("PAGE ERROR", error.message); });
  page.on("requestfailed", request => console.error("REQUEST FAILED", request.url(), request.failure()));
  let sampleCount = 7;
  let runningPointId = 1;
  let readingConnections = 0;
  let liveSocket;
  const commands = [];
  const session = { id: 89, session_name: "Observer recovery smoke", standard_reader_model: "3458A", test_reader_model: "3458A" };
  const point = { id: 1, current: 1, frequency: 1000, direction: "Forward", settings: { num_samples: 35, n_cycles: 3 }, readings: {}, results: {} };
  // Formula rendering is outside this transport/navigation check; avoid a
  // third-party CDN dependency while exercising the real calibration charts.
  await page.route("https://cdnjs.cloudflare.com/**", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data = {};
    if (path.endsWith("/test_points/")) data = { test_points: [point, { ...point, id: 2, direction: "Reverse" }] };
    else if (path.endsWith("/information/")) data = { configurations: { n_cycles: 3 } };
    else if (path.endsWith("/calibration_sessions/89/")) data = session;
    else if (path.endsWith("/calibration_sessions/")) data = [session];
    else if (path.endsWith("/shunts/") || path.endsWith("/tvcs/")) data = [];
    else if (path.endsWith("/system_info/")) data = { database_type: "sqlite3" };
    await route.fulfill({ json: data });
  });
  await page.routeWebSocket(/\/ws\//, socket => {
    if (socket.url().includes("host-sync")) {
      socket.onMessage(() => socket.send(JSON.stringify({ type: "session_changed", session_id: 89, active_sessions: { host: 89 } })));
    } else if (socket.url().includes("collect-readings")) {
      assert.match(socket.url(), /89\/\?role=remote$/);
      readingConnections++;
      liveSocket = socket;
      socket.onMessage(raw => {
        const command = JSON.parse(raw).command;
        commands.push(command);
        assert.equal(command, "request_live_sync");
        socket.send(JSON.stringify({ type: "live_state_sync", isCollecting: true,
          activeCollectionDetails: { tpId: runningPointId, stage: "ac_open", cycle_index: 2 },
          focusedTPKey: "1-1000", collectionProgress: { count: sampleCount },
          liveReadings: { ac_open: [{ x: sampleCount, t: Date.now(), y: 1.000001, cycle: 2 }] },
          tiLiveReadings: { ac_open: [{ x: sampleCount, t: Date.now(), y: 1.000002, cycle: 2 }] },
        }));
      });
    }
  });
  // Seed only on the first document, so reload must use app-owned persistence.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("observer-smoke-seeded")) {
      sessionStorage.setItem("ac-shunt:observed-session:v1:http://localhost:8000/api", "89");
      sessionStorage.setItem("observer-smoke-seeded", "1");
    }
  });
  await page.goto("http://127.0.0.1:4317/#/ac-shunt");
  const readings = page.getByRole("button", { name: "Readings", exact: true });
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await readings.waitFor().catch(async error => {
    console.error("OBSERVER PAGE", await page.locator("body").innerText());
    throw error;
  });
  assert.match(await readings.getAttribute("class"), /active/);
  await page.getByText("7 / 35 Samples", { exact: true }).waitFor();

  // An explicit preference survives a full document reload, in either direction.
  await settings.click();
  await page.reload();
  await settings.waitFor();
  assert.match(await settings.getAttribute("class"), /active/);
  await readings.click();
  sampleCount = 19;
  await page.reload();
  await readings.waitFor();
  assert.match(await readings.getAttribute("class"), /active/);
  await page.getByText("19 / 35 Samples", { exact: true }).waitFor();

  // Resume a still-mounted page with an OPEN but stale transport.
  const previousConnections = readingConnections;
  sampleCount = 28;
  runningPointId = 2;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByText("28 / 35 Samples", { exact: true }).waitFor();
  await page.getByTitle("Current Direction: Reverse", { exact: true }).waitFor();
  liveSocket.send(JSON.stringify({ type: "dual_reading_update", stage: "ac_open", cycle_index: 2, count: 29, total: 35,
    std_reading: { value: 1.000003, timestamp: Date.now() / 1000, is_stable: true },
    ti_reading: { value: 1.000004, timestamp: Date.now() / 1000, is_stable: true },
  }));
  await page.getByText("29 / 35 Samples", { exact: true }).waitFor();
  assert.ok(readingConnections > previousConnections);
  assert.match(await readings.getAttribute("class"), /active/);
  assert.equal(await page.getByRole("tab", { name: "Calibration", exact: true }).getAttribute("aria-selected"), "true");
  assert.ok(commands.length >= 3);
  assert.deepEqual(errors, []);
  console.log("PASS: observer Settings/Readings survive reload; wake hydrates fresh live data without hardware commands.");
} finally {
  await browser.close();
  await server.close();
}
