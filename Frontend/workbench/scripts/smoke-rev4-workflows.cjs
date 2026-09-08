// Real application walkthrough in an isolated Electron profile and in-memory API.
// Run with node_modules/electron/dist/electron.exe from Frontend/workbench.
// Requires playwright (same optional installation as smoke-forge-srcdoc.mjs).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
app.disableHardwareAcceleration();
// Keep cleanup from quitting Electron before the failure exit code is reported.
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("remote-debugging-port", "9234");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "rev4-walkthrough-"));
app.setPath("userData", path.join(output, "profile"));
const source = `
import '/src/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import axios from 'axios';
import UncertaintyApp from '/src/modules/uncertainty/UncertaintyApp.jsx';
import { ThemeProvider } from '/src/shared/ThemeContext.jsx';
import { NotificationProvider } from '/src/shared/NotificationContext.jsx';
const instrument = (id, name, unit, min, max) => ({id, scope:'local',manufacturer:'Bench',model:id,name,description:name,functions:[{id:id+'fn',name,unit,ranges:[{id:id+'range',min,max,unit,tolerances:{floor:{high:0.01,low:-0.01,unit,symmetric:true,distribution:'1.732'}},measuringResolution:'0.001',measuringResolutionUnit:unit}]}]});
const library = [instrument('V1','Voltage','V',0,10),instrument('A1','Current','A',0,10),instrument('W1','Power','W',0,20),instrument('V2','Voltage reference','V',10,20)];
let session = { id:901,name:'Rev 4 walkthrough',measurementAreaGroups:[],measurementAreas:[],uuts:[],tmdes:[],testPoints:[],uncReq:{uncertaintyConfidence:95,reliability:95,measRelCalcAssumed:95,reqPFA:2,neededTUR:4,calInt:12}};
window.savedSession=()=>session;
axios.get=async url=>({data: String(url).includes('/sessions/') ? [session] : String(url).includes('/instruments/') ? library : []});
axios.put=async (url,data)=>{if(String(url).includes('/sessions/'))session=structuredClone(data);return {data};};
axios.post=async (_url,data)=>({data});axios.patch=async (_url,data)=>({data});axios.delete=async()=>({data:{}});
createRoot(document.getElementById('root')).render(<ThemeProvider><NotificationProvider><MemoryRouter><UncertaintyApp/></MemoryRouter></NotificationProvider></ThemeProvider>);
`;
let server, win, browser, page;
app.whenReady().then(async () => {
  const timer = setTimeout(() => app.exit(1), 300000);
  let status = 0;
  try {
    const { createServer } = await import("vite");
    const virtual = path.resolve("__rev4-smoke.jsx").replaceAll("\\", "/");
    server = await createServer({
      cacheDir: path.join(output, "vite"),
      server: { host: "127.0.0.1", port: 4196, strictPort: false, open: false },
      plugins: [
        {
          name: "rev4-smoke",
          resolveId: (id) => (id === "/__rev4-smoke.jsx" ? virtual : undefined),
          load: (id) => (id === virtual ? source : undefined),
          configureServer(vite) {
            vite.middlewares.use(async (req, res, next) => {
              if (req.url !== "/__rev4-smoke") return next();
              res.setHeader("Content-Type", "text/html");
              res.end(
                await vite.transformIndexHtml(
                  req.url,
                  '<html><body><div id="root"></div><script type="module" src="/__rev4-smoke.jsx"></script></body></html>',
                ),
              );
            });
          },
        },
      ],
    });
    await server.listen();
    win = new BrowserWindow({
      show: false,
      width: 1500,
      height: 1000,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    await win.loadURL(
      "http://127.0.0.1:" + server.httpServer.address().port + "/__rev4-smoke",
    );
    const { chromium } = require("playwright");
    browser = await chromium.connectOverCDP("http://127.0.0.1:9234");
    page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) =>
      console.error("PAGE ERROR:", error.message),
    );
    await page.getByRole("combobox", { name: "Analysis Session" }).waitFor();
    const capture = async (name) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, name + ".png") });
      console.log("Screenshot:", name);
    };
    await page.locator('[data-tour="uut-add-function"]').click();
    await page
      .getByPlaceholder("New measurement area")
      .fill("Electrical bench");
    await page.getByPlaceholder("New measurement area").press("Enter");
    await page.locator('[data-tour="uut-add-instrument"]').click();
    await page.locator('[data-tour="uut-table"] .inline-desc-combined').click();
    await page.getByPlaceholder("Name", { exact: true }).fill("Voltage");
    await page.getByRole("option", { name: /Bench V1 Voltage/ }).click();
    await page.locator('[data-tour="tmde-add-function"]').click();
    await page
      .locator('[data-tour="tmde-function-menu"]')
      .getByRole("button", { name: "Electrical bench", exact: true })
      .click();
    await page.locator('[data-tour="tmde-add-instrument"]').click();
    await page
      .locator('[data-tour="tmde-table"] .inline-desc-combined')
      .click();
    await page.getByPlaceholder("Name", { exact: true }).fill("Voltage");
    await capture("instrument-menu");
    await page
      .getByRole("option", { name: /Bench V2 Voltage reference/ })
      .click();
    await page
      .getByRole("button", { name: "Add direct point", exact: true })
      .click();
    await page.locator(".sidebar-inline-input.value").fill("5");
    await page.locator(".sidebar-inline-input.value").press("Enter");
    await page.getByRole("button", { name: "UUT", exact: true }).click();
    await capture("assign-uut-menu");
    await page.getByRole("option", { name: /Bench V1 Voltage/ }).click();
    await page.locator(".point-grid-item").first().click();
    await page.locator('[data-tour="tab-budget"]').click();
    await page
      .getByRole("button", { name: "Add component to budget", exact: true })
      .first()
      .click();
    await page
      .locator('[data-tour="budget-component-menu"]')
      .getByRole("button", { name: /10 to 20 V/ })
      .click();
    const rangeWarning = page.locator(".point-diagnostic-warning");
    await rangeWarning.waitFor();
    assert.match(
      await rangeWarning.getAttribute("title"),
      /Measurement Point 5 V does not fall within error source range: 10 to 20 V/,
    );
    assert.match(
      await page.locator(".budget-range-warning").getAttribute("title"),
      /Measurement Point 5 V/,
    );
    await page.mouse.click(1480, 190); // Dismiss the multi-add picker.
    await capture("direct-range-warning");
    await page
      .getByRole("button", { name: "Filter visible columns", exact: true })
      .click();
    const filterBox = await page
      .getByRole("dialog", { name: "Visible measurement point columns" })
      .boundingBox();
    assert.ok(
      filterBox.x >= 0 &&
        filterBox.y >= 0 &&
        filterBox.y + filterBox.height <= 1000,
      "Column filter fits the viewport",
    );
    await capture("column-filter");
    await page
      .getByRole("button", { name: "Close column filter", exact: true })
      .click();
    await page.locator('[data-tour="tab-overview"]').click();
    await page.locator('[data-tour="uut-add-instrument"]').click();
    await page
      .locator('[data-tour="uut-table"] .inline-desc-combined')
      .last()
      .click();
    await page.getByPlaceholder("Name", { exact: true }).fill("Power");
    await page.getByRole("option", { name: /Bench W1 Power/ }).click();
    for (const [name, identity] of [
      ["Voltage", "Bench V1 Voltage"],
      ["Current", "Bench A1 Current"],
    ]) {
      await page.locator('[data-tour="tmde-add-instrument"]').click();
      await page
        .locator('[data-tour="tmde-table"] .inline-desc-combined')
        .last()
        .click();
      await page.getByPlaceholder("Name", { exact: true }).fill(name);
      await page.getByRole("option", { name: new RegExp(identity) }).click();
    }
    await page
      .locator(".area-header-sticky")
      .first()
      .hover({ position: { x: 30, y: 15 } });
    await page.locator('[data-tour="function-settings"]').click();
    await page.getByRole("radio", { name: "Derived", exact: true }).click();
    await page.locator('[data-tour="add-measurement-point"]').click();
    const unitMenu = page.locator('[data-tour="measurement-point-menu"]');
    if (await unitMenu.count())
      await unitMenu.getByRole("menuitem", { name: "W", exact: true }).click();
    await page.locator(".sidebar-inline-input.value").fill("10");
    await page.locator(".sidebar-inline-input.value").press("Enter");
    await page.getByRole("button", { name: "UUT", exact: true }).last().click();
    await page.getByRole("option", { name: /Bench W1 Power/ }).click();
    await page.locator(".point-grid-item").last().click();
    await page.locator('[data-tour="tab-budget"]').click();
    await page
      .getByRole("button", { name: "Edit measurement equation", exact: true })
      .click();
    await page.locator(".measurement-equation-input").fill("x * y");
    await page.locator(".measurement-equation-input").press("Enter");
    for (const [symbol, name, value] of [
      ["x", "Voltage", "5"],
      ["y", "Current", "2"],
    ]) {
      await page
        .getByRole("button", {
          name: "Edit name for equation variable " + symbol,
          exact: true,
        })
        .click();
      await page
        .getByRole("textbox", {
          name: "Display name for equation variable " + symbol,
          exact: true,
        })
        .fill(name);
      await page
        .getByRole("textbox", {
          name: "Display name for equation variable " + symbol,
          exact: true,
        })
        .press("Enter");
      await page
        .getByRole("button", {
          name: "Edit nominal for equation variable " + symbol,
          exact: true,
        })
        .click();
      await page
        .getByRole("spinbutton", {
          name: "Nominal value for equation variable " + symbol,
          exact: true,
        })
        .fill(value);
      await page
        .getByRole("button", {
          name: "Nominal unit for equation variable " + symbol + " base unit",
          exact: true,
        })
        .click();
      await page
        .getByPlaceholder("Search units...")
        .fill(symbol === "x" ? "Voltage" : "Current");
      await page
        .getByRole("option", {
          name: symbol === "x" ? "V Voltage" : "A Current",
          exact: true,
        })
        .click();
      await page
        .getByRole("spinbutton", {
          name: "Nominal value for equation variable " + symbol,
          exact: true,
        })
        .press("Enter");
    }
    await page.locator(".measurement-equation-status").waitFor();
    assert.match(
      await page.locator(".measurement-equation-status").innerText(),
      /10[.]0+/,
    );
    for (const [name, range] of [
      ["Voltage", /0 to 10 V/],
      ["Current", /0 to 10 A/],
    ]) {
      await page
        .locator(".budget-section-row")
        .filter({ hasText: new RegExp(name + " uncertainty budget", "i") })
        .getByRole("button", { name: "Add component to budget", exact: true })
        .click();
      await page
        .locator('[data-tour="budget-component-menu"]')
        .getByRole("button", { name: range })
        .click();
      await page.keyboard.press("Escape");
    }
    const derivedRow = page.locator(".point-grid-item").last();
    assert.equal(
      await derivedRow.locator(".point-diagnostic-warning").count(),
      0,
      "Complete derived point has no warnings",
    );
    await capture("derived-complete");
    const toggleMitigations = async (enabled) => {
      await page
        .getByRole("button", { name: "Filter visible columns", exact: true })
        .click();
      for (const group of ["GB + Int", "Int Only"])
        await page
          .getByRole("checkbox", {
            name: `Toggle all Mitigation (${group}) columns`,
            exact: true,
          })
          .setChecked(enabled);
      await page
        .getByRole("button", { name: "Close column filter", exact: true })
        .click();
    };
    await toggleMitigations(true);
    let mitigationTitle = await derivedRow
      .locator(".point-diagnostic-warning")
      .getAttribute("title");
    assert.match(mitigationTitle, /GB \+ Int/);
    assert.match(mitigationTitle, /Int Only/);
    assert.match(
      mitigationTitle,
      /No feasible guard-band and interval solution/,
    );
    await capture("mitigation-no-solution-warning");
    const changeInterval = async (value) => {
      await page
        .locator(".session-header-field")
        .filter({ hasText: "Cal Int for assumed REOP" })
        .locator(".session-header-value")
        .click();
      const input = page.getByRole("spinbutton", {
        name: "Cal Int for assumed REOP",
        exact: true,
      });
      await input.fill(value);
      await input.press("Enter");
    };
    await changeInterval("");
    mitigationTitle = await derivedRow
      .locator(".point-diagnostic-warning")
      .getAttribute("title");
    assert.match(mitigationTitle, /Enter Cal Int.*positive number of months/);
    await capture("mitigation-missing-interval-warning");
    await changeInterval("12");
    await toggleMitigations(false);
    assert.equal(
      await derivedRow.locator(".point-diagnostic-warning").count(),
      0,
    );
    await derivedRow.locator(".point-value").click();
    await page.locator(".sidebar-inline-input.value").fill("12");
    await page.locator(".sidebar-inline-input.value").press("Enter");
    assert.match(
      await derivedRow
        .locator(".point-diagnostic-warning")
        .getAttribute("title"),
      /Equation result 10 W does not equal Measurement Point 12 W/,
    );
    await capture("derived-mismatch");
    await page
      .getByRole("button", { name: "Open walkthrough", exact: true })
      .click();
    const workflow = page.getByRole("combobox", {
      name: "Walkthrough workflow",
    });
    for (const topic of await workflow.locator("option").allTextContents())
      await workflow.selectOption({ label: topic });
    await workflow.selectOption({ label: "Derived measurement" });
    const step = page.getByRole("combobox", { name: "Walkthrough step" });
    const chooseStep = async (topic, title) => {
      await workflow.selectOption({ label: topic });
      await step.selectOption(
        await step
          .locator("option")
          .filter({ hasText: title })
          .getAttribute("value"),
      );
    };
    const assertTutorialAboveMenu = async (selector, name) => {
      await page.locator(selector).first().waitFor({ state: "visible" });
      await page.waitForTimeout(350);
      const result = await page.evaluate((selector) => {
        const card = document.querySelector(".guided-walkthrough-card");
        const menu = document.querySelector(selector);
        const hit = (element) => {
          const r = element.getBoundingClientRect();
          const actual = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return element.contains(actual);
        };
        const m = menu.getBoundingClientRect(),
          h = document
            .querySelector(".guided-walkthrough-highlight")
            .getBoundingClientRect();
        return {
          header: hit(card.querySelector(".guided-walkthrough-card-header")),
          close: hit(card.querySelector('[aria-label="Close walkthrough"]')),
          navigation: hit(
            card.querySelector('[aria-label="Walkthrough workflow"]'),
          ),
          menuInsideSpotlight:
            m.left >= h.left &&
            m.right <= h.right &&
            m.top >= h.top &&
            m.bottom <= h.bottom,
          elevated: document.querySelectorAll(
            ".guided-walkthrough-elevated-surface",
          ).length,
        };
      }, selector);
      assert.deepEqual(
        result,
        {
          header: true,
          close: true,
          navigation: true,
          menuInsideSpotlight: true,
          elevated: 0,
        },
        name,
      );
      await capture(name);
    };
    for (const [topic, title, trigger, menu, name] of [
      [
        "Instruments & Measurement Areas",
        "Create a Measurement Area",
        '[data-tour="uut-add-function"]',
        '[data-tour="uut-function-menu"]',
        "tutorial-uut-menu",
      ],
      [
        "Instruments & Measurement Areas",
        "Add measuring equipment",
        '[data-tour="tmde-add-function"]',
        '[data-tour="tmde-function-menu"]',
        "tutorial-tmde-menu",
      ],
      [
        "Direct measurement",
        "Choose the direct workflow",
        '[data-tour="function-settings"]',
        '[data-tour="function-settings-menu"]',
        "tutorial-direct-settings",
      ],
      [
        "Derived measurement",
        "Choose the derived workflow",
        '[data-tour="function-settings"]',
        '[data-tour="function-settings-menu"]',
        "tutorial-derived-settings",
      ],
      [
        "Derived measurement",
        "Create the derived target",
        '[data-tour="add-measurement-point"]',
        '[data-tour="measurement-point-menu"]',
        "tutorial-point-menu",
      ],
      [
        "Derived measurement",
        "Build each input budget",
        '[data-tour="budget-add-component"]',
        '[data-tour="budget-component-menu"]',
        "tutorial-budget-menu",
      ],
      [
        "Budget controls & results",
        "Compare risk and mitigation",
        '[data-tour="sidebar-columns"]',
        ".sidebar-filter-dropdown",
        "tutorial-column-menu",
      ],
    ]) {
      await chooseStep(topic, title);
      if (trigger.includes("function-settings"))
        await page
          .locator(".area-header-sticky")
          .first()
          .hover({ position: { x: 30, y: 15 } });
      await page.locator(trigger).first().click();
      await assertTutorialAboveMenu(menu, name);
      if (menu === ".sidebar-filter-dropdown")
        await page
          .getByRole("button", { name: "Close column filter", exact: true })
          .click();
      else {
        await page.keyboard.press("Escape");
        await page.mouse.click(1480, 15);
      }
    }
    await chooseStep("Derived measurement", "Enter the measurement equation");
    await step.selectOption(
      await step
        .locator("option")
        .filter({ hasText: "Enter the measurement equation" })
        .getAttribute("value"),
    );
    await capture("tutorial-derived");
    await page
      .getByRole("button", { name: "Close walkthrough", exact: true })
      .click();
    await page.evaluate(() => {
      document.body.classList.remove("light-mode");
      document.body.classList.add("dark-mode");
    });
    await page
      .getByRole("button", { name: "Filter visible columns", exact: true })
      .click();
    await capture("dark-filter");
    await page
      .getByRole("button", { name: "Close column filter", exact: true })
      .click();
    win.setSize(1000, 700);
    await page
      .getByRole("button", { name: "Open walkthrough", exact: true })
      .click();
    await workflow.selectOption({ label: "Derived measurement" });
    await step.selectOption(
      await step
        .locator("option")
        .filter({ hasText: "Enter the measurement equation" })
        .getAttribute("value"),
    );
    await page.waitForTimeout(250);
    const card = await page
      .getByRole("dialog", { name: "Uncertalytics walkthrough" })
      .boundingBox();
    assert.ok(
      card.x >= 0 &&
        card.y >= 0 &&
        card.x + card.width <= 1000 &&
        card.y + card.height <= 700,
      "Tutorial stays within the smaller viewport",
    );
    await capture("tutorial-small-dark");
    await chooseStep("Direct measurement", "Choose the direct workflow");
    await page
      .locator(".area-header-sticky")
      .first()
      .hover({ position: { x: 30, y: 15 } });
    await page.locator('[data-tour="function-settings"]').first().click();
    await assertTutorialAboveMenu(
      '[data-tour="function-settings-menu"]',
      "tutorial-small-dark-settings",
    );
    // The actual menu controls remain usable through the spotlight.
    const reuse = page
      .locator('[data-tour="function-settings-menu"]')
      .getByRole("checkbox", {
        name: /Reuse the first point's budget/,
      });
    await reuse.setChecked(!(await reuse.isChecked()));
    await page
      .getByRole("button", { name: "Close walkthrough", exact: true })
      .click();
    assert.equal(await page.locator(".guided-walkthrough-layer").count(), 0);
    console.log(
      "PASS: direct and derived creation, instrument selection, both input budgets, range/mismatch warnings, menus, all tutorial workflows, dark theme and small viewport.",
    );
    console.log("ARTIFACTS", output);
  } catch (error) {
    status = 1;
    console.error(error.stack);
    if (page) {
      console.error((await page.locator("body").innerText()).slice(-9000));
      await page.screenshot({ path: path.join(output, "failure.png") });
    }
    console.error("ARTIFACTS", output);
  } finally {
    clearTimeout(timer);
    if (browser) await browser.close();
    if (win && !win.isDestroyed()) win.destroy();
    if (server) await server.close();
    app.exit(status);
  }
});
