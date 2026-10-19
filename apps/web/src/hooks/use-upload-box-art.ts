import { gateway, Id } from "@/gateway";
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";

// Box art upload: POST the file to a one-shot upload URL, then have the server strip its
// metadata (EXIF incl. GPS, XMP, IPTC, comments). Resolves with the CLEAN storage id, the only
// kind the catalog mutations accept as `image`. The server refuses anything that is not a
// JPEG, PNG or WebP of at most 10 MB.
export function useUploadBoxArt() {
  const generateUploadUrl = useConvexMutation(
    gateway.library.generateUploadUrl,
  );
  const sanitize = useConvexAction(gateway.catalog.sanitizeBoxArt);
  return async (file: Blob): Promise<Id<"_storage">> => {
    const uploadUrl = await generateUploadUrl({});
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) throw new Error("Image upload failed");
    const { storageId } = (await res.json()) as { storageId: string };
    return await sanitize({ storageId: storageId as Id<"_storage"> });
  };
}
