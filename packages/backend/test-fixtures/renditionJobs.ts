import type { TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type schema from "../convex/schema";
import { settleDueScheduled } from "./moderationPool";

// What the rendition tests share: photo-like bytes, and a look at the blobs and the scheduled
// generation runs (lib/imageModeration/renditions).

type T = TestConvex<typeof schema>;

/** A photo-like JPEG (a gradient), so the pipeline's re-encode and the renditions really run. */
export const jpeg = async (width: number, height: number) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / width;
      data[i + 1] = (y * 255) / height;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return new Uint8Array(
    await Jimp.fromBitmap({ width, height, data }).getBuffer("image/jpeg"),
  );
};

export const storeBytes = (t: T, bytes: Uint8Array) =>
  t.run(
    (ctx) =>
      ctx.storage.store(
        new Blob([bytes as BlobPart], { type: "image/jpeg" }),
      ) as Promise<Id<"_storage">>,
  );

export const storeWebp = (t: T, body: string) =>
  t.run(
    (ctx) =>
      ctx.storage.store(new Blob([body], { type: "image/webp" })) as Promise<
        Id<"_storage">
      >,
  );

export const blobExists = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

export const blobCount = (t: T) =>
  t.run(
    async (ctx) => (await ctx.db.system.query("_storage").collect()).length,
  );

export const blobType = (t: T, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.storage.get(id))?.type);

export const urlOf = async (t: T, id: Id<"_storage">) => {
  const url = await t.run((ctx) => ctx.storage.getUrl(id));
  if (!url) throw new Error("blob has no URL");
  return url;
};

export const allRenditions = (t: T) =>
  t.run((ctx) => ctx.db.query("imageRenditions").collect());

type GenerationJob = {
  _id: string;
  name: string;
  args: { sourceId: Id<"_storage">; attempt?: number }[];
  state: { kind: string };
};

const generationJobs = async (t: T) =>
  (
    (await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    )) as unknown as GenerationJob[]
  ).filter((job) => job.name.includes("renditions:generateRenditions"));

/** The generateRenditions runs scheduled so far (first attempts), by source. */
export const scheduledRenditions = async (t: T) =>
  (await generationJobs(t))
    .filter((job) => job.args[0].attempt === undefined)
    .map((job) => job.args[0].sourceId);

/**
 * Let the scheduled generation run. convex-test can fail an action's blob store while another
 * function's transaction is open ("Write outside of transaction"; here a Workpool's loop), which
 * the action treats as a storage failure and retries 30 s later: run each such retry now, as a
 * fresh attempt (so the test runtime cannot use up the retry budget), until none is left.
 */
export const settleRenditions = async (t: T) => {
  await settleDueScheduled(t);
  const ran = new Set<string>();
  for (let round = 0; round < 10; round++) {
    const retries = (await generationJobs(t)).filter(
      (job) => job.state.kind === "pending" && !ran.has(job._id),
    );
    if (retries.length === 0) return;
    for (const job of retries) {
      ran.add(job._id);
      await t.action(
        internal.lib.imageModeration.renditions.generateRenditions,
        { sourceId: job.args[0].sourceId },
      );
    }
  }
};

/** The last `imageModeration.backfillRenditions` event marked done, from the captured log lines. */
export const backfillDoneEvent = (logged: string[]) =>
  logged
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter(
      (line) =>
        line.event === "imageModeration.backfillRenditions" && line.done,
    )
    .pop();
