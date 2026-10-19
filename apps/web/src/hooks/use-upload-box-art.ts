import { gateway, Id } from "@/gateway";
import { preparePhoto } from "@/lib/prepare-photo";
import { useConvexAction, useConvexMutation } from "@convex-dev/react-query";

// Box art upload: re-encode the file in the browser (lib/prepare-photo: JPEG, long edge
// ≤ 1600 px, no EXIF), POST it to a one-shot upload URL, then have the server check it like
// every uploaded photo (catalog/sanitizeBoxArt: metadata strip, CSAM hash check, content
// check). Resolves with the CLEAN storage id, the only kind the catalog mutations accept as
// `image`; rejects with "InvalidImage" when the server refuses the image.
export function useUploadBoxArt() {
  const generateUploadUrl = useConvexMutation(
    gateway.library.generateUploadUrl,
  );
  const sanitize = useConvexAction(gateway.catalog.sanitizeBoxArt);
  return async (picked: File): Promise<Id<"_storage">> => {
    const { file } = await preparePhoto(picked);
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
