import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";

// next/navigation compat: maps the Next router/navigation hooks to TanStack
// Router equivalents so ported `next/navigation` files only change the import.

export function useRouter() {
  const navigate = useNavigate();

  return {
    // Next's push/replace return void; navigation failures surface through the
    // router's own error handling, so the TanStack promise is deliberately dropped.
    push: (href: string) => {
      void navigate({ to: href });
    },
    replace: (href: string) => {
      void navigate({ to: href, replace: true });
    },
  };
}

export function usePathname(): string {
  return useLocation().pathname;
}

const useLooseSearch = useSearch as (opts: {
  strict: false;
}) => Record<string, unknown>;

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
