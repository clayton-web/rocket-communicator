import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/runtime-db', () => ({
  loadDbRuntime: vi.fn(),
}));

import { loadDbRuntime } from '@/lib/db/runtime-db';
import {
  MISSED_NOTIFICATION_LIMIT,
  MISSED_NOTIFICATION_WINDOW_DAYS,
  loadOwnerMissedNotificationsView,
  missedNotificationWindowStart,
} from '@/lib/notifications/missed-notifications-service';

/**
 * A8.6c — the `/attention` section two read.
 *
 * The service owns the two ratified numbers and the one clock read on the path. Both matter more
 * than their size suggests: the window is the *only* mechanism by which an item ever leaves this
 * surface, so an arithmetic slip silently changes the product's retirement rule, and the limit is
 * the ceiling the repository refuses to exceed.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');

describe('A8.6c undelivered notification service', () => {
  const listUndeliveredOwnerNotifications = vi.fn();

  beforeEach(() => {
    listUndeliveredOwnerNotifications.mockReset().mockResolvedValue([]);
    vi.mocked(loadDbRuntime).mockResolvedValue({
      listUndeliveredOwnerNotifications,
    } as never);
  });

  describe('the ratified bounds', () => {
    it('is a thirty-day window and a fifty-item maximum', () => {
      expect(MISSED_NOTIFICATION_WINDOW_DAYS).toBe(30);
      expect(MISSED_NOTIFICATION_LIMIT).toBe(50);
    });

    it('asks the repository for exactly those bounds', async () => {
      await loadOwnerMissedNotificationsView({
        db: {} as never,
        organizationId: 'org_1',
        now: NOW,
      });

      expect(listUndeliveredOwnerNotifications).toHaveBeenCalledWith(
        {},
        {
          organizationId: 'org_1',
          occurredAtOrAfter: '2026-08-02T12:00:00.000Z',
          limit: 50,
        },
      );
    });
  });

  describe('the window', () => {
    it('starts exactly thirty days before the instant it is given', () => {
      expect(missedNotificationWindowStart(NOW)).toBe('2026-08-02T12:00:00.000Z');
    });

    /**
     * Fixed-length days, deliberately. The cutoff is compared against a UTC instant column, not
     * against an organization-local calendar date, so a window that shifted by an hour across a
     * daylight-saving boundary would move the retirement edge for no reason.
     */
    it('is unaffected by a daylight-saving transition inside the window', () => {
      const afterFallBack = new Date('2026-11-20T12:00:00.000Z');
      expect(missedNotificationWindowStart(afterFallBack)).toBe('2026-10-21T12:00:00.000Z');
    });
  });

  describe('what it does not do', () => {
    /**
     * No flag is consulted. This reads durable state, and gating the read would hide rows that
     * exist — a flag switched off after capture had run would erase history the Owner is entitled
     * to see. With the flags unset the table is empty, which is the truthful reason for an empty
     * surface.
     */
    it('reads the repository without consulting any delivery flag', async () => {
      const view = await loadOwnerMissedNotificationsView({
        db: {} as never,
        organizationId: 'org_1',
        now: NOW,
      });
      expect(listUndeliveredOwnerNotifications).toHaveBeenCalledTimes(1);
      expect(view.items).toEqual([]);
      expect(view.windowDays).toBe(30);
    });

    /** A repository failure propagates, so a missing migration cannot read as "nothing missed". */
    it('lets a repository failure reach the caller instead of degrading to empty', async () => {
      listUndeliveredOwnerNotifications.mockRejectedValue(new Error('relation does not exist'));
      await expect(
        loadOwnerMissedNotificationsView({ db: {} as never, organizationId: 'org_1', now: NOW }),
      ).rejects.toThrow(/relation does not exist/);
    });
  });
});
