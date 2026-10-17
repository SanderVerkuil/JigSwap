"use client";

import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import type { OwnedCopyView } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import {
  allowedProposeTypes,
  parsePriceCents,
  proposeErrorKey,
  type ProposeType,
} from "./request-trade";

// The copy being requested, as the browse read ships it (with the owner joined).
export type RequestableCopy = Pick<
  OwnedCopyView,
  "_id" | "ownerId" | "availability" | "puzzle" | "owner" | "coverUrl"
>;

interface RequestTradeDialogProps {
  copy: RequestableCopy | null;
  onOpenChange: (open: boolean) => void;
}

// Starts an exchange proposal for another member's copy: pick a type the copy is offered for, the
// type's terms (an offered copy for a swap, a price for a purchase), then submit via propose. All
// eligibility is re-checked server-side; this only keeps the obvious failures out of reach.
export function RequestTradeDialog({
  copy,
  onOpenChange,
}: RequestTradeDialogProps) {
  return (
    <Dialog open={copy !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {copy && (
          <RequestTradeForm
            key={copy._id}
            copy={copy}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RequestTradeForm({
  copy,
  onDone,
}: {
  copy: RequestableCopy;
  onDone: () => void;
}) {
  const t = useTranslations("tradeRequest");
  const displayName = useMemberDisplayName();
  const navigate = useNavigate();
  const propose = useMutation({
    mutationFn: useConvexMutation(gateway.exchange.create),
  });

  const types = allowedProposeTypes(copy.availability);
  const [type, setType] = useState<ProposeType | undefined>(types[0]);
  const [offeredId, setOfferedId] = useState<string>("");
  const [price, setPrice] = useState("");

  const { data: offerable } = useQuery(
    convexQuery(
      gateway.exchange.offerableCopies,
      type === "trade"
        ? { requestedPuzzleId: copy._id as Id<"ownedPuzzles"> }
        : "skip",
    ),
  );

  const ownerName = displayName(copy.owner);
  const title = copy.puzzle?.title ?? "";
  const priceCents = parsePriceCents(price);
  const ready =
    (type === "trade" && offeredId !== "") ||
    (type === "sale" && priceCents !== undefined) ||
    type === "loan";

  const handleSubmit = async () => {
    if (!type || !ready) return;
    try {
      await propose.mutateAsync({
        recipientId: copy.ownerId as Id<"users">,
        type,
        requestedPuzzleId: copy._id as Id<"ownedPuzzles">,
        ...(type === "trade"
          ? { offeredPuzzleId: offeredId as Id<"ownedPuzzles"> }
          : {}),
        ...(type === "sale" ? { salePrice: priceCents } : {}),
      });
      toast.success(t("success"));
      onDone();
      void navigate({ to: "/trades" });
    } catch (error) {
      toast.error(t(`errors.${proposeErrorKey(error)}`));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>
          {t("description", { name: ownerName })}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-2">
        <div className="flex items-center gap-3">
          {copy.coverUrl ? (
            <img
              src={copy.coverUrl}
              alt=""
              className="h-14 w-14 shrink-0 rounded-md object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{title}</p>
            {copy.puzzle ? (
              <p className="text-muted-foreground text-sm">
                {t("pieces", { count: copy.puzzle.pieceCount })}
              </p>
            ) : null}
            <div className="mt-1 flex items-center gap-2">
              <Avatar className="h-5 w-5 text-[10px]">
                {copy.owner?.avatar && (
                  <AvatarImage src={copy.owner.avatar} alt={ownerName} />
                )}
                <AvatarFallback>
                  <MemberInitial source={copy.owner} />
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground text-sm">
                {t("ownedBy", { name: ownerName })}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="trade-request-type">{t("typeLabel")}</Label>
          <Select
            value={type}
            onValueChange={(value) => setType(value as ProposeType)}
          >
            <SelectTrigger id="trade-request-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`types.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {type === "trade" && (
          <div className="space-y-1.5">
            <Label htmlFor="trade-request-offer">{t("offerLabel")}</Label>
            {offerable === undefined ? (
              <div className="bg-muted h-9 animate-pulse rounded-md" />
            ) : offerable.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("noOfferable")}
              </p>
            ) : (
              <Select value={offeredId} onValueChange={setOfferedId}>
                <SelectTrigger id="trade-request-offer">
                  <SelectValue placeholder={t("offerPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {offerable.map((option) => (
                    <SelectItem key={option._id} value={option._id}>
                      {option.ownedByViewer
                        ? option.title
                        : t("offerHousehold", {
                            title: option.title,
                            name: displayName(option.owner),
                          })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {type === "sale" && (
          <div className="space-y-1.5">
            <Label htmlFor="trade-request-price">{t("priceLabel")}</Label>
            <Input
              id="trade-request-price"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={t("pricePlaceholder")}
              aria-invalid={price !== "" && priceCents === undefined}
            />
            {price !== "" && priceCents === undefined && (
              <p className="text-destructive text-sm">{t("priceInvalid")}</p>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={propose.isPending}>
          {t("cancel")}
        </Button>
        <Button onClick={handleSubmit} disabled={!ready || propose.isPending}>
          {propose.isPending ? t("submitting") : t("submit")}
        </Button>
      </DialogFooter>
    </>
  );
}
