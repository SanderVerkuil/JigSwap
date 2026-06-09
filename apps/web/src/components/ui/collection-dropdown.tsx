"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@clerk/nextjs";
import { gateway } from "@/gateway";
import { Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface CollectionDropdownProps {
  ownedPuzzleId: Id<"ownedPuzzles">;
  // The Copy aggregateId the domain add takes; the `forOwnedPuzzle` read still keys on the _id.
  copyAggregateId?: string;
  className?: string;
}

export function CollectionDropdown({
  ownedPuzzleId,
  copyAggregateId,
  className,
}: CollectionDropdownProps) {
  const { user } = useUser();
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);

  const convexUser = useQuery(
    gateway.identity.byClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const collections = useQuery(
    gateway.collections.listForUser,
    convexUser?._id ? { userId: convexUser._id } : "skip",
  );

  const puzzleCollections = useQuery(
    gateway.collections.forOwnedPuzzle,
    {
      ownedPuzzleId,
    },
  );

  const addPuzzleToCollection = useMutation(
    gateway.collections.addOwnedPuzzle,
  );

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

  const isInCollection = (collectionId: Id<"collections">) => {
    return puzzleCollections?.some((c) => c?._id === collectionId) || false;
  };

  if (!collections || collections.length === 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={className}>
            <FolderOpen className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href="/collections">
              <Plus className="h-4 w-4 mr-2" />
              Create Collection
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          disabled={isAdding}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {collections.map((collection) => (
          <DropdownMenuItem
            key={collection._id}
            onClick={() => handleAddToCollection(collection.aggregateId)}
            disabled={isInCollection(collection._id)}
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
                <span className="text-xs text-muted-foreground">Added</span>
              )}
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/collections">
            <Plus className="h-4 w-4 mr-2" />
            Manage Collections
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
