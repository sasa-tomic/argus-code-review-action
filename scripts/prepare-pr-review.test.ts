import { describe, it } from "node:test";
import assert from "node:assert";
import {
  fenced,
  truncate,
  summarizeApprovals,
  groupReviewCommentsByThread,
  buildMarkdownReport,
  type Review,
  type ReviewComment,
  type PRMetadata,
  type IssueComment,
} from "./prepare-pr-review.ts";

const baseMeta: PRMetadata = {
  number: 123,
  title: "Test PR",
  url: "https://github.com/org/repo/pull/123",
  headRefName: "feature-branch",
  baseRefName: "main",
  author: { login: "author" },
};

function emptyReport(): string {
  return buildMarkdownReport(123, baseMeta, "", [], [], []);
}

void describe("prepare-pr-review", async () => {
  await describe("fenced", async () => {
    await it("wraps code with language tag", () => {
      assert.strictEqual(
        fenced("const x = 1;", "ts"),
        "```ts\nconst x = 1;\n```\n"
      );
      assert.strictEqual(fenced("hello"), "```\nhello\n```\n");
    });

    await it("returns (no output) for empty/whitespace content", () => {
      assert.strictEqual(fenced(""), "(no output)\n");
      assert.strictEqual(fenced("   \n\t  "), "(no output)\n");
    });

    await it("trims trailing whitespace", () => {
      assert.strictEqual(fenced("code   \n\n"), "```\ncode\n```\n");
    });
  });

  await describe("truncate", async () => {
    await it("returns unchanged if under limit, truncates if over", () => {
      assert.strictEqual(truncate("short", 100), "short");
      assert.strictEqual(truncate("toolong", 4), "tool\n... (truncated)");
    });

    await it("handles boundary conditions", () => {
      assert.strictEqual(truncate("12345", 5), "12345");
      assert.strictEqual(truncate("123456", 5), "12345\n... (truncated)");
    });

    await it("trims whitespace before length check", () => {
      assert.strictEqual(truncate("  text  ", 100), "text");
      assert.strictEqual(truncate("", 10), "");
    });
  });

  await describe("summarizeApprovals", async () => {
    await it("counts approvals and deduplicates users", () => {
      const reviews: Review[] = [
        { state: "APPROVED", user: { login: "alice" } },
        { state: "APPROVED", user: { login: "alice" } },
        { state: "APPROVED", user: { login: "bob" } },
        { state: "CHANGES_REQUESTED", user: { login: "charlie" } },
      ];
      const [count, approvers] = summarizeApprovals(reviews);
      assert.strictEqual(count, 2);
      assert.deepStrictEqual(approvers, ["alice", "bob"]);
    });

    await it("returns empty for no reviews or no approvals", () => {
      assert.deepStrictEqual(summarizeApprovals([]), [0, []]);
      assert.deepStrictEqual(
        summarizeApprovals([{ state: "COMMENTED", user: { login: "x" } }]),
        [0, []]
      );
    });

    await it("uses user field, falls back to author, skips if neither", () => {
      const reviews: Review[] = [
        { state: "APPROVED", user: { login: "user1" }, author: { login: "author1" } },
        { state: "APPROVED", author: { login: "author2" } },
        { state: "APPROVED" },
      ];
      const [count, approvers] = summarizeApprovals(reviews);
      assert.strictEqual(count, 2);
      assert.deepStrictEqual(approvers, ["user1", "author2"]);
    });
  });

  await describe("groupReviewCommentsByThread", async () => {
    await it("groups replies under root comments", () => {
      const comments: ReviewComment[] = [
        { id: 1, path: "file.ts", body: "root" },
        { id: 2, path: "file.ts", body: "reply1", in_reply_to_id: 1 },
        { id: 3, path: "file.ts", body: "reply2", in_reply_to_id: 1 },
        { id: 4, path: "other.ts", body: "standalone" },
      ];
      const threads = groupReviewCommentsByThread(comments);

      assert.strictEqual(threads.length, 2);
      assert.strictEqual(threads[0][0].id, 1);
      assert.strictEqual(threads[0][1].length, 2);
      assert.strictEqual(threads[1][0].id, 4);
      assert.strictEqual(threads[1][1].length, 0);
    });

    await it("sorts by path > line/position > created_at", () => {
      const comments: ReviewComment[] = [
        { id: 1, path: "z.ts", original_line: 1 },
        { id: 2, path: "a.ts", original_line: 10 },
        { id: 3, path: "a.ts", original_line: 5 },
        { id: 4, path: "a.ts", position: 3 },
      ];
      const threads = groupReviewCommentsByThread(comments);
      assert.deepStrictEqual(
        threads.map((t) => t[0].id),
        [4, 3, 2, 1]
      );
    });

    await it("sorts replies by created_at", () => {
      const comments: ReviewComment[] = [
        { id: 1, path: "f.ts" },
        { id: 3, in_reply_to_id: 1, created_at: "2024-01-02" },
        { id: 2, in_reply_to_id: 1, created_at: "2024-01-01" },
      ];
      const threads = groupReviewCommentsByThread(comments);
      assert.deepStrictEqual(
        threads[0][1].map((r) => r.id),
        [2, 3]
      );
    });

    await it("handles empty array and orphan replies", () => {
      assert.strictEqual(groupReviewCommentsByThread([]).length, 0);
      const orphan: ReviewComment[] = [{ id: 1, in_reply_to_id: 999, path: "x.ts" }];
      assert.strictEqual(groupReviewCommentsByThread(orphan).length, 0);
    });
  });

  await describe("buildMarkdownReport", async () => {
    await it("includes all metadata sections", () => {
      const report = emptyReport();
      assert.ok(report.includes("### PR #123: Test PR"));
      assert.ok(report.includes("**URL**: https://github.com/org/repo/pull/123"));
      assert.ok(report.includes("**Branches**: feature-branch -> main"));
      assert.ok(report.includes("**Approvals**: 0 (none)"));
      assert.ok(report.includes("git show origin/feature-branch"));
    });

    await it("shows empty-state placeholders", () => {
      const report = emptyReport();
      assert.ok(report.includes("(no reviews)"));
      assert.ok(report.includes("(no review comments)"));
      assert.ok(report.includes("(no issue comments)"));
      assert.ok(!report.includes("### Diff"));
    });

    await it("includes diff when provided", () => {
      const report = buildMarkdownReport(123, baseMeta, "+add\n-del", [], [], []);
      assert.ok(report.includes("### Diff (excluding lockfiles)"));
      assert.ok(report.includes("+add"));
      assert.ok(report.includes("-del"));
    });

    await it("formats reviews with state, user, and body", () => {
      const reviews: Review[] = [
        { state: "APPROVED", user: { login: "alice" }, body: "LGTM!" },
        { state: "CHANGES_REQUESTED", user: { login: "bob" }, body: "Fix bug" },
      ];
      const report = buildMarkdownReport(123, baseMeta, "", reviews, [], []);
      assert.ok(report.includes("**Approvals**: 1 (alice)"));
      assert.ok(report.includes("APPROVED by alice"));
      assert.ok(report.includes("CHANGES_REQUESTED by bob"));
      assert.ok(report.includes("LGTM!"));
    });

    await it("formats review comments with path, line, side, and diff_hunk", () => {
      const comments: ReviewComment[] = [
        {
          id: 1,
          path: "src/main.ts",
          line: 42,
          side: "RIGHT",
          user: { login: "reviewer" },
          body: "Consider refactoring",
          diff_hunk: "@@ -40,5 +40,6 @@\n+new code",
        },
      ];
      const report = buildMarkdownReport(123, baseMeta, "", [], comments, []);
      assert.ok(report.includes("src/main.ts:42"));
      assert.ok(report.includes("[RIGHT]"));
      assert.ok(report.includes("@@ -40,5 +40,6 @@"));
      assert.ok(report.includes("Consider refactoring"));
    });

    await it("includes threaded replies in review comments", () => {
      const comments: ReviewComment[] = [
        { id: 1, path: "f.ts", user: { login: "alice" }, body: "Question?" },
        { id: 2, path: "f.ts", in_reply_to_id: 1, user: { login: "bob" }, body: "Answer!" },
      ];
      const report = buildMarkdownReport(123, baseMeta, "", [], comments, []);
      assert.ok(report.includes("Question?"));
      assert.ok(report.includes("reply by bob"));
      assert.ok(report.includes("Answer!"));
    });

    await it("formats issue comments with user and body", () => {
      const comments: IssueComment[] = [
        { user: { login: "commenter" }, body: "Great work!", html_url: "https://x.com/1" },
      ];
      const report = buildMarkdownReport(123, baseMeta, "", [], [], comments);
      assert.ok(report.includes("commenter"));
      assert.ok(report.includes("Great work!"));
      assert.ok(report.includes("https://x.com/1"));
    });

    await it("truncates long bodies and limits counts", () => {
      const longReview: Review[] = [
        { state: "APPROVED", user: { login: "u" }, body: "x".repeat(600) },
      ];
      let report = buildMarkdownReport(123, baseMeta, "", longReview, [], []);
      assert.ok(report.includes("... (truncated)"));
      assert.ok(!report.includes("x".repeat(600)));

      const manyComments: ReviewComment[] = Array.from({ length: 250 }, (_, i) => ({
        id: i,
        path: `f${String(i).padStart(3, "0")}.ts`,
        body: `c${i}`,
      }));
      report = buildMarkdownReport(123, baseMeta, "", [], manyComments, []);
      assert.ok(report.includes("f199.ts"));
      assert.ok(!report.includes("f200.ts"));

      const manyIssue: IssueComment[] = Array.from({ length: 250 }, (_, i) => ({
        user: { login: `u${String(i).padStart(3, "0")}` },
        body: `b${i}`,
      }));
      report = buildMarkdownReport(123, baseMeta, "", [], [], manyIssue);
      assert.ok(report.includes("u199"));
      assert.ok(!report.includes("u200"));
    });

    await it("handles minimal/missing metadata gracefully", () => {
      const minimal: PRMetadata = {
        number: 1,
        title: "",
        url: "",
        headRefName: "",
        baseRefName: "",
        author: { login: "" },
      };
      const report = buildMarkdownReport(1, minimal, "", [], [], []);
      assert.ok(report.includes("### PR #1:"));
      assert.ok(!report.includes("**Branches**:"));
      assert.ok(!report.includes("**URL**:"));
    });
  });
});
