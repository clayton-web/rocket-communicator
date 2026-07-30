import {
  test,
  expect,
  readAuthOperations,
  resetAuthOperations,
  uniqueLabel,
} from '../support/fixtures';
import { createTask } from '../support/owner-api';
import { seedCapabilityFixture } from '../support/capability-fixture';

/**
 * P1.4 Owner shell authentication budget (D119).
 *
 * This is the decisive measurement for "exactly one verified Owner identity operation per
 * Owner page request". P1.4 moves the Owner chrome into a layout, and a layout renders
 * alongside the page, so without render-pass deduplication every Owner page would verify
 * identity twice.
 *
 * Counting happens at the Supabase Auth protocol layer: the local Auth double tallies the
 * real `GET /auth/v1/user` and `POST /auth/v1/token` requests the application makes while
 * the real Next.js runtime renders layout plus page. No source call site is counted, and no
 * counter exists in application code.
 *
 * Measurements use `request.get()` rather than `page.goto()` deliberately. A browser
 * navigation can also trigger link prefetches, and each prefetch is a separate legitimate
 * request that renders the layout again — so a browser-level count would measure several
 * requests at once and could not isolate one. One `request.get()` is exactly one Owner page
 * request, which is the unit D119 budgets.
 *
 * Trace, screenshot, and video capture are disabled for this file because the capability-path
 * assertion requests a URL containing a raw capability token, and Playwright cannot redact it
 * from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('one Owner page request performs exactly one verified getUser across shell and page', async ({
  ownerPage,
}) => {
  await resetAuthOperations();

  const response = await ownerPage.request.get('/tasks');
  expect(response.status()).toBe(200);
  // Proves the shell rendered, so the count covers layout and page rather than page alone.
  const html = await response.text();
  expect(html).toContain('id="main-content"');
  expect(html).toContain('Skip to main content');
  expect(html).toContain('aria-label="Owner"');

  const operations = await readAuthOperations();

  expect(operations.user).toBe(1);
  expect(operations.token).toBe(0);
  expect(operations.total).toBe(1);
});

test('Task detail inside the shell also performs exactly one verified getUser', async ({
  ownerPage,
}) => {
  const task = await createTask(ownerPage.request, 'Fixture point', uniqueLabel('shell-auth'));

  await resetAuthOperations();
  const response = await ownerPage.request.get(`/tasks/${task.id}`);
  expect(response.status()).toBe(200);

  const operations = await readAuthOperations();

  expect(operations.user).toBe(1);
  expect(operations.total).toBe(1);
});

test('the attention destination inside the shell performs exactly one verified getUser', async ({
  ownerPage,
}) => {
  await resetAuthOperations();
  const response = await ownerPage.request.get('/attention');
  expect(response.status()).toBe(200);

  const operations = await readAuthOperations();

  expect(operations.user).toBe(1);
  expect(operations.total).toBe(1);
});

test('sequential Owner page requests are isolated and never share an identity', async ({
  ownerPage,
}) => {
  await resetAuthOperations();

  await ownerPage.request.get('/tasks');
  await ownerPage.request.get('/tasks');
  await ownerPage.request.get('/tasks');

  const operations = await readAuthOperations();

  // Three requests must cost three verified operations. Any fewer means identity leaked
  // across a request boundary, which is the cross-request caching D119 forbids.
  expect(operations.user).toBe(3);
});

test('concurrent Owner page requests are isolated and never share an identity', async ({
  ownerPage,
}) => {
  await resetAuthOperations();

  const responses = await Promise.all([
    ownerPage.request.get('/tasks'),
    ownerPage.request.get('/tasks'),
    ownerPage.request.get('/attention'),
  ]);
  for (const response of responses) {
    expect(response.status()).toBe(200);
  }

  const operations = await readAuthOperations();

  expect(operations.user).toBe(3);
});

test('capability surfaces still perform zero Owner authentication work', async ({
  ownerPage,
  request,
}) => {
  const fixture = await seedCapabilityFixture(ownerPage.request, 'shell-auth-cap');

  await resetAuthOperations();
  // `request` is a clean context with no Owner cookie, as a Recipient's browser would be.
  const page = await request.get(fixture.capability.capabilityPath);
  expect(page.status()).toBe(200);

  const operations = await readAuthOperations();

  expect(operations.user).toBe(0);
  expect(operations.total).toBe(0);
});

test('signing out performs a server-side revocation, not a client-side state reset', async ({
  ownerPage,
}) => {
  await resetAuthOperations();

  const response = await ownerPage.request.post('/auth/sign-out');
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).pathname).toBe('/login');

  const operations = await readAuthOperations();

  // The revocation reached Supabase. Clearing a cookie alone would leave this at zero.
  expect(operations.logout).toBe(1);
});
