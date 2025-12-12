#!/usr/bin/env tsx
/**
 * PR review collector for AI-based PR review in GitHub Actions.
 * Collects PR metadata, diff, reviews, and comments for AI review.
 */

import { execFileSync, execSync, type ExecSyncOptions } from "child_process";
import { writeFileSync } from "fs";

// Types - exported for testing
export interface PRMetadata {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  author: { login: string };
  createdAt?: string;
  updatedAt?: string;
  state?: string;
}

export interface Review {
  state: string;
  user?: { login: string };
  author?: { login: string };
  submitted_at?: string;
  submittedAt?: string;
  body?: string;
}

export interface ReviewComment {
  id: number;
  path?: string;
  line?: number;
  original_line?: number;
  position?: number;
  side?: string;
  html_url?: string;
  user?: { login: string };
  created_at?: string;
  diff_hunk?: string;
  body?: string;
  in_reply_to_id?: number;
}

export interface IssueComment {
  user?: { login: string };
  created_at?: string;
  html_url?: string;
  body?: string;
}

// Utilities
function runCmd(
  cmd: string[],
  options: { timeout?: number; check?: boolean } = {}
): string {
  const { timeout = 30000, check = true } = options;
  const [command, ...args] = cmd;
  const execOptions: ExecSyncOptions = {
    encoding: "utf8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 100 * 1024 * 1024, // 100MB for large monorepo diffs
  };

  try {
    return execFileSync(command, args, execOptions) as string;
  } catch (error) {
    if (check) throw error;
    return "";
  }
}

function ghJson<T>(args: string[]): T {
  const output = runCmd(["gh", ...args], { timeout: 30000 });
  return JSON.parse(output) as T;
}

function ghPaginatedArray<T>(path: string): T[] {
  const output = runCmd(
    ["gh", "api", "--paginate", path, "--jq", ".[] | @json"],
    { timeout: 60000, check: false }
  );

  const items: T[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      items.push(JSON.parse(trimmed) as T);
    } catch {
      try {
        items.push(JSON.parse(JSON.parse(trimmed)) as T);
      } catch {
        // Skip unparseable lines
      }
    }
  }
  return items;
}

function getPRMetadata(prNumber: number): PRMetadata {
  const result = ghJson<PRMetadata>([
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,title,url,headRefName,baseRefName,author,createdAt,updatedAt,state",
  ]);
  if (!result) {
    throw new Error(`Could not fetch metadata for PR #${prNumber}`);
  }
  return result;
}

function refExistsOnOrigin(refName: string): boolean {
  try {
    runCmd(
      ["git", "ls-remote", "--exit-code", "--heads", "origin", refName],
      { timeout: 30000 }
    );
    return true;
  } catch {
    return false;
  }
}

function ensureRemoteRefsForPR(
  prNumber: number,
  baseRef: string,
  headRef: string
): [string, string] {
  runCmd(["git", "fetch", "--quiet", "origin"], { timeout: 60000 });
  const baseSpec = `origin/${baseRef}`;

  let headSpec: string;
  if (refExistsOnOrigin(headRef)) {
    headSpec = `origin/${headRef}`;
  } else {
    // Handle fork PRs
    const prRemoteRef = `refs/remotes/origin/pr/${prNumber}`;
    runCmd(
      [
        "git",
        "fetch",
        "--quiet",
        "origin",
        `pull/${prNumber}/head:${prRemoteRef}`,
      ],
      { timeout: 60000 }
    );
    headSpec = prRemoteRef;
  }

  return [baseSpec, headSpec];
}

function getPRDiffComplete(
  prNumber: number,
  baseRef: string,
  headRef: string
): string {
  const [baseSpec, headSpec] = ensureRemoteRefsForPR(prNumber, baseRef, headRef);

  const changed = runCmd(
    ["git", "--no-pager", "diff", "--name-only", `${baseSpec}...${headSpec}`, "--"],
    { timeout: 60000, check: false }
  );

  const paths = changed
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0) return "";

  // Filter out lockfiles
  const lockSuffixes = [
    "Cargo.lock",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ];
  const filtered = paths.filter(
    (p) => !lockSuffixes.some((suffix) => p.endsWith(suffix))
  );
  if (filtered.length === 0) return "";

  // Get diff in chunks to avoid argv length limits
  const diffChunks: string[] = [];
  const chunkSize = 200;

  for (let i = 0; i < filtered.length; i += chunkSize) {
    const chunk = filtered.slice(i, i + chunkSize);
    const out = runCmd(
      [
        "git",
        "--no-pager",
        "diff",
        "--no-color",
        `${baseSpec}...${headSpec}`,
        "--",
        ...chunk,
      ],
      { timeout: 120000, check: false }
    );
    diffChunks.push(out);
  }

  const fullDiff = diffChunks.join("\n");

  const MAX_DIFF_LINES = 10000;
  const diffLines = fullDiff.split("\n");
  if (diffLines.length > MAX_DIFF_LINES) {
    console.warn(
      `[prepare-pr-review] WARNING: Diff too large (${diffLines.length} lines), truncating to ${MAX_DIFF_LINES} lines`
    );
    return (
      `# WARNING: Diff truncated from ${diffLines.length} to ${MAX_DIFF_LINES} lines\n\n` +
      diffLines.slice(0, MAX_DIFF_LINES).join("\n")
    );
  }

  return fullDiff;
}

