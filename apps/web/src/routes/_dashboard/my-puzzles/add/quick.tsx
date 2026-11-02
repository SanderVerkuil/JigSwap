import { CataloguePicker } from "@/components/catalogue-picker/catalogue-picker";
import {
  clearPickTray,
  trayOutlivesLeavingTo,
  usePickTray,
} from "@/components/catalogue-picker/pick-tray";
import { LeaveGuard } from "@/components/quick-start/leave-guard";
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
  const { picks } = usePickTray();
  return (
    <div className="max-w-2xl">
      <CataloguePicker
        returnTo="/my-puzzles/add/quick"
        // The picks are in by now, whether or not the tray has caught up: no need to ask.
        onAdded={() =>
          void navigate({ to: "/my-puzzles", ignoreBlocker: true })
        }
        stickyFooter
      />
      {/* Up to PICK_LIMIT picks: any way out except Register (the tray outlives that) asks first. */}
      <LeaveGuard
        work={
          picks.length > 0 ? { kind: "puzzles", count: picks.length } : null
        }
        outlives={trayOutlivesLeavingTo}
        onDiscard={clearPickTray}
      />
    </div>
  );
}
