declare module "virtual:docs" {
  import type { DocPage, NavTree } from "./types";
  export const pages: DocPage[];
  export const navTree: NavTree;
}
