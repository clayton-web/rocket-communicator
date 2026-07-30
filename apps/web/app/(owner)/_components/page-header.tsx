import type { ReactNode } from 'react';
import styles from './presentation.module.css';

/**
 * Page header (P1.4).
 *
 * Owns the single `<h1>` for an Owner page. Centralizing it is what keeps "exactly one
 * page-owned `<h1>`" true as surfaces are added: the shell contributes none, and a page that
 * uses this component cannot accidentally nest a second one.
 *
 * `meta` carries status badges, which sit beside the heading rather than inside it — a badge
 * inside the `<h1>` would become part of the accessible heading name, so a Task would be
 * announced as "Invoice follow-up Open Overdue".
 */
export function PageHeader({
  title,
  description,
  meta,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <h1 className={styles.pageTitle}>{title}</h1>
      {meta ? <div className={styles.pageMeta}>{meta}</div> : null}
      {description ? <p className={styles.pageDescription}>{description}</p> : null}
    </div>
  );
}
