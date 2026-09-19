import { ROLE_IDS } from '../access-control.js';

/**
 * Presentation-only guard for the academic role walkthrough.
 *
 * This never grants a role, changes Firebase Authentication, changes a
 * membership, or persists a selection. It only allows an already verified
 * Firebase Super Administrator to open the local synthetic role preview.
 */
export function canPreviewDemoRoles(session) {
  return session?.mode === 'firebase' && session?.globalRole === ROLE_IDS.SUPER_ADMIN;
}

