import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your company, at work.' })).toBeVisible();
  (page as unknown as { attendxErrors: string[] }).attendxErrors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { attendxErrors: string[] }).attendxErrors).toEqual([]);
});

test('office renders its assets and selecting an agent updates the inspector', async ({ page }) => {
  await expect(page.locator('.agent-marker')).toHaveCount(7);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  const inspector = page.getByRole('complementary', { name: 'Agent details' });
  await expect(inspector.getByRole('heading', { name: 'Theo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View Nia, Product designer' }).click();
  await expect(inspector.getByRole('heading', { name: 'Nia', exact: true })).toBeVisible();
  await expect(inspector.getByText('Design the workspace welcome flow')).toBeVisible();
  await inspector.getByRole('button', { name: 'Pause task', exact: true }).click();
  await expect(inspector.locator('.status')).toHaveText('Paused');
  await expect(page.locator('.agent-marker.selected')).toContainText('Task paused');
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.locator('.agent-row.selected')).toContainText('Task paused');
  await inspector.getByRole('button', { name: 'Resume task', exact: true }).click();
  await expect(inspector.locator('.status')).toHaveText('Working');
});

test('search, workspace filters, stage filters, and empty states work together', async ({ page }) => {
  const search = page.getByRole('textbox', { name: 'Search agents, projects or tasks' });
  await search.fill('documentation');
  await expect(page.locator('.agent-marker')).toHaveCount(1);
  await expect(page.locator('.agent-marker')).toContainText('Iris');
  await search.fill('no such teammate');
  await expect(page.getByRole('heading', { name: 'No agents match your filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(page.locator('.agent-marker')).toHaveCount(7);
  await page.locator('.workspace-nav').getByRole('button', { name: 'Own products', exact: true }).click();
  await expect(page.locator('.agent-marker')).toHaveCount(3);
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.agent-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.agent-marker')).toHaveCount(7);
});

test('a project can be created with a team, and reassigned Ravi resumes correctly', async ({ page }) => {
  await page.getByRole('button', { name: 'Assign project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a new project' });
  await dialog.getByLabel('Project name').fill('Meridian reporting portal');
  await dialog.getByLabel('Project brief').fill('Build an accessible reporting portal using approved sample data.');
  await dialog.getByRole('checkbox', { name: /Maya/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /Theo/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /Ravi/ }).check();
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meridian reporting portal', exact: true })).toBeVisible();
  const inspector = page.getByRole('complementary', { name: 'Agent details' });
  await expect(inspector.getByRole('heading', { name: 'Ravi', exact: true })).toBeVisible();
  await expect(inspector.locator('.status')).toHaveText('Working');
  await inspector.getByRole('button', { name: 'Pause task', exact: true }).click();
  await inspector.getByRole('button', { name: 'Resume task', exact: true }).click();
  await expect(inspector.locator('.status')).toHaveText('Working');
  await page.locator('.project-card').filter({ has: page.getByRole('heading', { name: 'Meridian reporting portal' }) }).getByRole('button', { name: 'Open project' }).click();
  await expect(page.locator('.agent-row')).toHaveCount(1);
  await expect(page.locator('.agent-row')).toContainText('Ravi');
});

for (const decision of ['Approve request', 'Decline'] as const) {
  test(`access review can be ${decision === 'Decline' ? 'declined' : 'approved'} with its scope visible`, async ({ page }) => {
    await page.getByRole('button', { name: /Sera Atlas access review/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Review access request' });
    await expect(dialog.getByText(/schema metadata only/)).toBeVisible();
    await expect(dialog.getByText(/grants no production access/)).toBeVisible();
    await dialog.getByRole('button', { name: decision, exact: true }).click();
    await expect(page.getByText('All reviews complete')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notifications, 0 pending reviews' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('No external permissions were changed.');
  });
}

test('selecting a searched activity preserves its actor', async ({ page }) => {
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search agents, projects or tasks' }).fill('staging');
  await page.locator('.feed-event').filter({ hasText: 'Theo verified the staging API connection' }).click();
  await expect(page.getByRole('complementary', { name: 'Agent details' }).getByRole('heading', { name: 'Theo', exact: true })).toBeVisible();
});

test('artifact viewer exports an explicitly labeled sample report', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Test run · 18 checks' }).click();
  const dialog = page.getByRole('dialog', { name: 'Test run · 18 checks' });
  await expect(dialog.getByText('Sample checks passed')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download sample' }).click();
  const download = await downloading;
  const path = testInfo.outputPath('sample-report.json');
  await download.saveAs(path);
  const report = JSON.parse(await readFile(path, 'utf8'));
  expect(report).toMatchObject({ sample: true, agent: 'Theo', project: 'Atlas client portal' });
});

test('dialog traps keyboard focus and returns it on Escape', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Assign project', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Project name')).toBeFocused();
  await dialog.getByRole('button', { name: 'Create project', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('tablet view controls remain named when their text is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.locator('.agent-row')).toHaveCount(7);
  await page.getByRole('button', { name: 'Office view', exact: true }).click();
  await expect(page.locator('.agent-marker')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('mobile has a usable list, hidden closed navigation and no page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.agent-row')).toHaveCount(7);
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'View Nia, Product designer' }).click();
  await expect(page.getByRole('complementary', { name: 'Agent details' }).getByRole('heading', { name: 'Nia', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close agent details' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('office-mobile.png'), fullPage: true });
});
