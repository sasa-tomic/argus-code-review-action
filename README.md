# AI PR Review Action

AI-powered pull request review using [Cursor](https://cursor.com) agent. Automatically reviews PRs and posts feedback as comments.

## Usage

Add this workflow to your repository at `.github/workflows/ai-pr-review.yml`:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  ai-review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: sasa-tomic/ai-pr-review-action@v1
        with:
          cursor-api-key: ${{ secrets.CURSOR_API_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `cursor-api-key` | Yes | - | Cursor API key ([get one here](https://cursor.com/dashboard?tab=integrations)) |
| `github-token` | No | `${{ github.token }}` | GitHub token for API access |
| `model` | No | `sonnet-4.5-thinking` | Cursor model to use |
| `prompt-file` | No | - | Path to custom prompt file (uses built-in default if not provided) |
| `skip-label` | No | `skip-ai-review` | Label name that skips AI review when present |

## Outputs

| Output | Description |
|--------|-------------|
| `decision` | AI review decision: `true` (approve), `false` (request changes), `unknown`, or `error` |

## Custom Prompt

To customize the review prompt, create a markdown file in your repo and reference it:

```yaml
- uses: sasa-tomic/ai-pr-review-action@v1
  with:
    cursor-api-key: ${{ secrets.CURSOR_API_KEY }}
    prompt-file: .github/prompts/my-review-prompt.md
```

The prompt should end with a section for the PR data (which gets appended automatically).

## Skipping Review

Add the `skip-ai-review` label to a PR to skip the AI review. Customize the label name with the `skip-label` input.

## Requirements

- Cursor API key (requires Cursor subscription)
- Repository must grant `pull-requests: write` permission

## License

MIT
