import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.skip(
  process.env.ATTENDX_LIVE_TESTS !== "1",
  "Live checks require the complete Docker stack; set ATTENDX_LIVE_TESTS=1.",
);
test.setTimeout(60_000);
test.use({ actionTimeout: 12_000 });
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as Page & { errors: string[] }).errors = errors;
  await page.goto("/");
  await page
    .getByRole("button", { name: "New to Attendx? Create a workspace" })
    .click();
  await page.getByLabel("Your name").fill("Alex");
  await page
    .getByLabel("Email address")
    .fill(
      `browser-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`,
    );
  await page
    .getByLabel("Password", { exact: true })
    .fill("integration-password-1234");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your office, alive." }),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { errors: string[] }).errors).toEqual([]);
});

async function createProject(page: Page, name = "Invoice delivery") {
  await page
    .getByRole("button", { name: "Assign project", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Start a real project" });
  await form.getByLabel("Project name", { exact: true }).fill(name);
  await form
    .getByLabel("What should the team deliver?")
    .fill(
      "Build an invoice total calculator with executable tests and a static preview.",
    );
  await form
    .getByLabel("Acceptance criteria")
    .fill("Totals are correct.\nEmpty invoice totals zero.");
  await form
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const workspace = page.getByRole("dialog", { name, exact: true });
  await expect(workspace).toBeVisible();
  return workspace;
}
async function configureFixture(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add an AI connection" });
  await dialog
    .getByLabel("Quick setup")
    .selectOption({ label: "Local Ollama" });
  await dialog.getByLabel("Connection name").fill("Integration fixture");
  await dialog.getByLabel("API base URL").fill("http://ollama:11434/v1");
  await dialog.getByLabel("Model ID").fill("fixture-model");
  await dialog.getByRole("button", { name: "Save connection" }).click();
  await expect(
    page.getByRole("heading", { name: "Integration fixture", exact: true }),
  ).toBeVisible();
}

test("projects persist and unconfigured models block honestly without charging", async ({
  page,
}) => {
  const workspace = await createProject(page, "Persisted project");
  await workspace
    .getByRole("button", { name: "Generate plan", exact: true })
    .click();
  await expect(
    workspace.getByText(/No AI provider is configured/),
  ).toBeVisible();
  let state = await (await page.request.get("/api/state")).json();
  expect(
    state.projects.find((p: { name: string }) => p.name === "Persisted project")
      .spentCents,
  ).toBe(0);
  expect(state.artifacts).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(
    page.locator(".lx-project-card").filter({ hasText: "Persisted project" }),
  ).toBeVisible();
  state = await (await page.request.get("/api/state")).json();
  expect(
    state.tasks.some((j: { status: string }) => j.status === "blocked"),
  ).toBe(true);
});

test("multiple provider keys are masked, editable and excluded from browser storage and API state", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const [label, key] of [
    ["Primary model", "sk-browser-primary-secret-1234"],
    ["Backup model", "sk-browser-backup-secret-5678"],
  ]) {
    await page
      .getByRole("button", { name: "Add provider", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add an AI connection" });
    await dialog.getByLabel("Connection name").fill(label);
    await dialog.getByLabel("API key", { exact: false }).fill(key);
    await dialog.getByRole("button", { name: "Save connection" }).click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
  }
  const providers = await (await page.request.get("/api/providers")).json();
  expect(providers.providers).toHaveLength(2);
  expect(JSON.stringify(providers)).not.toContain("sk-browser");
  expect(
    JSON.stringify(
      await page.evaluate(() => ({ ...localStorage, ...sessionStorage })),
    ),
  ).not.toContain("sk-browser");
  await page
    .locator(".lx-provider-card")
    .filter({ hasText: "Primary model" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit AI connection" });
  await expect(editor.getByLabel("API key", { exact: false })).toHaveValue("");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".lx-provider-card")).toHaveCount(2);
});

test("model HTTP plan, approval, actual Docker tests, source ZIP, preview and chat form a complete journey", async ({
  page,
}, testInfo) => {
  await configureFixture(page);
  const workspace = await createProject(page);
  await workspace
    .getByRole("button", { name: "Generate plan", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Approve plan", exact: true }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Approve plan", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Run approved plan" }),
  ).toBeEnabled();
  await workspace.getByRole("button", { name: "Run approved plan" }).click();
  await expect(
    workspace.getByText(/2 executable tests passed in the isolated runner/),
  ).toBeVisible({ timeout: 30_000 });
  await workspace.getByRole("tab", { name: /Evidence/ }).click();
  await workspace
    .getByRole("button", { name: /Actual execution report.json/ })
    .click();
  const report = page.getByRole("dialog", {
    name: "Actual execution report.json",
    exact: true,
  });
  await expect(report.locator("pre")).toContainText('"testCount": 2');
  await page.keyboard.press("Escape");
  await expect(report).toHaveCount(0);
  await expect(workspace).toBeVisible();
  await workspace
    .getByRole("button", { name: /Reviewable candidate files.json/ })
    .click();
  const candidate = page.getByRole("dialog", {
    name: "Reviewable candidate files.json",
    exact: true,
  });
  const downloading = page.waitForEvent("download");
  await candidate.getByRole("link", { name: "Source ZIP" }).click();
  const download = await downloading;
  const path = testInfo.outputPath("source.zip");
  await download.saveAs(path);
  expect((await readFile(path)).subarray(0, 4).toString("hex")).toBe(
    "504b0304",
  );
  await page.keyboard.press("Escape");
  await workspace
    .getByRole("button", { name: /Sandboxed HTML preview/ })
    .click();
  const preview = page.getByRole("dialog", {
    name: "Sandboxed HTML preview",
    exact: true,
  });
  await preview.getByRole("button", { name: "Static HTML preview" }).click();
  await expect(
    preview
      .frameLocator("iframe")
      .getByRole("heading", { name: "Invoice preview" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await workspace.getByRole("tab", { name: "Overview", exact: true }).click();
  await workspace
    .getByRole("button", { name: "Approve release", exact: true })
    .click();
  await workspace.getByRole("tab", { name: "Chat", exact: true }).click();
  await workspace
    .getByLabel("Chat agent")
    .selectOption({ label: "Theo · Software engineer" });
  await workspace
    .getByLabel("Message to agent")
    .fill("What evidence did you produce?");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  await expect(workspace.getByRole("log")).toContainText(
    "EVIDENCE: This is the deterministic integration-test model.",
  );
  const state = await (await page.request.get("/api/state")).json();
  expect(
    state.projects.find((p: { name: string }) => p.name === "Invoice delivery")
      .status,
  ).toBe("reviewed");
  expect(
    state.artifacts.some((a: { kind: string }) => a.kind === "test-report"),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Office", exact: true })
    .first()
    .click();
  await page.screenshot({
    path: testInfo.outputPath("live-office.png"),
    fullPage: true,
  });
});

test("bounded specialists, approved memory and verification schedules persist", async ({
  page,
}) => {
  const workspace = await createProject(page, "Memory project");
  await workspace.getByRole("tab", { name: "Memory", exact: true }).click();
  await workspace
    .getByLabel("Approved knowledge")
    .fill("Invoice totals use integer cents.");
  await workspace.getByRole("button", { name: "Approve and remember" }).click();
  await expect(workspace.locator(".lx-record")).toContainText(
    "Invoice totals use integer cents.",
  );
  await workspace.getByRole("tab", { name: "Monitoring", exact: true }).click();
  await workspace.getByRole("button", { name: "Add schedule" }).click();
  await expect(workspace.getByText("Every 60 minutes")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "Hire agent" }).click();
  const hiring = page.getByRole("dialog", { name: "Hire a scoped specialist" });
  await hiring.getByLabel("Human-like name").fill("Ada");
  await hiring.getByLabel(/^Project/).selectOption({ label: "Memory project" });
  await hiring
    .getByLabel("Why is this agent needed?")
    .fill("An additional specialist is needed for this project.");
  await hiring.getByRole("button", { name: "Hire specialist" }).click();
  await expect(
    page.locator(".lx-agent-card").filter({ hasText: "Ada" }),
  ).toBeVisible();
  await page.reload();
  const state = await (await page.request.get("/api/state")).json();
  expect(state.agents).toHaveLength(8);
  expect(
    state.memories.some(
      (m: { content: string }) =>
        m.content === "Invoice totals use integer cents.",
    ),
  ).toBe(true);
  expect(state.schedules).toHaveLength(1);
});

test("mobile navigation, keyboard dialog focus and reduced motion remain usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator(".lx-sidebar")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add an AI connection" });
  await expect(dialog.getByLabel("Connection name")).toBeFocused();
  await dialog.getByRole("button", { name: "Save connection" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  expect(
    await dialog.evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("live-mobile.png"),
    fullPage: true,
  });
});

test("evaluated project instruction versions require approval and can be rolled back", async ({
  page,
}) => {
  await configureFixture(page);
  let workspace = await createProject(page, "Evaluation project");
  for (const version of [1, 2]) {
    if (version === 2) {
      await page
        .locator(".lx-sidebar-projects")
        .getByRole("button", { name: "Evaluation project", exact: true })
        .click();
      workspace = page.getByRole("dialog", {
        name: "Evaluation project",
        exact: true,
      });
    }
    await workspace.getByRole("tab", { name: "Improve", exact: true }).click();
    await workspace
      .getByRole("combobox", { name: "Agent", exact: true })
      .selectOption({ label: "Theo · Software engineer" });
    await workspace
      .getByLabel("Candidate instructions")
      .fill(
        `Version ${version}: ground answers in project evidence and explain permission boundaries.`,
      );
    for (const index of [0, 1]) {
      await workspace
        .getByLabel("Input", { exact: true })
        .nth(index)
        .fill(`Explain project evidence case ${index}.`);
      await workspace
        .getByLabel("Expected response includes", { exact: true })
        .nth(index)
        .fill("EVIDENCE");
    }
    await workspace.getByRole("button", { name: "Evaluate candidate" }).click();
    await expect(
      workspace
        .locator(".lx-version")
        .filter({ hasText: `Version ${version}` }),
    ).toContainText("candidate");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Reviews/ }).click();
    await page
      .getByRole("button", { name: "Approve improvement", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Approve improvement", exact: true }),
    ).toHaveCount(0);
  }
  await page
    .locator(".lx-sidebar-projects")
    .getByRole("button", { name: "Evaluation project", exact: true })
    .click();
  workspace = page.getByRole("dialog", {
    name: "Evaluation project",
    exact: true,
  });
  await workspace.getByRole("tab", { name: "Improve", exact: true }).click();
  await workspace
    .getByRole("combobox", { name: "Agent", exact: true })
    .selectOption({ label: "Theo · Software engineer" });
  const previous = workspace
    .locator(".lx-version")
    .filter({ hasText: "Version 1" });
  await previous
    .getByRole("button", { name: "Restore approved version" })
    .click();
  await expect(previous).toContainText("active");
  const state = await (await page.request.get("/api/state")).json();
  expect(
    state.skills.filter((s: { status: string }) => s.status === "active"),
  ).toHaveLength(1);
  expect(
    state.skills.find((s: { status: string }) => s.status === "active").version,
  ).toBe(1);
});

test("a delayed private snapshot cannot restore a workspace after sign-out", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  let release!: () => void, captured!: () => void;
  const paused = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (captured = resolve));
  await page.route(
    "**/api/state",
    async (route) => {
      const response = await route.fetch();
      captured();
      await paused;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await ready;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  const returning = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/state") && response.status() === 200,
  );
  release();
  await (await returning).finished();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.locator(".lx-app")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
