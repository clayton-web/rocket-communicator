import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import type { Locator, Page } from '@playwright/test';

/**
 * The Recipient capability surface resolves to the S4 semantic tokens (S4.2 / D174).
 *
 * S4.2 replaced the pre-migration light presentation (`--aicaa-color-ink` / `muted` / `line` /
 * `accent` plus hard-coded light literals) with direct consumption of the S4 role tokens.
 * Source guards prove the legacy names are gone and that each role appears the expected
 * number of times, but counts cannot detect the one mistake that matters most here: swapping
 * which element gets which token.
 *
 * So this compares resolved colour against the token value read from `:root` at runtime. No
 * expected value is hard-coded, so a remap fails and a future palette change does not.
 *
 * Trace, screenshot, and video capture are disabled because the raw capability token appears
 * in the navigated URL and Playwright cannot redact it from a trace (D114).
 */
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/**
 * Resolve a design token to the same `rgb(...)` form `getComputedStyle` reports, by letting
 * the browser do the conversion rather than parsing hex here.
 */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

async function styleOf(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (el, prop) => getComputedStyle(el)[prop as never] as unknown as string,
    property,
  );
}

/** Resolve a length token the same way computed `min-height` is reported. */
async function tokenMinHeight(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.minHeight = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).minHeight;
    probe.remove();
    return value;
  }, token);
}

