import { test, expect } from '@playwright/test';

// Begin with a fresh opaque parent, rather than navigating the app's local tab
// to about:blank, which triggers Chromium's separate local-network access check.
test('compiled preview renders SVG icons and works in an opaque sandbox without secure-context APIs', async ({ page, baseURL }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style><iframe title="Attendx embedded preview" sandbox="allow-scripts" src="${baseURL}/"></iframe>`);
  const frame = page.frameLocator('iframe[title="Attendx embedded preview"]');
  await expect(frame.getByRole('heading', { name: 'Your company, at work.' })).toBeVisible();
  expect(await frame.locator('svg').count()).toBeGreaterThan(0);
  expect(await frame.locator('body').evaluate(() => window.isSecureContext)).toBe(false);
  expect(await frame.locator('body').evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  await frame.locator('.office-image').evaluate(image => (image as HTMLImageElement).decode());
  await page.screenshot({ path: testInfo.outputPath('embedded-office.png'), fullPage: true });

  const inspector = frame.getByRole('complementary', { name: 'Agent details' });
  await inspector.getByRole('button', { name: 'Pause task', exact: true }).click();
  await expect(inspector.locator('.status')).toHaveText('Paused');
  await inspector.getByRole('button', { name: 'Resume task', exact: true }).click();
  await expect(inspector.locator('.status')).toHaveText('Working');

  await frame.getByRole('button', { name: 'Assign project', exact: true }).click();
  const dialog = frame.getByRole('dialog', { name: 'Assign a new project' });
  await dialog.getByLabel('Project name').fill('Embedded preview project');
  await dialog.getByLabel('Project brief').fill('Validate project creation inside a restricted preview frame.');
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Embedded preview project', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
