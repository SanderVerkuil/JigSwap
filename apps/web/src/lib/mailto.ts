/**
 * A mailto: link to one address that someone else typed. The local part and the domain are
 * percent-encoded separately around the last "@", so "?", "&", "=", "#" or "%" in the address
 * stay part of the recipient instead of adding header fields (cc, bcc, subject, body) or a
 * fragment to the draft. Mail clients percent-decode the address, so an ordinary one reads as is.
 */
export const mailtoHref = (address: string): string => {
  const at = address.lastIndexOf("@");
  if (at === -1) return `mailto:${encodeURIComponent(address)}`;
  const local = encodeURIComponent(address.slice(0, at));
  const domain = encodeURIComponent(address.slice(at + 1));
  return `mailto:${local}@${domain}`;
};
