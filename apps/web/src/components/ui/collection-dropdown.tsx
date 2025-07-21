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
import { api } from "@jigswap/backend/convex/_generated/api";
import { Id } from "@jigswap/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { FolderOpen, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface CollectionDropdownProps {
  puzzleId: Id<"puzzles">;
  className?: string;
}

export function CollectionDropdown({
  puzzleId,
  className,
}: CollectionDropdownProps) {
  const { user } = useUser();
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);

  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );

  const collections = useQuery(
    api.collections.getUserCollections,
    convexUser?._id ? { userId: convexUser._id } : "skip",
  );

  const puzzleCollections = useQuery(api.collections.getCollectionsForPuzzle, {
    puzzleId,
  });

  const addPuzzleToCollection = useMutation(
    api.collections.addPuzzleToCollection,
  );

  const handleAddToCollection = async (collectionId: Id<"collections">) => {
    setIsAdding(true);
    try {
      await addPuzzleToCollection({
        collectionId,
        puzzleId,
      });
    } catch (error) {
      console.error("Failed to add puzzle to collection:", error);
    } finally {
      setIsAdding(false);
    }
  };

  const isInCollection = (collectionId: Id<"collections">) => {
    return puzzleCollections?.some((c) => c._id === collectionId) || false;
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
          <DropdownMenuItem onClick={() => router.push("/collections")}>
            <Plus className="h-4 w-4 mr-2" />
            Create Collection
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
            onClick={() => handleAddToCollection(collection._id)}
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
        <DropdownMenuItem onClick={() => router.push("/collections")}>
          <Plus className="h-4 w-4 mr-2" />
          Manage Collections
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
