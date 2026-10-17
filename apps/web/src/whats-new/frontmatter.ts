import { z } from "zod";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

// `<yyyy-mm-dd>-<slug>.<locale>.md`
export const WHATS_NEW_FILE_NAME =
  /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.(en|nl)\.md$/;

const kebabId = z
  .string()
  .max(64)
  .regex(KEBAB, "must be kebab-case (a-z, 0-9, -)");
const text = z.string().trim().min(1, "must not be empty");

// YAML turns an unquoted 2026-10-20 (or an unquoted ISO timestamp) into a Date; quoted values stay
// strings. Either way the result is epoch ms; a bare date means 00:00 UTC.
const publishedAt = z
  .union([z.date(), z.string()])
  .transform((value, ctx) => {
    if (value instanceof Date) return value.getTime();
    if (DATE.test(value)) return Date.parse(`${value}T00:00:00Z`);
    if (DATETIME.test(value)) return Date.parse(value);
    ctx.addIssue({
      code: "custom",
      message: "must be YYYY-MM-DD or an ISO datetime with offset",
    });
    return z.NEVER;
  })
  .refine((ms) => Number.isFinite(ms), "is not a valid date");

// In-app path only: "/…" but not "//…" (protocol-relative) and no backslashes.
const inAppPath = z
  .string()
  .regex(/^\/(?!\/)[^\\]*$/, "must be an in-app path starting with /");

export const whatsNewFrontmatterSchema = z
  .strictObject({
    id: kebabId,
    publishedAt,
    title: text,
    summary: text,
    category: z.enum(["feature", "improvement", "fix"]),
    highlight: z.boolean().default(false),
    notify: z.boolean().default(false),
    cta: z.strictObject({ label: text, to: inAppPath }).optional(),
    image: z
      .string()
      .regex(
        /^(?:\/(?!\/)|https:\/\/)/,
        "must be a root-relative path or an https:// URL",
      )
      .optional(),
    imageAlt: text.optional(),
    tour: kebabId.optional(),
  })
  .refine((fm) => fm.imageAlt === undefined || fm.image !== undefined, {
    message: "is only allowed together with image",
    path: ["imageAlt"],
  });

export type WhatsNewFrontmatter = z.output<typeof whatsNewFrontmatterSchema>;

export type FrontmatterResult =
  { ok: true; data: WhatsNewFrontmatter } | { ok: false; problems: string[] };

export function parseWhatsNewFrontmatter(data: unknown): FrontmatterResult {
  const result = whatsNewFrontmatterSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    problems: result.error.issues.map((issue) => {
      const where = issue.path.join(".");
      return where ? `${where}: ${issue.message}` : issue.message;
    }),
  };
}