test('every Recipient surface colour resolves to the token it should', async ({
  page,
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInAsOwner(ownerPage);
  const fixture = await seedCapabilityFixture(ownerPage.request, 'cap-tokens');

  await page.goto(fixture.capability.capabilityPath);
  await expect(page.getByRole('heading', { level: 1, name: 'Assigned task' })).toBeVisible();

  const background = await tokenColor(page, '--aicaa-color-background');
  const text = await tokenColor(page, '--aicaa-color-text');
  const muted = await tokenColor(page, '--aicaa-color-text-muted');
  const raised = await tokenColor(page, '--aicaa-color-surface-raised-solid');
  const surfaceBase = await tokenColor(page, '--aicaa-color-surface-base');
  const border = await tokenColor(page, '--aicaa-color-border');
  const borderStrong = await tokenColor(page, '--aicaa-color-border-strong');
  const borderCool = await tokenColor(page, '--aicaa-color-border-cool');
  const primary = await tokenColor(page, '--aicaa-color-primary');
  const onPrimary = await tokenColor(page, '--aicaa-color-on-primary');
  const info = await tokenColor(page, '--aicaa-color-info');
  const destructive = await tokenColor(page, '--aicaa-color-destructive');
  const focus = await tokenColor(page, '--aicaa-color-focus');
  const cool = await tokenColor(page, '--aicaa-color-surface-cool');

  // Distinct from each other, otherwise a swap could pass unnoticed.
  expect(
    new Set([
      background,
      text,
      muted,
      raised,
      surfaceBase,
      border,
      borderStrong,
      borderCool,
      primary,
      onPrimary,
      info,
      destructive,
      focus,
      cool,
    ]).size,
  ).toBe(14);

  const main = page.locator('main');
  expect(await main.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'light',
  );
  expect(await styleOf(main, 'backgroundColor')).toBe(background);
  expect(await styleOf(main, 'color')).toBe(text);

  // Muted body copy.
  expect(await styleOf(page.locator('main > p').first(), 'color')).toBe(muted);

  // Section rule and section heading.
  const section = page.locator('main section').first();
  expect(await styleOf(section, 'borderTopColor')).toBe(border);
  expect(await styleOf(section.getByRole('heading', { level: 2 }), 'color')).toBe(text);

  // Summary point: cool instruction rule on the leading edge, raised surface, body text.
  const point = page.locator('main li').first();
  await expect(point).toBeVisible();
  expect(await styleOf(point, 'borderLeftColor')).toBe(borderCool);
  expect(await styleOf(point, 'backgroundColor')).toBe(raised);
  expect(await styleOf(point, 'color')).toBe(text);

  // Action control in its resting state.
  const addNote = page.getByRole('button', { name: 'Add note' });
  expect(await styleOf(addNote, 'borderTopColor')).toBe(borderStrong);
  expect(await styleOf(addNote, 'color')).toBe(text);
  expect(await styleOf(addNote, 'backgroundColor')).toBe(raised);
  expect(await styleOf(addNote, 'minHeight')).toBe(
    await tokenMinHeight(page, '--aicaa-target-min'),
  );

  // Return-to-owner is destructive text and border on the raised surface, never a filled
  // destructive control with white normal-size text (D174).
  const returnToOwner = page.getByRole('button', { name: 'Return to owner' });
  expect(await styleOf(returnToOwner, 'color')).toBe(destructive);
  expect(await styleOf(returnToOwner, 'borderTopColor')).toBe(destructive);
  expect(await styleOf(returnToOwner, 'backgroundColor')).toBe(raised);
  expect(await styleOf(returnToOwner, 'backgroundColor')).not.toBe(destructive);

  // The return confirmation itself stays destructive text-and-border, never a filled primary.
  await returnToOwner.click();
  const returnDialog = page.getByRole('dialog');
  await expect(returnDialog).toBeVisible();
  const returnConfirm = returnDialog.getByRole('button', { name: 'Confirm' });
  expect(await styleOf(returnConfirm, 'color')).toBe(destructive);
  expect(await styleOf(returnConfirm, 'borderTopColor')).toBe(destructive);
  expect(await styleOf(returnConfirm, 'backgroundColor')).toBe(raised);
  expect(await styleOf(returnConfirm, 'backgroundColor')).not.toBe(primary);
  await page.keyboard.press('Escape');
  await expect(returnDialog).toHaveCount(0);

  // Focus ring.
  await addNote.focus();
  expect(await styleOf(addNote, 'outlineColor')).toBe(focus);

  // Dialog surface and its form controls.
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await styleOf(dialog, 'borderTopColor')).toBe(border);
  expect(await styleOf(dialog, 'backgroundColor')).toBe(raised);
  expect(await styleOf(dialog.locator('label').first(), 'color')).toBe(text);

  const note = dialog.getByLabel('Note', { exact: true });
  expect(await styleOf(note, 'borderTopColor')).toBe(border);
  expect(await styleOf(note, 'color')).toBe(text);
  expect(await styleOf(note, 'backgroundColor')).toBe(surfaceBase);

  // Primary confirmation: Rocket-red fill with on-primary text, not the legacy accent.
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  expect(await styleOf(confirm, 'backgroundColor')).toBe(primary);
  expect(await styleOf(confirm, 'color')).toBe(onPrimary);
  expect(await styleOf(confirm, 'backgroundColor')).not.toBe(destructive);

  // Outcome banner: info leading rule, structural border, body text on the cool surface.
  await note.fill('Synthetic note');
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  const banner = page.getByRole('status').first();
  await expect(banner).toBeVisible();
  expect(await styleOf(banner, 'borderLeftColor')).toBe(info);
  expect(await styleOf(banner, 'borderTopColor')).toBe(border);
  expect(await styleOf(banner, 'color')).toBe(text);
  expect(await styleOf(banner, 'backgroundColor')).toBe(cool);

  await ownerContext.close();
});

test('the unavailable link and loading boundary use the same tokens', async ({ page }) => {
  const unknownToken = `absent-${'x'.repeat(30)}`;
  await page.goto(`/c/${unknownToken}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Link unavailable' })).toBeVisible();

  const muted = await tokenColor(page, '--aicaa-color-text-muted');
  const background = await tokenColor(page, '--aicaa-color-background');
  const text = await tokenColor(page, '--aicaa-color-text');
  const main = page.locator('main');
  expect(await main.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  expect(await styleOf(main, 'backgroundColor')).toBe(background);
  expect(await styleOf(main, 'color')).toBe(text);
  // The lede is the only styled text here, and it must stay muted rather than inheriting.
  expect(await styleOf(page.locator('main > p').first(), 'color')).toBe(muted);
});
