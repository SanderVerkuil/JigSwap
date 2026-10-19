"use client";

// Composer under the active thread. Sends text messages (optionally with one
// attached puzzle copy, picked via AttachPicker), or up to 4 staged photos
// with the text as their caption (sendStagedImages; the photos then wait in
// the thread's outbox until they are delivered). Location opens its own
// picker, which sends on its own (sendLocation); it is offered only while
// conversation.locationAvailable says location sharing is configured. Text messages get an optimistic
// insert into the newest page of the listThreadMessages paginated
// subscription the thread view holds (the established withOptimisticUpdate
// pattern — see use-favorites); Convex replaces the local patch when the
// server result streams back, so pending messages clear themselves. Layout per the message-center redesign spec §7.
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { conversationErrorCode } from "@/components/messaging/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gateway, type Id } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { OptimisticUpdate } from "convex/browser";
// sanctioned convex/react exception: insertAtTop, the paginated-query optimistic helper (see tanstack-query migration spec)
import { insertAtTop } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { Send } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { AttachMenu } from "./attach-menu";
import { AttachPicker } from "./attach-picker";
import { COMPOSER_SLOT_CLASS, ComposerClosed } from "./composer-closed";
import type { MessageCopy } from "./copy-card";
import { LocationPicker } from "./location-picker";
import { sendState } from "./photo-staging";
import { PHOTO_ACCEPT } from "./prepare-photo";
import { StagedCopyChip } from "./staged-copy-chip";
import { StagedPhotoChips } from "./staged-photo-chips";
import { usePhotosAvailable, usePhotoStaging } from "./use-photo-staging";
import { useTypingIndicator } from "./use-typing-indicator";

// The Thread aggregate rejects longer bodies (ConvexError code MessageTooLong).
const MAX_MESSAGE_LENGTH = 4000;

type PostMessageArgs = FunctionArgs<typeof gateway.conversation.postMessage>;

// Insert the message locally at the top (newest end) of the thread view's
// newest-first paginated subscription; a no-op until that first page has
// loaded. Convex reverts the patch when the mutation settles. Module-level
// factory so the impure Date.now()/randomUUID calls stay out of render.
const optimisticAppend =
  (staged: MessageCopy | null): OptimisticUpdate<PostMessageArgs> =>
  (localStore, args) => {
    insertAtTop({
      paginatedQuery: gateway.conversation.listThreadMessages,
      argsToMatch: { threadId: args.threadId },
      localQueryStore: localStore,
      item: {
        id: `pending-${crypto.randomUUID()}`,
        isMine: true,
        kind: args.kind,
        body: args.body,
        sentAt: Date.now(),
        // The staged card is already loaded — show it on the pending bubble.
        ...(staged && args.copyId === staged.copyId ? { copy: staged } : {}),
      },
    });
  };

