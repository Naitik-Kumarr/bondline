// The tour's two links that aren't on the chain or on this site. Set them here; nothing else needs to change.

/** The demo video, for step 6's "Watch the video". Until it's set, the button shows but isn't a link yet. */
export const VIDEO_URL: string | null = null;

/**
 * The public repository, e.g. "https://github.com/<owner>/<repo>" (no trailing slash). It turns on the SECURITY.md and
 * test-report links in step 6. Until it's set, "Read the code" opens the contracts' verified source on the explorer.
 */
export const REPO_URL: string | null = null;

/** The branch REPO_URL's file links point at. */
export const REPO_BRANCH = "main";

export const repoFile = (path: string) => (REPO_URL ? `${REPO_URL}/blob/${REPO_BRANCH}/${path}` : null);
