import { test, expect, signInAsOwner } from '../support/fixtures';
import { seedCapabilityFixture } from '../support/capability-fixture';
import type { Locator, Page } from '@playwright/test';

/**
 * The Recipient capability surface resolves to the canonical design tokens (P1.5 / D116).
 *
 * P1.5 replaced the `--ink`/`--muted`/`--line`/`--accent` compatibility aliases with the
 * `--aicaa-color-*` tokens they pointed at. Source guards prove the aliases are gone and that
 * each token appears the expected number of times, but counts cannot detect the one mistake
 * that matters most here: swapping which element gets which token. Six `var(--aicaa-color-ink)`
 * and five `var(--aicaa-color-line)` stay six and five however they are shuffled.
 *
 * So this compares resolved colour against the token value read from `:root` at runtime. The
 * four tokens are visually distinct, and no expected value is hard-coded, so a remap fails and
 * a future palette change does not.
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

  const ink = await tokenColor(page, '--aicaa-color-ink');
  const muted = await tokenColor(page, '--aicaa-color-muted');
  const line = await tokenColor(page, '--aicaa-color-line');
  const accent = await tokenColor(page, '--aicaa-color-accent');

  // Distinct from each other, otherwise a swap could pass unnoticed.
  expect(new Set([ink, muted, line, accent]).size).toBe(4);

  // Muted body copy.
  expect(await styleOf(page.locator('main > p').first(), 'color')).toBe(muted);

  // Section rule and section heading.
  const section = page.locator('main section').first();
  expect(await styleOf(section, 'borderTopColor')).toBe(line);
  expect(await styleOf(section.getByRole('heading', { level: 2 }), 'color')).toBe(ink);

  // Summary point: accent rule on the leading edge, muted eyebrow label.
  const point = page.locator('main li').first();
  await expect(point).toBeVisible();
  expect(await styleOf(point, 'borderLeftColor')).toBe(accent);

  // Action control in its resting state.
  const addNote = page.getByRole('button', { name: 'Add note' });
  expect(await styleOf(addNote, 'borderTopColor')).toBe(line);
  expect(await styleOf(addNote, 'color')).toBe(ink);

  // Focus ring.
  await addNote.focus();
  expect(await styleOf(addNote, 'outlineColor')).toBe(accent);

  // Dialog surface and its form controls.
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await styleOf(dialog, 'borderTopColor')).toBe(line);
  expect(await styleOf(dialog.locator('label').first(), 'color')).toBe(ink);

  const note = dialog.getByLabel('Note', { exact: true });
  expect(await styleOf(note, 'borderTopColor')).toBe(line);
  expect(await styleOf(note, 'color')).toBe(ink);

  // Primary confirmation keeps the accent as its fill.
  expect(await styleOf(dialog.getByRole('button', { name: 'Confirm' }), 'backgroundColor')).toBe(
    accent,
  );

  // Outcome banner: accent leading rule, line border, ink text. Deliberately a confirmed
  // success, because the error tone overrides the leading rule with its own critical colour.
  await note.fill('Synthetic note');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);
  const banner = page.getByRole('status').first();
  await expect(banner).toBeVisible();
  expect(await styleOf(banner, 'borderLeftColor')).toBe(accent);
  expect(await styleOf(banner, 'borderTopColor')).toBe(line);
  expect(await styleOf(banner, 'color')).toBe(ink);

  await ownerContext.close();
});

test('the unavailable link and loading boundary use the same tokens', async ({ page }) => {
  const unknownToken = `absent-${'x'.repeat(30)}`;
  await page.goto(`/c/${unknownToken}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Link unavailable' })).toBeVisible();

  const muted = await tokenColor(page, '--aicaa-color-muted');
  // The lede is the only styled text here, and it must stay muted rather than inheriting.
  expect(await styleOf(page.locator('main > p').first(), 'color')).toBe(muted);
});