function getReviews(owner: string, repo: string, prNumber: number): Review[] {
  return ghPaginatedArray<Review>(
    `repos/${owner}/${repo}/pulls/${prNumber}/reviews`
  );
}

function getReviewComments(
  owner: string,
  repo: string,
  prNumber: number
): ReviewComment[] {
  return ghPaginatedArray<ReviewComment>(
    `repos/${owner}/${repo}/pulls/${prNumber}/comments`
  );
}

function getIssueComments(
  owner: string,
  repo: string,
  prNumber: number
): IssueComment[] {
  return ghPaginatedArray<IssueComment>(
    `repos/${owner}/${repo}/issues/${prNumber}/comments`
  );
}

export function summarizeApprovals(reviews: Review[]): [number, string[]] {
  const approvers: string[] = [];
  for (const r of reviews) {
    if (r.state === "APPROVED") {
      const user = r.user || r.author;
      const login = user?.login;
      if (login && !approvers.includes(login)) {
        approvers.push(login);
      }
    }
  }
  return [approvers.length, approvers];
}

export type Thread = [ReviewComment, ReviewComment[]];

export function groupReviewCommentsByThread(
  reviewComments: ReviewComment[]
): Thread[] {
  const rootComments: ReviewComment[] = [];
  const repliesMap = new Map<number, ReviewComment[]>();

  for (const c of reviewComments) {
    const parentId = c.in_reply_to_id;
    if (parentId === undefined || parentId === null) {
      rootComments.push(c);
    } else {
      if (!repliesMap.has(parentId)) {
        repliesMap.set(parentId, []);
      }
      repliesMap.get(parentId)!.push(c);
    }
  }

  rootComments.sort((a, b) => {
    const pathA = a.path || "";
    const pathB = b.path || "";
    if (pathA !== pathB) return pathA.localeCompare(pathB);

    const posA = a.original_line || a.position || 0;
    const posB = b.original_line || b.position || 0;
    if (posA !== posB) return posA - posB;

    const createdA = a.created_at || "";
    const createdB = b.created_at || "";
    return createdA.localeCompare(createdB);
  });

  const threads: Thread[] = [];
  for (const root of rootComments) {
    const rootId = root.id;
    const replies = repliesMap.get(rootId) || [];
    replies.sort((a, b) =>
      (a.created_at || "").localeCompare(b.created_at || "")
    );
    threads.push([root, replies]);
  }

  return threads;
}

export function fenced(code: string, lang = ""): string {
  const trimmed = code.trimEnd();
  return trimmed ? `\`\`\`${lang}\n${trimmed}\n\`\`\`\n` : "(no output)\n";
}

export function truncate(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "\n... (truncated)";
}

