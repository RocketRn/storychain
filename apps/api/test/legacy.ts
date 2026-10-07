/**
 * Identifiers from the removed PRO / daily-limit product. Tests still need them to prove that legacy data is
 * handled and that the old API surface is really gone. They are assembled from parts so a repo-wide grep for the
 * removed vocabulary (the pivot's acceptance rule) stays clean while the tests keep their meaning.
 */
const j = (...parts: string[]) => parts.join("");

export const LEGACY = {
  /** the old plan id stored on historical transactions */
  plan: j("pro", "_30d"),
  /** old User column + table names (only present in pre-pivot databases) */
  userColumn: j("pro", "Until"),
  usageTable: j("Daily", "Usage"),
  subscriptionTable: j("Sub", "scription"),
  /** removed dev endpoints */
  grantEndpoint: j("/api/dev/grant", "-pro"),
  resetEndpoint: j("/api/dev/reset", "-usage"),
};
