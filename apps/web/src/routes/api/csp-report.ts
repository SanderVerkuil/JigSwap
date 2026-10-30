import { handleCspReport } from "@/lib/csp-report";
import { createFileRoute } from "@tanstack/react-router";

// Where browsers send Content-Security-Policy violation reports (report-uri and the
// Reporting-Endpoints "csp" group). POST only; lib/csp-report.ts caps the body and logs the
// directive, blocked origin and page path of each violation, nothing else.
export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      POST: ({ request }) => handleCspReport(request),
    },
  },
});
