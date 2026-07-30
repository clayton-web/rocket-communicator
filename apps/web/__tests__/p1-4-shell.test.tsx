import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P1.4 Owner shell evidence.
 *
 * Renders the ACTUAL layout module rather than a reconstruction of it. That distinction is the
 * point: a test that rebuilds the expected markup passes whether or not the real layout is
 * wired up, so it proves nothing about what an Owner sees.
 */

vi.mock('@/lib/owner/shell-context', () => ({
  loadOwnerShellIdentity: vi.fn(async () => ({ displayName: 'Owner Example' })),
}));

let pathname = '/tasks';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

import OwnerLayout from '@/app/(owner)/layout';
import { loadOwnerShellIdentity } from '@/lib/owner/shell-context';

const ownerGroup = join(__dirname, '../app/(owner)');

// This suite renders the shell repeatedly and asserts on element *counts* ("exactly one main",
// "exactly one h1"), so a leaked previous render would turn every such assertion into a false
// failure. Vitest runs without globals here, so RTL's automatic cleanup is not registered.
afterEach(cleanup);

/** Source with comments stripped, so a scan for code cannot match prose about that code. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

async function renderShell(currentPath = '/tasks') {
  pathname = currentPath;
  return render(await OwnerLayout({ children: <h1>Tasks</h1> }));
}

describe('Owner shell landmarks and headings', () => {
  beforeEach(() => {
    vi.mocked(loadOwnerShellIdentity).mockResolvedValue({ displayName: 'Owner Example' });
  });

  it('renders one banner, one named navigation, and one main landmark', async () => {
    await renderShell();

    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'Owner' })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('gives main the skip-link target id', async () => {
    await renderShell();

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('leaves the page owning the only h1, with the product name as a link', async () => {
    await renderShell();

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Tasks');

    // The product name must be reachable but must not compete as a heading.
    const product = screen.getByRole('link', { name: 'AI Communication Action Assistant' });
    expect(product).toBeInTheDocument();
    expect(product.tagName).toBe('A');
  });

  it('places the skip link first in the document order, before any navigation', async () => {
    const { container } = await renderShell();
    const focusable = container.querySelectorAll('a[href], button');

    // Not merely "present": a skip link that is not first is a skip link nobody reaches.
    expect(focusable[0]).toHaveAttribute('href', '#main-content');
    expect(focusable[0]).toHaveTextContent('Skip to main content');
  });
});

describe('Owner shell navigation', () => {
  beforeEach(() => {
    vi.mocked(loadOwnerShellIdentity).mockResolvedValue({ displayName: 'Owner Example' });
  });

  it('offers exactly the three authorized destinations and nothing speculative', async () => {
    await renderShell();

    const nav = screen.getByRole('navigation', { name: 'Owner' });
    const links = [...nav.querySelectorAll('a')].map((link) => link.textContent);

    expect(links).toEqual(['Tasks', 'Attention']);
    // Sign out is the third destination but is a form submission, never a link.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it.each(['Recipients', 'Gmail', 'Settings', 'Suggestions', 'Reminders', 'Health', 'Admin'])(
    'does not offer a %s destination that has no Owner surface',
    async (label) => {
      await renderShell();

      expect(screen.queryByRole('link', { name: new RegExp(label, 'i') })).not.toBeInTheDocument();
    },
  );

  it('marks Tasks current on the Task list', async () => {
    await renderShell('/tasks');

    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Attention' })).not.toHaveAttribute('aria-current');
  });

  it('keeps Tasks current on a nested Task detail route', async () => {
    await renderShell('/tasks/task_abc123');

    // A deep route must not orphan the section it belongs to.
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks Attention current on the attention destination', async () => {
    await renderShell('/attention');

    expect(screen.getByRole('link', { name: 'Attention' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute('aria-current');
  });

  it('signals the current destination with more than colour', () => {
    const css = readFileSync(join(ownerGroup, 'owner-shell.module.css'), 'utf8');
    const currentRule = /\.navLinkCurrent\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    // Colour alone is invisible to anyone who cannot distinguish it.
    expect(currentRule).toMatch(/font-weight/);
    expect(currentRule).toMatch(/border-bottom-color/);
  });
});

describe('Owner shell identity and sign-out', () => {
  beforeEach(() => {
    vi.mocked(loadOwnerShellIdentity).mockResolvedValue({ displayName: 'Owner Example' });
  });

  it('shows who is signed in', async () => {
    await renderShell();

    expect(screen.getByText('Owner Example')).toBeInTheDocument();
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
  });

  it('submits sign-out as a POST form rather than a link', async () => {
    const { container } = await renderShell();
    const form = container.querySelector('form');

    // A GET link would be prefetchable, so merely hovering could end the session.
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/sign-out');
    expect(container.querySelector('a[href="/auth/sign-out"]')).toBeNull();
  });

  it('offers no sign-out when no session resolved, rather than implying one exists', async () => {
    vi.mocked(loadOwnerShellIdentity).mockResolvedValue({ displayName: null });

    const { container } = await renderShell();

    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    // Chrome still renders: the page's own gate is what redirects.
    expect(screen.getByRole('navigation', { name: 'Owner' })).toBeInTheDocument();
  });

  it('renders no page or Task content in the chrome', async () => {
    pathname = '/tasks/task_secret_1';
    const { container } = render(
      await OwnerLayout({
        children: (
          <div>
            <h1>Invoice 4102 needs approval</h1>
            <p>Overdue</p>
          </div>
        ),
      }),
    );
    const headerText = container.querySelector('header')?.textContent ?? '';

    // The shell must describe the application and the Owner, never the Task being viewed.
    expect(headerText).not.toContain('Invoice 4102');
    expect(headerText).not.toContain('Overdue');
    expect(headerText).not.toContain('task_secret_1');
    // What it does contain: product name, identity, sign-out, and the two destinations.
    expect(headerText).toContain('AI Communication Action Assistant');
    expect(headerText).toContain('Owner Example');
    expect(headerText).toContain('Sign out');
  });
});

describe('Owner shell module boundaries', () => {
  it('keeps the shell free of database and query work', () => {
    for (const relative of ['layout.tsx', '_components/owner-identity.tsx']) {
      expect(codeOf(join(ownerGroup, relative))).not.toMatch(
        /@aicaa\/db|lib\/db|prisma|listOwnerTasks|getOwnerTask/,
      );
    }
  });

  it('keeps the one client component free of server-only imports', () => {
    const nav = codeOf(join(ownerGroup, '_components/owner-nav.tsx'));

    expect(readFileSync(join(ownerGroup, '_components/owner-nav.tsx'), 'utf8')).toContain(
      "'use client'",
    );
    // A server-only import here would either break the build or drag Node code clientward.
    expect(nav).not.toMatch(/lib\/auth|lib\/db|lib\/observability|@aicaa\/db|server-only/);
  });

  it('marks the shell identity helper server-only', () => {
    const context = readFileSync(join(__dirname, '../lib/owner/shell-context.ts'), 'utf8');

    expect(context).toContain("import 'server-only'");
  });

  it('emits no second Owner authentication timing event from the shell', () => {
    const context = codeOf(join(__dirname, '../lib/owner/shell-context.ts'));

    // A duplicate `owner_authentication` event would make the shell look like the double
    // authentication P1.3 removed, in the very diagnostic used to prove it was gone.
    expect(context).not.toContain('emitOperationalLog');
    expect(context).not.toContain('owner_authentication');
  });

  /*
   * The shell itself stays server-rendered: `owner-nav.tsx` is the only chrome that needs
   * browser state. P1.5 adds `error.tsx`, which Next.js requires to be a client component
   * because an error boundary has to catch failures during client rendering. It is a
   * boundary, not chrome, and the list is pinned so shell markup cannot drift clientward
   * behind it.
   */
  it('adds no client component to the shell beyond the nav and the error boundary', () => {
    const clientModules: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== 'tasks') {
            walk(full);
          }
          continue;
        }
        if (entry.endsWith('.tsx') && readFileSync(full, 'utf8').includes("'use client'")) {
          clientModules.push(entry);
        }
      }
    };
    walk(ownerGroup);

    expect(clientModules.sort()).toEqual(['error.tsx', 'owner-nav.tsx']);
  });

  it('renders Task detail on the server now that only handoff needs browser state', () => {
    const detail = codeOf(join(ownerGroup, 'tasks/_components/task-detail.tsx'));
    const panel = readFileSync(join(ownerGroup, 'tasks/_components/handoff-panel.tsx'), 'utf8');

    expect(detail).not.toContain("'use client'");
    // The interactive boundary must remain intact, not be flattened into the server component.
    expect(panel).toContain("'use client'");
    expect(detail).toContain('<HandoffPanel');
  });

  it('formats Owner timestamps through the shared presentation authority', () => {
    const detail = codeOf(join(ownerGroup, 'tasks/_components/task-detail.tsx'));

    expect(detail).toContain('formatOwnerDateTime');
    // `toLocaleString()` without an explicit zone renders in the viewer's timezone (D117).
    expect(detail).not.toContain('toLocaleString');
  });
});
