import type { Page } from '@playwright/test';
import {
  test,
  expect,
  readAuthOperations,
  resetAuthOperations,
  uniqueLabel,
} from '../support/fixtures';
import { createTask } from '../support/owner-api';
import { seedCapabilityFixture } from '../support/capability-fixture';
import { recordCapabilityTokenFingerprint } from '../support/artifact-safety';

/**
 * P1.5 Owner gate flash removal.
 *
 * Before this stage the Owner chrome lived in a layout and the gate lived in each page, so an
 * unauthenticated request rendered the signed-out shell first and redirected afterwards. The
 * shell was briefly, genuinely painted. The gate now runs in the layout, above the chrome,
 * using the requested pathname that `proxy.ts` forwards as `x-aicaa-owner-path`.
 *
 * Two properties are measured here and nowhere else, because both are framework-runtime
 * behaviour that no unit test can stand in for:
 *
 *   1. the response really is a redirect — a 307 with a `Location`, emitted before a body,
 *      rather than a document that navigates once it reaches the browser;
 *   2. nothing of the Owner application is painted on the way to the login page.
 *
 * The acceptance condition is deliberately about paint, not about bytes. A redirect response
 * is allowed to serialize whatever the framework serializes; what must never happen is that a
 * signed-out visitor sees the application's chrome or a loading state.
 *
 * Trace, screenshot, and video capture are disabled because the capability assertions carry
 * real and token-shaped values, which Playwright cannot redact from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const OWNER_PATH_HEADER = 'x-aicaa-owner-path';

/** Owner chrome and loading states, counted as rendered nodes rather than as source strings. */
async function paintedOwnerUi(page: Page) {
  return {
    shell: await page.locator('[data-owner-shell]').count(),
    nav: await page.locator('nav[aria-label="Owner"]').count(),
    signOut: await page.getByRole('button', { name: 'Sign out' }).count(),
    loading: await page
      .getByRole('status')
      .filter({ hasText: /^Loading/ })
      .count(),
  };
}

const NOTHING_PAINTED = { shell: 0, nav: 0, signOut: 0, loading: 0 };