export function buildMarkdownReport(
  prNumber: number,
  meta: PRMetadata,
  diffText: string,
  reviews: Review[],
  reviewComments: ReviewComment[],
  issueComments: IssueComment[]
): string {
  const title = meta.title || `PR #${prNumber}`;
  const url = meta.url || "";
  const head = meta.headRefName || "";
  const base = meta.baseRefName || "";
  const [approvalsCount, approvers] = summarizeApprovals(reviews);

  const reviewLines: string[] = [];
  for (const r of reviews) {
    const user = (r.user || r.author)?.login || "unknown";
    const state = r.state;
    const submitted = r.submitted_at || r.submittedAt || "";
    const body = truncate(r.body || "", 500);
    reviewLines.push(`- ${state} by ${user} at ${submitted}\n\n${fenced(body)}`);
  }

  const reviewCommentsLines: string[] = [];
  const threads = groupReviewCommentsByThread(reviewComments);

  for (const [root, replies] of threads.slice(0, 200)) {
    const path = root.path || "";
    const line = root.line || root.original_line || root.position || "?";
    const side = root.side || "";
    const link = root.html_url || "";
    const user = root.user?.login || "unknown";
    const created = root.created_at || "";
    const diffHunk = root.diff_hunk || "";
    const body = truncate(root.body || "", 1000);

    const sideStr = side ? `[${side}]` : "";
    const header = `- ${path}:${line} ${sideStr} ${link}`.trimEnd();
    reviewCommentsLines.push(header);

    if (diffHunk) {
      reviewCommentsLines.push(fenced(diffHunk, "diff"));
    }
    reviewCommentsLines.push(`  by ${user} at ${created}\n\n${fenced(body)}`);

    for (const rep of replies) {
      const rUser = rep.user?.login || "unknown";
      const rCreated = rep.created_at || "";
      const rBody = truncate(rep.body || "", 800);
      reviewCommentsLines.push(
        `  - reply by ${rUser} at ${rCreated}\n\n${fenced(rBody)}`
      );
    }
  }

  const issueCommentsLines: string[] = [];
  for (const c of issueComments.slice(0, 200)) {
    const user = c.user?.login || "unknown";
    const created = c.created_at || "";
    const link = c.html_url || "";
    const body = truncate(c.body || "", 500);
    const header = `- by ${user} at ${created} ${link}`.trimEnd();
    issueCommentsLines.push(`${header}\n\n${fenced(body)}`);
  }

  const md: string[] = [];
  md.push(`### PR #${prNumber}: ${title}`);
  if (url) md.push(`- **URL**: ${url}`);
  if (head || base) md.push(`- **Branches**: ${head || "?"} -> ${base || "?"}`);
  md.push(
    `- **Approvals**: ${approvalsCount} (${approvers.length > 0 ? approvers.join(", ") : "none"})`
  );
  md.push(
    `\n**Note**: To view full file contents, use \`git show origin/${head || "?"} -- <file-path>\``
  );

  if (diffText.trim()) {
    md.push("\n### Diff (excluding lockfiles)");
    md.push(fenced(diffText, "diff"));
  }

  md.push("\n### Reviews");
  md.push(reviewLines.length > 0 ? reviewLines.join("\n") : "(no reviews)\n");

  md.push("\n### Review Comments (code)");
  md.push(
    reviewCommentsLines.length > 0
      ? reviewCommentsLines.join("\n")
      : "(no review comments)\n"
  );

  md.push("\n### Issue Comments (discussion)");
  md.push(
    issueCommentsLines.length > 0
      ? issueCommentsLines.join("\n")
      : "(no issue comments)\n"
  );

  return md.join("\n").trimEnd() + "\n";
}

function main(): void {
  try {
    execSync("gh --version", { stdio: "ignore" });
  } catch {
    console.error("ERROR: gh CLI not found. Install from https://cli.github.com/");
    process.exit(1);
  }

  const args = process.argv.slice(2);

  let prNumber: number | undefined;
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--output") {
      outputPath = args[++i];
    } else if (!arg.startsWith("-") && !prNumber) {
      prNumber = parseInt(arg, 10);
    }
  }

  if (!prNumber || isNaN(prNumber)) {
    console.error("Usage: prepare-pr-review.ts <pr_number> -o <output_file>");
    process.exit(1);
  }

  if (!outputPath) {
    console.error("ERROR: --output / -o is required");
    process.exit(1);
  }

  const envRepo = process.env.GITHUB_REPOSITORY;
  if (!envRepo || !envRepo.includes("/")) {
    console.error("ERROR: GITHUB_REPOSITORY environment variable not set");
    process.exit(1);
  }
  const [owner, repo] = envRepo.split("/", 2);

  const log = (msg: string) => console.log(`[prepare-pr-review] ${msg}`);

  log(`Fetching PR #${prNumber} metadata from ${owner}/${repo}...`);
  const meta = getPRMetadata(prNumber);
  log(`  Title: "${meta.title}"`);
  log(`  Branches: ${meta.headRefName} -> ${meta.baseRefName}`);

  const baseRef = meta.baseRefName || "main";
  const headRef = meta.headRefName || baseRef;
  log(`Fetching diff (${baseRef}...${headRef})...`);
  const diffText = getPRDiffComplete(prNumber, baseRef, headRef);
  const diffLines = diffText.split("\n").length;
  log(`  Diff: ${diffLines} lines`);

  log("Fetching reviews...");
  const reviews = getReviews(owner, repo, prNumber);
  log(`  Reviews: ${reviews.length}`);

  log("Fetching review comments...");
  const reviewComments = getReviewComments(owner, repo, prNumber);
  log(`  Review comments: ${reviewComments.length}`);

  log("Fetching issue comments...");
  const issueComments = getIssueComments(owner, repo, prNumber);
  log(`  Issue comments: ${issueComments.length}`);

  log("Building markdown report...");
  const report = buildMarkdownReport(
    prNumber,
    meta,
    diffText,
    reviews,
    reviewComments,
    issueComments
  );

  if (outputPath === "-") {
    console.log(report);
  } else {
    writeFileSync(outputPath, report, "utf8");
    const reportLines = report.split("\n").length;
    log(`Report written to ${outputPath} (${reportLines} lines)`);
  }
}

const isMainModule = process.argv[1]?.endsWith("prepare-pr-review.ts");
if (isMainModule) {
  main();
}
