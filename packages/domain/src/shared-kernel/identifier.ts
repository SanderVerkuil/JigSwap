declare const brand: unique symbol;

export type Id<TBrand extends string> = string & { readonly [brand]: TBrand };

export const toId = <TBrand extends string>(value: string): Id<TBrand> =>
  value as Id<TBrand>;

export const fromId = <TBrand extends string>(id: Id<TBrand>): string => id;