test('unauthenticated /tasks is a server redirect that preserves the destination', async ({
  request,
}) => {
  // `request` is a clean context with no Owner cookie, as a signed-out browser would be.
  const response = await request.get('/tasks', { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe('/login?next=%2Ftasks');
});

test('unauthenticated /attention is a server redirect that preserves the destination', async ({
  request,
}) => {
  const response = await request.get('/attention', { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe('/login?next=%2Fattention');
});

test('unauthenticated Task detail preserves the exact encoded Task path', async ({
  ownerPage,
  request,
}) => {
  const task = await createTask(ownerPage.request, 'Fixture point', uniqueLabel('gate-flash'));

  const response = await request.get(`/tasks/${task.id}`, { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  // The whole point of carrying the pathname: the Owner returns to the Task they asked for,
  // not to the Task list.
  expect(response.headers().location).toBe(
    `/login?next=${encodeURIComponent(`/tasks/${task.id}`)}`,
  );
});

test('the redirect carries no Owner response header of its own', async ({ request }) => {
  const response = await request.get('/tasks', {
    maxRedirects: 0,
    headers: { [OWNER_PATH_HEADER]: '/attention' },
  });

  // The pathname travels inward only. Nothing echoes it back to the caller.
  expect(response.headers()[OWNER_PATH_HEADER]).toBeUndefined();
});

test('no Owner chrome or loading state is painted on the way to the login page', async ({
  page,
}) => {
  const response = await page.goto('/tasks');

  // A genuine server redirect: the browser was sent to login by a 307, not by a document that
  // rendered the application and then navigated.
  const original = response?.request().redirectedFrom();
  expect(original).toBeTruthy();
  expect((await original?.response())?.status()).toBe(307);

  await expect(page).toHaveURL(/\/login\?next=%2Ftasks$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Owner sign in' })).toBeVisible();
  expect(await paintedOwnerUi(page)).toEqual(NOTHING_PAINTED);
});

for (const [pathname, expected] of [
  ['/tasks', '/login?next=%2Ftasks'],
  ['/attention', '/login?next=%2Fattention'],
] as const) {
  for (const spoofed of [
    '/attention',
    '/tasks',
    '//evil.example',
    'https://evil.example/tasks',
    'javascript:alert(1)',
    '/c/not-a-real-capability-token-0123456789',
  ]) {
    test(`a spoofed ${spoofed} header cannot change where ${pathname} sends the visitor`, async ({
      request,
    }) => {
      const response = await request.get(pathname, {
        maxRedirects: 0,
        headers: { [OWNER_PATH_HEADER]: spoofed },
      });

      // The proxy derives the value from the URL it is handling and discards the inbound one,
      // so the requested path wins no matter what the caller claimed.
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe(expected);
    });
  }
}

test('a spoofed header cannot redirect a Task detail request to another Task', async ({
  ownerPage,
  request,
}) => {
  const task = await createTask(ownerPage.request, 'Fixture point', uniqueLabel('gate-spoof'));

  const response = await request.get(`/tasks/${task.id}`, {
    maxRedirects: 0,
    headers: { [OWNER_PATH_HEADER]: '/tasks/task_forged' },
  });

  expect(response.headers().location).toBe(
    `/login?next=${encodeURIComponent(`/tasks/${task.id}`)}`,
  );
});

test('authenticated Owner routes still render the shell', async ({ ownerPage }) => {
  for (const pathname of ['/tasks', '/attention']) {
    await ownerPage.goto(pathname);

    await expect(ownerPage.getByRole('navigation', { name: 'Owner' })).toBeVisible();
    await expect(ownerPage.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(await ownerPage.locator('[data-owner-shell]').count()).toBe(1);
  }
});

test('authenticated Task navigation still shows the existing loading boundary', async ({
  ownerPage,
}) => {
  const title = uniqueLabel('gate-loading');
  const task = await createTask(ownerPage.request, 'Fixture point', title);

  await ownerPage.goto('/tasks');
  const link = ownerPage.getByRole('link', { name: new RegExp(title) });
  await expect(link).toBeVisible();

  // Delay the Task detail payload so the boundary is observable rather than theoretical.
  await ownerPage.route(`**/tasks/${task.id}*`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  const navigation = link.click();

  // Gating above the chrome must not have removed the loading state for a signed-in Owner:
  // the boundary renders inside a layout that has now already resolved the Owner.
  await expect(ownerPage.getByRole('status').filter({ hasText: 'Loading Task' })).toBeVisible();

  await navigation;
  await ownerPage.unroute(`**/tasks/${task.id}*`);
  await expect(ownerPage.getByRole('navigation', { name: 'Owner' })).toBeVisible();
});

test('capability GET stays outside Owner authentication and Owner chrome', async ({
  ownerPage,
  page,
  request,
}) => {
  const fixture = await seedCapabilityFixture(ownerPage.request, 'gate-flash-cap');

  await resetAuthOperations();
  const response = await request.get(fixture.capability.capabilityPath, {
    headers: { [OWNER_PATH_HEADER]: '/tasks' },
  });
  expect(response.status()).toBe(200);

  const operations = await readAuthOperations();
  expect(operations.total).toBe(0);

  // And nothing of the Owner application is rendered for a Recipient.
  await page.goto(fixture.capability.capabilityPath);
  expect(await paintedOwnerUi(page)).toEqual(NOTHING_PAINTED);
});

test('capability POST stays outside Owner authentication', async ({ request }) => {
  const unknownToken = 'G'.repeat(43);
  recordCapabilityTokenFingerprint(unknownToken);
  const taskId = '00000000-0000-4000-8000-0000000000fd';

  await resetAuthOperations();
  const response = await request.post(
    `/api/v1/capabilities/${unknownToken}/tasks/${taskId}/notes`,
    {
      headers: {
        'Content-Type': 'application/json',
        'If-Match': `"task-${taskId}-v1"`,
        [OWNER_PATH_HEADER]: '/tasks',
      },
      data: { confirmation: 'confirmed', body: 'should never persist' },
    },
  );

  // Rejected by capability authorization, never by an Owner session, and the internal header
  // the caller sent bought them nothing.
  expect(response.status()).toBeGreaterThanOrEqual(400);
  const operations = await readAuthOperations();
  expect(operations.total).toBe(0);
});
