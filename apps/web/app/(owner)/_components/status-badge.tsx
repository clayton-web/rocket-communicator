import type { StatusTone } from '@/lib/presentation/task-status';
import styles from './presentation.module.css';

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: styles.badgeNeutral,
  positive: styles.badgePositive,
  caution: styles.badgeCaution,
  critical: styles.badgeCritical,
};

/**
 * Status badge (P1.4).
 *
 * Renders a label that already states its own meaning. Tone only adds emphasis, so the badge
 * stays legible to anyone who cannot distinguish the colours, and it needs no `role`,
 * `aria-label`, or title attribute to be understood — the text is the information.
 *
 * A server component: it holds no state and reacts to nothing.
 */
export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return <span className={`${styles.badge} ${TONE_CLASS[tone]}`}>{label}</span>;
}
