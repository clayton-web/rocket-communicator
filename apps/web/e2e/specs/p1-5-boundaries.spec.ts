import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';

/**
 * P1.5 error and not-found boundary behaviour in the real framework runtime.
 *
 * The unit suite pins each boundary's structure and copy. What can only be proved here is
 * which boundary Next.js actually selects for a given URL, and which layout it renders
 * inside — the routing decision, not the component.
 *
 * Trace, screenshot, and video capture are disabled because one assertion seeds a real
 * capability fixture, and Playwright cannot redact a raw token from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** A token-shaped value that was never minted, so it can safely appear in an assertion. */
const FAKE_TOKEN = 'not-a-real-capability-token-0123456789';

async function ownerChromeCount(page: import('@playwright/test').Page) {
  return {
    shell: await page.locator('[data-owner-shell]').count(),
    nav: await page.locator('nav[aria-label="Owner"]').count(),
    signOut: await page.getByRole('button', { name: 'Sign out' }).count(),
  };
}

test('an unmatched public URL answers 404 with the chrome-free not-found page', async ({
  page,
}) => {
  const response = await page.goto('/definitely-not-a-route');

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.getByText('AI Communication Action Assistant')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to the application' })).toBeVisible();

  // A signed-out visitor must never be shown an authenticated surface.
  expect(await ownerChromeCount(page)).toEqual({ shell: 0, nav: 0, signOut: 0 });
});

test('an unmatched capability-shaped URL never echoes the token it carries', async ({ page }) => {
  const response = await page.goto(`/c/${FAKE_TOKEN}/extra`);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();

  // The decisive claim: the address is not reflected, so the token in it is not printed.
  const text = await page.locator('body').innerText();
  expect(text).not.toContain(FAKE_TOKEN);
  expect(text).not.toContain('/c/');
});

test('an unknown capability token keeps the existing capability-unavailable view', async ({
  page,
}) => {
  const response = await page.goto(`/c/${FAKE_TOKEN}`);

  // Unknown, expired, and consumed tokens are ordinary results, not errors. Routing them into
  // the framework not-found page would tell a Recipient more than possession of the link
  // should reveal, so this deliberately stays a 200 with the generic view.
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Link unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toHaveCount(0);
  expect(await ownerChromeCount(page)).toEqual({ shell: 0, nav: 0, signOut: 0 });
});

test('a missing Task reaches the Owner not-found state inside the Owner shell', async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto('/tasks/task_0000000000000000');

  await expect(page.getByRole('heading', { level: 1, name: 'Task not found' })).toBeVisible();

  // The Owner keeps navigation and identity, so a dead link is not a dead end.
  expect(await ownerChromeCount(page)).toEqual({ shell: 1, nav: 1, signOut: 1 });
  await expect(page.getByRole('link', { name: 'Back to Tasks' })).toBeVisible();

  // "Not there" must not read as "the application is broken".
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/did not respond|operator attention/i);
});

test('an unmatched URL under an Owner path still answers the chrome-free page', async ({
  page,
}) => {
  await signInAsOwner(page);
  const response = await page.goto('/tasks/deep/nested/nope');

  // No route matches, so the Owner route group is never entered and its layout never renders.
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  expect(await ownerChromeCount(page)).toEqual({ shell: 0, nav: 0, signOut: 0 });
});

test('a valid capability page remains outside Owner chrome', async ({ page, browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'p1-5-boundaries');

  // `page` is a clean context with no Owner cookie, as a Recipient's browser would be.
  const response = await page.goto(fixture.capability.capabilityPath);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();
  expect(await ownerChromeCount(page)).toEqual({ shell: 0, nav: 0, signOut: 0 });
});
