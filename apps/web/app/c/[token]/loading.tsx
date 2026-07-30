import styles from './recipient-capability.module.css';

/**
 * Route loading boundary for the Recipient capability surface (P1.5 / D112).
 *
 * D112 permits a loading affordance for reads, and `GET /c/{token}` is a read: it resolves a
 * token to a Task without mutating anything. P1.3 deliberately shipped no loading file here
 * because the capability surface is externally visible and was scheduled last.
 *
 * What makes this boundary different from the two Owner ones is that it renders *before the
 * token has been validated*, so it is shown to holders of valid, expired, revoked, and
 * entirely made-up links alike. It therefore cannot say anything that only one of those
 * groups should hear. There is deliberately no heading: "Assigned task" would assert that a
 * Task exists and that this link reaches it, and "Link unavailable" would assert the reverse,
 * and at this point the server has answered neither question. The single generic line is the
 * most that is true for every visitor.
 *
 * A static module by construction — no props, no token, no `params`, no data access, no
 * client component, no timer. It cannot leak what it cannot receive, and it is what makes the
 * "one generic state for valid and invalid alike" claim structural rather than a copy review.
 *
 * No animation, matching the Owner boundaries: with nothing that moves there is no
 * reduced-motion preference to honour and nothing that could imply progress the server has
 * not actually made. `--aicaa-motion-*` is `none` for the same reason (D124).
 */
export default function Loading() {
  return (
    <main className={styles.page}>
      {/*
       * Same `<main class={page}>` frame as both resolved views, so the container width,
       * centring, and padding are already correct when the real content replaces this and the
       * page does not jump sideways or reflow around it.
       */}
      <p className={styles.lede} role="status">
        Loading task…
      </p>
    </main>
  );
}
