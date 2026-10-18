// Whether `/` should send the visitor on to /dashboard. Only a signed-in visitor
// *entering* the site at / (typed URL, bookmark, external link: a document load,
// which TanStack Start renders on the server) is redirected. Client-side
// navigation to / (the marketing logo, the user menu's "JigSwap homepage" item)
// still shows the landing page, and a signed-out visitor always sees it.
export function shouldRedirectHomeToDashboard({
  userId,
  isDocumentLoad,
}: {
  userId: string | null | undefined;
  isDocumentLoad: boolean;
}): boolean {
  return Boolean(userId) && isDocumentLoad;
}
