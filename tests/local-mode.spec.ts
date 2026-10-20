import { test, expect, type Page } from "@playwright/test";

test.setTimeout(60_000);
test.use({ actionTimeout: 12_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New to Attendx? Create a workspace" }).click();
  await page.getByLabel("Your name").fill("Local owner");
  await page.getByLabel("Email address").fill(`local-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`);
  await page.getByLabel("Password", { exact: true }).fill("local-integration-password-1234");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your office, alive." })).toBeVisible();
});

async function connect(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add local connection", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Add an AI connection" });
  await expect(form.getByLabel("Quick setup").locator("option")).toHaveText(["Local Ollama"]);
  await form.getByLabel("Connection name").fill("Local integration fixture");
  await form.getByLabel("API base URL").fill("http://ollama:11434/v1");
  await form.getByLabel("Model ID").fill("fixture-model");
  await form.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText("Local connection configured", { exact: true })).toBeVisible();
}

async function project(page: Page, name: string) {
  await page.getByRole("button", { name: "Assign project", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Start a real project" });
  await expect(form.getByLabel("Model budget · USD")).toHaveCount(0);
  await expect(form.getByText("$0 external AI API cost", { exact: true })).toBeVisible();
  await form.getByLabel("Project name", { exact: true }).fill(name);
  await form.getByLabel("What should the team deliver?").fill("Build an invoice calculator with two executable tests and a static preview.");
  await form.getByLabel("Acceptance criteria").fill("Correct invoice totals. Empty invoice totals zero.");
  await form.getByRole("button", { name: "Create project", exact: true }).click();
  return page.getByRole("dialog", { name, exact: true });
}

test("local-only UI and server reject remote providers", async ({ page }) => {
  const state = await (await page.request.get("/api/state")).json();
  expect(state.runtimePolicy).toMatchObject({ localOnly: true, workerConcurrency: 1, localCallLimit: 4 });
  expect(state.agents).toHaveLength(7);
  await connect(page);
  const session = await (await page.request.get("/api/session")).json();
  const remote = await page.request.post("/api/providers", {
    headers: { "X-CSRF-Token": session.csrfToken, Origin: new URL(page.url()).origin },
    data: { label: "Forbidden remote", type: "openai", baseUrl: "https://api.openai.com/v1", model: "remote", apiKey: "not-a-real-key-1234", enabled: true },
  });
  expect(remote.status()).toBe(403);
  expect(await remote.text()).toMatch(/local.*only/i);
  const saved = await (await page.request.get("/api/providers")).json();
  expect(saved.providers).toHaveLength(1);
  expect(saved.providers[0].local).toBe(true);
});

test("local plan, actual execution and chat consume calls with zero API reservations", async ({ page }) => {
  await connect(page);
  const workspace = await project(page, "Local invoice delivery");
  await workspace.getByRole("button", { name: "Generate plan", exact: true }).click();
  await workspace.getByRole("button", { name: "Approve plan", exact: true }).click();
  await workspace.getByRole("button", { name: "Run approved plan" }).click();
  await expect(workspace.getByText(/2 executable tests passed in the isolated runner/)).toBeVisible({ timeout: 30_000 });
  await workspace.getByRole("tab", { name: "Chat", exact: true }).click();
  await workspace.getByLabel("Message to agent").fill("What evidence did you produce?");
  await workspace.getByRole("button", { name: "Send", exact: true }).click();
  await expect(workspace.getByRole("log")).toContainText("EVIDENCE: This is the deterministic integration-test model.");
  await expect.poll(async () => {
    const state = await (await page.request.get("/api/state")).json();
    return state.projects.find((p: { name: string }) => p.name === "Local invoice delivery");
  }).toMatchObject({ spentCents: 0, localCalls: 3 });
  const state = await (await page.request.get("/api/state")).json();
  expect(state.artifacts.some((a: { kind: string }) => a.kind === "test-report")).toBe(true);
  expect(state.metrics.reservedCents).toBe(0);
});

test("a local project stops at its durable compute quota", async ({ page }) => {
  await connect(page);
  const workspace = await project(page, "Bounded local chat");
  await workspace.getByRole("tab", { name: "Chat", exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await workspace.getByLabel("Message to agent").fill(`Summarize the current project, request ${i}.`);
    await workspace.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/state")).json();
      const p = state.projects.find((v: { name: string }) => v.name === "Bounded local chat");
      return state.tasks.filter((t: { projectId: string; status: string }) => t.projectId === p.id && ["completed", "blocked", "failed"].includes(t.status)).length;
    }).toBe(i + 1);
  }
  const state = await (await page.request.get("/api/state")).json();
  const p = state.projects.find((v: { name: string }) => v.name === "Bounded local chat");
  expect(p).toMatchObject({ spentCents: 0, localCalls: 4 });
  expect(state.tasks.some((t: { projectId: string; status: string; error?: string }) => t.projectId === p.id && t.status === "blocked" && /local.*(limit|quota)|quota.*local/i.test(t.error || ""))).toBe(true);
});

test("project knowledge is searchable and research rejects invalid inputs before enqueue", async ({ page }) => {
  const workspace = await project(page, "Knowledge and research controls");
  await workspace.getByRole("tab", { name: "Memory", exact: true }).click();
  await workspace.getByLabel("Approved knowledge").fill("Invoice totals use integer cents and UTC timestamps.");
  await workspace.getByRole("button", { name: "Approve and remember" }).click();
  await expect(workspace.locator(".lx-record")).toContainText("integer cents");
  const search = workspace.getByRole("region", { name: "Project knowledge search" });
  await search.getByLabel("Search project knowledge").fill("invoice cents");
  await search.getByRole("button", { name: "Search knowledge" }).click();
  await expect(search.locator(".lx-knowledge-result")).toHaveCount(1);
  await expect(search.locator(".lx-knowledge-result")).toContainText("integer cents");
  await workspace.getByRole("tab", { name: "Research", exact: true }).click();
  await workspace.getByLabel("Research question").fill("Find examples for invoice total testing");
  await workspace.getByLabel("Source URLs (optional)").fill("http://nodejs.org/api/test.html");
  await workspace.getByRole("button", { name: "Run research" }).click();
  await expect(workspace.getByRole("alert")).toContainText("HTTPS");
  const state = await (await page.request.get("/api/state")).json();
  const p = state.projects.find((v: { name: string }) => v.name === "Knowledge and research controls");
  expect(state.tasks.filter((t: { projectId: string; kind: string }) => t.projectId === p.id && t.kind === "research")).toHaveLength(0);
  expect(p.localCalls).toBe(0);
});
