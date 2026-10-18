"use client";

// "Anna is typing…" above the composer (spec 6.3), in every thread kind. The
// server (conversation.getTyping) sends who is typing with each entry's age at
// query time; an entry is hidden here once that age plus the time since it
// arrived reaches TYPING_TTL_MS, on a local timer, so no clock comparison with
// the server is needed. The line always keeps its height so the thread doesn't
// jump, animates its dots only when motion is welcome, and is aria-hidden:
// screen readers hear new messages (the thread's live region), not typing.
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import type { TypingView } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { anonymousLabel } from "./format";

const TYPING_TTL_MS = 6_000;

const NO_TYPERS: readonly TypingView[] = [];

export function TypingLine({ threadId }: { threadId: string }) {
  const { data } = useQuery(
    convexQuery(gateway.conversation.getTyping, { threadId }),
  );
  return <TypingLineView typers={data ?? NO_TYPERS} />;
}

// The typers still live now: each entry's server age plus the time since this
// list arrived stays under TYPING_TTL_MS. Re-checks when the next one lapses.
function useLiveTypers(typers: readonly TypingView[]): readonly TypingView[] {
  const [live, setLive] = useState(typers);
  useEffect(() => {
    const receivedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const elapsed = Date.now() - receivedAt;
      const next = typers.filter(
        (typer) => typer.ageMs + elapsed < TYPING_TTL_MS,
      );
      setLive(next);
      if (next.length === 0) return;
      const untilNextLapse = Math.min(
        ...next.map((typer) => TYPING_TTL_MS - typer.ageMs - elapsed),
      );
      timer = setTimeout(update, untilNextLapse);
    };
    update();
    return () => clearTimeout(timer);
  }, [typers]);
  return live;
}

export function TypingLineView({ typers }: { typers: readonly TypingView[] }) {
  const t = useTranslations("messages");
  const displayName = useMemberDisplayName();
  const live = useLiveTypers(typers);
  const names = live.map(({ member }) =>
    member.anonymous ? anonymousLabel(member, t) : displayName(member.member),
  );
  const text =
    names.length === 0
      ? null
      : names.length === 1
        ? t("typing.one", { name: names[0] })
        : names.length === 2
          ? t("typing.two", { a: names[0], b: names[1] })
          : t("typing.several");

  return (
    <div
      aria-hidden
      data-testid="typing-line"
      className="text-muted-foreground flex h-6 shrink-0 items-center gap-2 px-4 text-xs"
    >
      {text && (
        <>
          <span className="flex items-center gap-0.5">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="bg-muted-foreground size-1 rounded-full motion-safe:animate-pulse"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          <span className="truncate">{text}</span>
        </>
      )}
    </div>
  );
}