export function MessageComposer({
  threadId,
  recipientName,
  theirsLabel,
  placeholder,
  canAttachCopy = true,
  locationGroup,
}: {
  threadId: string;
  // Names the textarea ("Message Esther"); falls back to the generic label.
  recipientName?: string;
  // The attach picker's tab for the other member's copies; null hides it.
  theirsLabel: string | null;
  // The textarea's placeholder ("Write to Puzzle Club…"); the generic one by default.
  placeholder?: string;
  // Whether "Attach a puzzle" is offered (not yet in circle threads).
  canAttachCopy?: boolean;
  // A circle thread: the location consent addresses the group.
  locationGroup?: { circle: string; others: number };
}) {
  const t = useTranslations("messages");
  const { member } = useCurrentMember();
  const me = member?._id;

  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<MessageCopy | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  // Set by a pick so the picker's close hands focus to the input, not back to
  // the attach button.
  const pickedRef = useRef(false);
  const stagedDescriptionId = useId();
  const photosDescriptionId = useId();
  const sendHintId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const staging = usePhotoStaging(threadId);
  const photosAvailable = usePhotosAvailable();
  const isMobile = useIsMobile();
  const typing = useTypingIndicator(threadId);
  // After picking or removing an attachment: the textarea on desktop; on
  // phones the attach button, so the keyboard doesn't pop up unasked.
  const focusAfterAttachChange = () =>
    (isMobile ? attachButtonRef : textareaRef).current?.focus();
  // A CannotReply (or NotConnected) refusal means no reply can get through:
  // close the composer with the same neutral text a read-only thread shows
  // (never naming a block).
  // Keyed by thread so moving to another thread reopens the composer.
  const [closedThreadId, setClosedThreadId] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  // A LocationUnavailable refusal hides Location for this thread.
  const [locationHiddenIn, setLocationHiddenIn] = useState<string | null>(null);
  const { data: location } = useQuery(
    convexQuery(gateway.conversation.locationAvailable, { threadId }),
  );
  const locationAvailable =
    location?.available === true && locationHiddenIn !== threadId;
  const hideLocation = useCallback(() => {
    setLocationHiddenIn(threadId);
    setLocationOpen(false);
  }, [threadId]);

  const postMessage = useMutation({
    mutationFn: useConvexMutation(
      gateway.conversation.postMessage,
    ).withOptimisticUpdate(optimisticAppend(staged)),
  });

  const sendStagedImages = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.sendStagedImages),
  });
  const action = sendState({
    body,
    photos: staging.photos,
    hasCopy: staged !== null,
  });

  // Photos with the text as their caption. The text clears right away; the
  // chips once the send is recorded (they reappear in the outbox).
  const sendPhotos = async (attachmentIds: string[]) => {
    const caption = body.trim();
    setError(null);
    setBody("");
    typing.onSent();
    try {
      await sendStagedImages.mutateAsync({
        threadId,
        attachmentIds: attachmentIds as Id<"messageAttachments">[],
        ...(caption ? { caption } : {}),
      });
      staging.clear();
    } catch (err) {
      setBody((current) => current || caption);
      const code = conversationErrorCode(err);
      if (code === "CannotReply" || code === "NotConnected") {
        setClosedThreadId(threadId);
        return;
      }
      if (code === "AttachmentNotFound") {
        // A staged photo can no longer be sent (gone, or expired): drop them.
        staging.clear();
        setError(t("photos.sendGone"));
        return;
      }
      setError(
        code === "CaptionTooLong" ? t("photos.captionTooLong") : t("sendError"),
      );
    }
  };

  const send = async () => {
    if (!me || sendStagedImages.isPending) return;
    if (action.kind === "photos") return sendPhotos(action.attachmentIds);
    if (action.kind !== "text") return;
    const trimmed = body.trim();
    // A message always carries text; an attachment rides along with it.
    if (!trimmed || !me) return;
    const copy = staged;
    setError(null);
    // Clear immediately — the optimistic append already shows the message.
    setBody("");
    setStaged(null);
    typing.onSent();
    try {
      await postMessage.mutateAsync({
        threadId,
        kind: "text",
        body: trimmed,
        ...(copy ? { copyId: copy.copyId as Id<"ownedPuzzles"> } : {}),
      });
    } catch (err) {
      // Give the text back unless the user already started typing a new one.
      setBody((current) => current || trimmed);
      const code = conversationErrorCode(err);
      if (code === "CannotReply" || code === "NotConnected") {
        setClosedThreadId(threadId);
        return;
      }
      if (code === "CopyNotFound") {
        // The copy went away or out of view since it was picked: drop it.
        toast.error(t("copyNotFound"));
        return;
      }
      if (copy) setStaged((current) => current ?? copy);
      setError(code === "MessageTooLong" ? t("tooLong") : t("sendError"));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (closedThreadId === threadId) return <ComposerClosed reason="cantReply" />;

  return (
    <div className={COMPOSER_SLOT_CLASS}>
      {staged && (
        <StagedCopyChip
          copy={staged}
          descriptionId={stagedDescriptionId}
          onRemove={() => {
            setStaged(null);
            focusAfterAttachChange();
          }}
        />
      )}
      <StagedPhotoChips
        photos={staging.photos}
        onRemove={(key) => {
          staging.remove(key);
          focusAfterAttachChange();
        }}
      />
      {staging.photos.length > 0 && (
        <span id={photosDescriptionId} className="sr-only">
          {t("photos.attachedCount", { count: staging.photos.length })}
        </span>
      )}
      {/* Outside the menu, so the picker still opens from the tap (iOS). */}
      <input
        ref={fileInputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset, so picking the same file again still fires.
          event.target.value = "";
          if (files.length > 0) staging.addFiles(files);
          focusAfterAttachChange();
        }}
      />
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            typing.onInput(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t("typeMessage")}
          aria-label={
            recipientName
              ? t("messageName", { name: recipientName })
              : t("typeMessage")
          }
          // Announces the staged attachments ("Attached: <title>", "2 photos
          // attached") and why Send is off when a puzzle and photos clash.
          aria-describedby={
            [
              staged && stagedDescriptionId,
              staging.photos.length > 0 && photosDescriptionId,
              action.kind === "blocked" && sendHintId,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          // muted-foreground lifts the outline to ≥3:1 (--input is ~1.3:1).
          className="border-muted-foreground/80 dark:border-muted-foreground/60 max-h-40 min-h-11 flex-1 resize-none rounded-[20px] px-4 py-2.5 md:min-h-10"
        />
        {/* [ Message ] [ paperclip ] [ Send ]: DOM order is the tab order. */}
        <AttachMenu
          triggerRef={attachButtonRef}
          photosAvailable={photosAvailable}
          onPuzzle={canAttachCopy ? () => setPickerOpen(true) : undefined}
          onPhoto={() => fileInputRef.current?.click()}
          locationAvailable={locationAvailable}
          onLocation={() => setLocationOpen(true)}
        />
        <Button
          onClick={() => void send()}
          disabled={
            !me ||
            sendStagedImages.isPending ||
            (action.kind !== "text" && action.kind !== "photos")
          }
          size="icon"
          className="size-11 rounded-full md:size-10"
          aria-label={t("sendMessage")}
        >
          <Send className="size-4" />
        </Button>
      </div>
      {action.kind === "blocked" && (
        <p id={sendHintId} className="text-muted-foreground mt-1.5 text-xs">
          {t("photos.copyWithPhotos")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive mt-1.5 text-xs">
          {error}
        </p>
      )}
      {locationAvailable && (
        <LocationPicker
          open={locationOpen}
          onOpenChange={setLocationOpen}
          threadId={threadId}
          recipientName={recipientName ?? t("locations.recipientFallback")}
          group={locationGroup}
          exactCurrentLocation={location?.exactCurrentLocation === true}
          onSent={() => {
            setError(null);
            typing.onSent();
          }}
          onCannotReply={() => {
            setLocationOpen(false);
            setClosedThreadId(threadId);
          }}
          onUnavailable={hideLocation}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            attachButtonRef.current?.focus();
          }}
        />
      )}
      {canAttachCopy && (
        <AttachPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          threadId={threadId}
          theirsLabel={theirsLabel}
          onSelect={(copy) => {
            setStaged(copy);
            pickedRef.current = true;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (pickedRef.current) {
              pickedRef.current = false;
              focusAfterAttachChange();
            } else {
              attachButtonRef.current?.focus();
            }
          }}
        />
      )}
    </div>
  );
}
