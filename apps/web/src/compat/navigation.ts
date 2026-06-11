import {
  notFound as routerNotFound,
  redirect as routerRedirect,
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearch,
  useRouter as useTanstackRouter,
} from "@tanstack/react-router";

// next/navigation compat: maps the Next router/navigation hooks to TanStack
// Router equivalents so ported `next/navigation` files only change the import.

export function useRouter() {
  const navigate = useNavigate();
  const router = useTanstackRouter();

  return {
    push: (href: string) => navigate({ to: href }),
    replace: (href: string) => navigate({ to: href, replace: true }),
    back: () => router.history.back(),
    forward: () => router.history.forward(),
    // Next's refresh re-runs loaders; TanStack's invalidate is the closest match.
    refresh: () => router.invalidate(),
    prefetch: () => Promise.resolve(),
  };
}

export function usePathname(): string {
  return useLocation().pathname;
}

// next/navigation returns a flat record; TanStack's useParams is generic and its
// structural-sharing constraint rejects a projected generic, so we cast the hook
// to a loose signature for drop-in usage from ported route components.
const useLooseParams = useRouterParams as (opts: {
  strict: false;
}) => Record<string, string>;
const useLooseSearch = useSearch as (opts: {
  strict: false;
}) => Record<string, unknown>;

export function useParams<
  T extends Record<string, string> = Record<string, string>,
>(): T {
  return useLooseParams({ strict: false }) as T;
}

// Returns a URLSearchParams-like object built from TanStack's typed search.
export function useSearchParams(): URLSearchParams {
  const search = useLooseSearch({ strict: false });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

// `redirect` throws (like Next's) so call sites short-circuit; usable in
// loaders/beforeLoad and components.
export function redirect(href: string): never {
  throw routerRedirect({ to: href });
}

export function notFound(): never {
  throw routerNotFound();
}
