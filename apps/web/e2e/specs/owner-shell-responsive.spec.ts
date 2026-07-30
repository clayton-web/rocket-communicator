import { test, expect, uniqueLabel } from '../support/fixtures';
import { createTask } from '../support/owner-api';

/**
 * P1.4 responsive shell behaviour.
 *
 * Runs in both harness projects. On `chromium-mobile` (Pixel 7) these are the real mobile
 * assertions; on desktop they act as a regression guard, since a layout change that overflows
 * one viewport usually overflows both.
 *
 * Horizontal document overflow is asserted rather than eyeballed: it is the failure that makes
 * a phone layout feel broken, and it is invisible in a screenshot of the top of the page.
 */

const OWNER_ROUTES = ['/tasks', '/attention'];

test('no Owner route overflows the viewport horizontally', async ({ ownerPage }) => {
  const title = uniqueLabel('responsive');
  const task = await createTask(ownerPage.request, 'Fixture point', title);

  for (const path of [...OWNER_ROUTES, `/tasks/${task.id}`]) {
    await ownerPage.goto(path);
    await expect(ownerPage.getByRole('heading', { level: 1 })).toBeVisible();

    const overflow = await ownerPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} must not scroll horizontally`).toBeLessThanOrEqual(1);
  }
});

test('shell navigation and identity remain reachable and wrap rather than clip', async ({
  ownerPage,
}) => {
  await ownerPage.goto('/tasks');

  const nav = ownerPage.getByRole('navigation', { name: 'Owner' });
  const viewport = ownerPage.viewportSize();

  for (const label of ['Tasks', 'Attention']) {
    const link = nav.getByRole('link', { name: label });
    await expect(link).toBeVisible();

    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    // Inside the viewport horizontally: a wrapping row must not push a destination off-screen.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  }

  await expect(ownerPage.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('shell controls meet the established touch-target minimum', async ({ ownerPage }) => {
  await ownerPage.goto('/tasks');

  // 2.75rem at the default 16px root is 44px; the existing Task controls already use it, so the
  // shell must not introduce smaller ones.
  const minimum = 44;
  const nav = ownerPage.getByRole('navigation', { name: 'Owner' });

  for (const label of ['Tasks', 'Attention']) {
    const box = await nav.getByRole('link', { name: label }).boundingBox();
    expect(box!.height, `${label} target height`).toBeGreaterThanOrEqual(minimum - 1);
  }

  const signOut = await ownerPage.getByRole('button', { name: 'Sign out' }).boundingBox();
  expect(signOut!.height).toBeGreaterThanOrEqual(minimum - 1);
  expect(signOut!.width).toBeGreaterThanOrEqual(minimum - 1);
});

test('the viewport meta is present so declared sizes are honoured on mobile', async ({
  ownerPage,
}) => {
  await ownerPage.goto('/tasks');

  const content = await ownerPage.locator('meta[name="viewport"]').getAttribute('content');

  expect(content).toContain('width=device-width');
  // Pinch-zoom must stay available; capping scale is an accessibility regression.
  expect(content).not.toContain('maximum-scale=1');
  expect(content).not.toContain('user-scalable=no');
});
