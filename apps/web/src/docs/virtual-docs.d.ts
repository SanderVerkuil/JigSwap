declare module "virtual:docs" {
  import type { DocPage, NavTree } from "@/docs/types";
  export const pages: DocPage[];
  export const navTree: NavTree;
}
