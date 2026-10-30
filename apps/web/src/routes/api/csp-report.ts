import { handleCspReport } from "@/lib/csp-report";
import { createFileRoute } from "@tanstack/react-router";

// Where browsers send Content-Security-Policy violation reports (report-uri and the
// Reporting-Endpoints "csp" group). POST only; lib/csp-report.ts caps the body and logs the
// directive, blocked origin and page path of each violation, nothing else. Any other method
// gets 405 rather than the app shell.
export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      POST: ({ request }) => handleCspReport(request),
      ANY: () =>
        new Response(null, { status: 405, headers: { allow: "POST" } }),
    },
  },
});
