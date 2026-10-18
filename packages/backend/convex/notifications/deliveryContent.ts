import type { NotificationView } from "@jigswap/contracts";
import type { NotificationState } from "@jigswap/domain";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

// What the out-of-band channels (email, push) render for ONE notification: the same resolution the
// in-app read model does (resolveNotificationView), flattened into render params + a deep link.
// Pure, so the "use node" send actions and the tests share it without a Convex ctx.

const notificationFields = schema.tables.notifications.validator.fields;

/**
 * The refs a delivery carries so the send action can resolve it for the recipient, mirroring the
 * domain notification (one actor; the subject as the row stores it). Optional on the action args:
 * a payload scheduled before these existed has none and renders from its params snapshot.
 */
export const deliveryRefsValidator = {
  actorId: v.optional(v.id("users")),
  subject: notificationFields.subject,
};

type SubjectRow = NonNullable<Doc<"notifications">["subject"]>;

/** The refs a channel forwards for `state`, shaped like the in-app row (notificationMapper toRow). */
export const deliveryRefsOf = (
  state: NotificationState,
): { actorId?: Id<"users">; subject?: SubjectRow } => ({
  ...(state.actorId !== undefined
    ? { actorId: state.actorId as unknown as Id<"users"> }
    : {}),
  ...(state.subject !== undefined
    ? { subject: state.subject as SubjectRow }
    : {}),
});

export const deliveryResolutionArgs = {
  recipientId: v.id("users"),
  type: notificationFields.type,
  params: v.optional(v.record(v.string(), v.string())),
  relatedId: v.optional(v.string()),
  ...deliveryRefsValidator,
};

export interface DeliveryContent {
  /**
   * Render params: the stored snapshot overlaid with the resolved actor name and the live context
   * the recipient may see. Never carries an email address.
   */
  readonly params: Record<string, string>;
  /**
   * The actor is DEPARTED (deleted or deactivated): render the "Former member" label, never a
   * name. A privacy-hidden living actor (e.g. a private owner declining a trade before ever
   * replying, or a private DM sender) is NOT flagged: it simply carries no actorName, so the
   * renderer uses its generic, nameless copy.
   */
  readonly actorAnonymous: boolean;
  /** The in-app deep link (root-relative); null when the read model has none (use the fallback). */
  readonly href: string | null;
}

/**
 * Flatten a resolved view into delivery content. `hasActorRef` says the delivery named an actor:
 * then the snapshot `actorName` is dropped in favour of the resolved one (a nameless actor gets the
 * renderer's generic fallback; a gone one is anonymous). Without an actor ref the snapshot stays.
 */
export const deliveryContentOf = (
  view: NotificationView,
  snapshot: Readonly<Record<string, string>> | undefined,
  hasActorRef: boolean,
): DeliveryContent => {
  const params: Record<string, string> = { ...snapshot };
  const actor = view.actors[0];
  if (hasActorRef) delete params["actorName"];
  if (actor && !actor.anonymous && actor.name) params["actorName"] = actor.name;

  const { context } = view;
  if (context.puzzleTitle) params["puzzleTitle"] = context.puzzleTitle;
  if (context.goalTitle) params["goalTitle"] = context.goalTitle;
  if (context.reason) params["reason"] = context.reason;
  if (context.rating !== undefined) params["rating"] = String(context.rating);
  if (context.exchangeStatus) params["exchangeStatus"] = context.exchangeStatus;
  if (context.messagePreview) params["messagePreview"] = context.messagePreview;
  if (context.messageKind) params["messageKind"] = context.messageKind;

  return {
    params,
    actorAnonymous:
      hasActorRef && actor?.anonymous === true && actor.departed === true,
    href: view.href,
  };
};
