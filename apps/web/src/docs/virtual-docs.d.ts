// Served by vite-plugin-docs.ts; module shapes in src/docs/virtual-modules.ts.
declare module "virtual:docs" {
  import type { DocMeta } from "@/docs/types";
  export const pages: DocMeta[];
}

declare module "virtual:docs/content" {
  import type { DocContent } from "@/docs/types";
  export const pageLoaders: Partial<Record<string, () => Promise<DocContent>>>;
}

declare module "virtual:docs/search" {
  import type { SearchDoc } from "@/docs/search";
  export const searchLoaders: Partial<
    Record<string, () => Promise<{ docs: SearchDoc[] }>>
  >;
}
