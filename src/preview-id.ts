let sequence = 0;

// Session-local sample IDs, not credentials, agent identities, or permissions.
// A disjoint prefix avoids seed-data collisions without requiring a secure context.
export function createPreviewId(): string {
  sequence += 1;
  return `local-preview-${sequence}`;
}
