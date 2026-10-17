import { CataloguePicker } from "@/components/catalogue-picker/catalogue-picker";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

// The multi-select picker on its own (the quick start reuses it in its "Add puzzles" step).
export const Route = createFileRoute("/_dashboard/my-puzzles/add/quick")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "quickAddPuzzles") }],
  }),
  component: QuickAddPuzzlesPage,
});

function QuickAddPuzzlesPage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-2xl">
      <CataloguePicker
        returnTo="/my-puzzles/add/quick"
        onAdded={() => void navigate({ to: "/my-puzzles" })}
      />
    </div>
  );
}
