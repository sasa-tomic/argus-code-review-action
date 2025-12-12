# AI PR Review Action

AI-powered PR review using [Cursor](https://cursor.com) agent. Posts review feedback as a single PR comment.

## Quick Start

Create `.github/workflows/ai-pr-review.yml`:

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

      - uses: sasa-tomic/argus-code-review@v1
        with:
          cursor-api-key: ${{ secrets.CURSOR_API_KEY }}
```

## Inputs

| Input            | Required | Default               | Description                                                  |
| ---------------- | -------- | --------------------- | ------------------------------------------------------------ |
| `cursor-api-key` | Yes      | ?                     | [Get API key](https://cursor.com/dashboard?tab=integrations) |
| `github-token`   | No       | `github.token`        | GitHub token for API access                                  |
| `model`          | No       | `sonnet-4.5-thinking` | Cursor model                                                 |
| `prompt-file`    | No       | ?                     | Custom prompt file (see [default](prompts/default.md))       |

## Outputs

| Output     | Values                                                          |
| ---------- | --------------------------------------------------------------- |
| `decision` | `true` (approve), `false` (request changes), `unknown`, `error` |

## Custom Prompt

```yaml
- uses: sasa-tomic/argus-code-review@v1
  with:
    cursor-api-key: ${{ secrets.CURSOR_API_KEY }}
    prompt-file: .github/prompts/review.md
```

PR data is appended automatically. See [default prompt](prompts/default.md) for structure.

## Skipping Review

Add the `skip-ai-review` label to a PR to skip the AI review. Customize the label name with the `skip-label` input.

## Requirements

- [Cursor API key](https://cursor.com/dashboard?tab=integrations) (requires Cursor subscription)

## License

Apache-2.0
