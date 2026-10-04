// Reads JSON the other workstreams write outside web/ (verification verdicts, deployments, reports). Server only.
// Every reader returns null when a file is absent or unparseable: absence means "not yet", never an error. The
// paths are listed in next.config.ts (outputFileTracingIncludes) so they ship with the server functions.
import "server-only";
import type fsType from "node:fs";
import type pathType from "node:path";

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = (): typeof fsType => require(/* webpackIgnore: true */ "fs");
const path = (): typeof pathType => require(/* webpackIgnore: true */ "path");
/* eslint-enable @typescript-eslint/no-require-imports */

/** The repository root: web/ is where `next build` and `next dev` run. BONDLINE_REPO_ROOT points a test run at a fixture tree. */
const root = () => process.env.BONDLINE_REPO_ROOT || path().join(process.cwd(), "..");

/** Text at a path relative to the repo root (e.g. "contracts/reports/tests.txt"), or null. */
export function readRepoText(relative: string): string | null {
  try {
    return fs().readFileSync(path().join(root(), relative), "utf8");
  } catch {
    return null;
  }
}

/** Parsed JSON at a path relative to the repo root (e.g. "deployments/party.json"), or null. */
export function readRepoJson<T = unknown>(relative: string): T | null {
  try {
    return JSON.parse(fs().readFileSync(path().join(root(), relative), "utf8")) as T;
  } catch {
    return null;
  }
}

/** Parsed JSON files in a repo directory (e.g. "deployments/letters"), or [] when it doesn't exist. */
export function readRepoJsonDir<T = unknown>(relative: string): { name: string; data: T }[] {
  try {
    const dir = path().join(root(), relative);
    return fs()
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((name) => {
        try {
          return [{ name, data: JSON.parse(fs().readFileSync(path().join(dir, name), "utf8")) as T }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
