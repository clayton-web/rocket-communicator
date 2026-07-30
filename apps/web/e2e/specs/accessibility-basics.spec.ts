import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';

/**
 * Basic accessibility properties of the CURRENT journeys.
 *
 * Deliberately narrow: P1.2 records evidence and findings; the accessibility implementation
 * belongs to P1.5. No new accessibility dependency is introduced.
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('Owner pages expose one visible heading and named navigation', async ({ ownerPage }) => {
  await ownerPage.goto('/tasks');

  const headings = ownerPage.getByRole('heading', { level: 1 });
  await expect(headings).toHaveCount(1);
  await expect(headings).toBeVisible();

  // Navigation has an accessible name and named links. P1.4 moved it into the Owner shell and
  // replaced the per-page "Home" link with the two authorized Owner destinations.
  const nav = ownerPage.getByRole('navigation', { name: 'Owner' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Attention' })).toBeVisible();

  // Landmarks the shell now guarantees on every Owner route.
  await expect(ownerPage.getByRole('banner')).toBeVisible();
  await expect(ownerPage.getByRole('main')).toHaveAttribute('id', 'main-content');
});

test('capability page controls have accessible names and support keyboard activation', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'a11y');

  await page.goto(fixture.capability.capabilityPath);
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();

  // Every action control has an accessible name derived from its label, not a test id.
  const addNote = page.getByRole('button', { name: 'Add note' });
  await expect(addNote).toBeVisible();

  // Keyboard activation works for a representative flow.
  await addNote.focus();
  await expect(addNote).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  // The dialog is labelled, so assistive technology announces its purpose.
  await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);

  // Focus is not trapped accidentally: the dialog controls remain keyboard reachable and
  // cancelling returns to the browse state.
  await dialog.getByLabel('Note', { exact: true }).focus();
  await expect(dialog.getByLabel('Note', { exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(addNote).toBeVisible();

  await ownerContext.close();
});
