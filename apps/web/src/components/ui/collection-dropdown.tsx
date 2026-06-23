"use client";

import { useUser } from "@/compat/clerk";
import Link from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

interface CollectionTargetProps {
  ownedPuzzleId: Id<"ownedPuzzles">;
  // The Copy aggregateId the domain add takes; the `forOwnedPuzzle` read still keys on the _id.
  copyAggregateId?: string;
}

// The inner menu items (the collection list + manage link) for adding a copy to a collection.
// Extracted so they can render inside a standalone DropdownMenu (CollectionDropdown) OR inside
// another menu as a submenu (the PuzzleCard overflow menu). Its queries run only when the
// surrounding menu/sub-content mounts, so a big library doesn't fire them per card on load.
export function CollectionMenuItems({
  ownedPuzzleId,
  copyAggregateId,
}: CollectionTargetProps) {
  const { user } = useUser();
  const t = useTranslations("collections");
  const [isAdding, setIsAdding] = useState(false);

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const collections = useQuery(
    gateway.collections.listForUser,
    convexUser?._id ? { userId: convexUser._id as Id<"users"> } : "skip",
  );

  const puzzleCollections = useQuery(gateway.collections.forOwnedPuzzle, {
    ownedPuzzleId,
  });

  const addPuzzleToCollection = useMutation(gateway.collections.addOwnedPuzzle);

  const handleAddToCollection = async (collectionAggregateId?: string) => {
    // The domain add takes the Collection + Copy aggregateIds; guard either missing.
    if (!collectionAggregateId || !copyAggregateId) {
      console.error("Cannot add: collection or copy is missing aggregateId.");
      return;
    }
    setIsAdding(true);
    try {
      await addPuzzleToCollection({
        collectionId: collectionAggregateId,
        copyId: copyAggregateId,
      });
    } catch (error) {
      console.error("Failed to add puzzle to collection:", error);
    } finally {
      setIsAdding(false);
    }
  };

  // DTO membership rows carry collection ids as opaque strings, so compare on string.
  const isInCollection = (collectionId: string) =>
    puzzleCollections?.some((c) => c?._id === collectionId) || false;

  if (!collections || collections.length === 0) {
    return (
      <DropdownMenuItem asChild>
        <Link href="/collections">
          <Plus className="h-4 w-4 mr-2" />
          {t("createCollection")}
        </Link>
      </DropdownMenuItem>
    );
  }

  return (
    <>
      {collections.map((collection) => (
        <DropdownMenuItem
          key={collection._id}
          onClick={() => handleAddToCollection(collection.aggregateId)}
          disabled={isInCollection(collection._id) || isAdding}
          className={isInCollection(collection._id) ? "opacity-50" : ""}
        >
          <div className="flex items-center gap-2 w-full">
            <div
              className="w-4 h-4 rounded flex items-center justify-center text-sm"
              style={{
                backgroundColor: collection.color + "20",
                color: collection.color,
              }}
            >
              {collection.icon}
            </div>
            <span className="flex-1">{collection.name}</span>
            {isInCollection(collection._id) && (
              <span className="text-xs text-muted-foreground">
                {t("added")}
              </span>
            )}
          </div>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/collections">
          <Plus className="h-4 w-4 mr-2" />
          {t("manageCollections")}
        </Link>
      </DropdownMenuItem>
    </>
  );
}

interface CollectionDropdownProps extends CollectionTargetProps {
  className?: string;
}

// Standalone "add to collection" control: a folder button that opens the collection menu. Kept for
// surfaces that want it as its own control; the PuzzleCard overflow menu uses CollectionMenuItems
// directly as a submenu instead.
export function CollectionDropdown({
  ownedPuzzleId,
  copyAggregateId,
  className,
}: CollectionDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={className}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <CollectionMenuItems
          ownedPuzzleId={ownedPuzzleId}
          copyAggregateId={copyAggregateId}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
