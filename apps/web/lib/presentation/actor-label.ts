/**
 * Owner-facing names for who caused something (A8.6c).
 *
 * One closed mapping, so every Owner surface that has to say "who did this" says it the same way.
 * The alternative — each surface choosing its own phrase — produces a product where the same
 * Recipient action is attributed three different ways on three pages, and nothing in the type
 * system notices.
 *
 * ## Why these three words
 *
 * `capability` becomes **The Recipient**, not the Recipient's name or email address. The actor
 * categories come from an audit row, and resolving one to a person would mean loading Recipient
 * identity into a rendering path that has no other reason to hold it (D134). The category is also
 * all the Owner needs: they know who they delegated to.
 *
 * `system` becomes **Rocket**, which is what the Owner-facing web surfaces have called the
 * assistant since A8.6a. The A8.5 email renderer says "your assistant" instead, and that
 * divergence is intentional rather than an oversight: an email arrives outside the product, where
 * a product name reads as marketing, while inside the product "your assistant" reads as a
 * different actor from the one the rest of the page keeps calling Rocket. Do not harmonize them by
 * importing either module into the other.
 *
 * ## What this deliberately is not
 *
 * It is not a renderer for `attributionLabel`. That column holds a display string chosen by the
 * write path, and it is the field most likely to carry a Recipient's name; a category enum cannot.
 * Surfaces that legitimately show attribution text — Task note attribution, for one — do so
 * directly and are unaffected by this module, which handles only the closed category.
 */

/** The audit actor categories, matching `OwnerNotificationActor['actorKind']` exactly. */
export type OwnerFacingActorKind = 'owner' | 'capability' | 'system';

/**
 * Closed and exhaustive. A fourth actor category would fail the build here rather than reaching a
 * page as an unlabelled enum value.
 */
export const OWNER_FACING_ACTOR_LABELS: Record<OwnerFacingActorKind, string> = {
  owner: 'You',
  capability: 'The Recipient',
  system: 'Rocket',
};

export function ownerFacingActorLabel(actorKind: OwnerFacingActorKind): string {
  return OWNER_FACING_ACTOR_LABELS[actorKind];
}
