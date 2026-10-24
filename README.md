# cache-ttl-compact

**English** | [日本語](README.ja.md) | [한국어](README.ko.md)

A Claude Code plugin that shows how long your prompt cache has left in the status line, and runs `/compact` on its own while the cache is still warm.

![Countdown under the prompt](docs/countdown.png)

![Compacting before the cache expires](docs/compact.png)

## Why

Claude Code caches the conversation on every API request. The cache lives for a fixed time (the TTL) after the last request. Leave a long session idle past the TTL, and the next message has to write the whole context into the cache again, which costs time and tokens.

This plugin counts down from your last request. Just before the cache expires, if the session is idle, it compacts the conversation while the cache is still warm. When you come back, you start from a small summary instead of a cold, full-size context.

Claude Code 2.1.299 and later does part of this on its own: its idle compaction compacts a conversation of 200K tokens or more, idle for about 54 minutes, before its 1h cache expires. The plugin leaves those conversations to it and compacts only what idle compaction does not cover:

- contexts below idle compaction's minimum (200K tokens, or `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`) and above `minContextTokens`
- the 5m TTL
- `"idleCompaction": false`, or Claude Code before 2.1.299

The terminal has no countdown of its own, so the plugin shows it in every case.

## What it does

With a 1h TTL and the default margin (180 seconds):

| Time since the last request | Status line | Action |
| --- | --- | --- |
| 1 s | `cache 59:59` | Updates every second |
| 57 min | `cache 3:00` | Compacts if the session is idle, the context is at least 30k tokens and idle compaction does not cover it, and shows a toast |
| After compacting | (cleared) | Nothing more until your next message |
| 60 min, if it did not compact | `cache expired` | Stays until your next message |

- The countdown starts over on every request from the main conversation, including each tool-use step inside a turn. Subagent requests are ignored.
- It never compacts while a turn is running. If a long turn ends inside the margin, it compacts right then.
- It tries once per cache period. A skipped or failed compaction is logged and not retried every second.
- Any compaction (`/compact`, auto-compact, idle compaction, another plugin) clears the countdown until the next request.
- The compaction keeps the task in progress, changed files, design decisions with their reasons, and open items, and writes the summary in the language of the conversation. The `instructions` option replaces this.

The line appears under the prompt, beside Claude Code's own notices, as `⚠ cache-ttl-compact: cache 59:37`. It does not replace your `statusLine` command.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cache-ttl-compact --marketplace buddypia/cache-ttl-compact
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```sh
claude plugin install cache-ttl-compact --marketplace buddypia/cache-ttl-compact
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `buddypia/cache-ttl-compact`, then **Add plugin**.

To run it from a local clone instead, start Claude Code with `claude --plugin-dir <path to clone>`, or add the path to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

## Options

Change them in `/config`, or under `pluginConfigs` in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "cache-ttl-compact": {
      "options": { "ttl": "auto", "marginSeconds": 0, "minContextTokens": 30000, "instructions": "" }
    }
  }
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `ttl` | `auto` | Prompt-cache TTL: `auto`, `1h` or `5m`. `auto` is `5m` when `FORCE_PROMPT_CACHING_5M` is set, else `1h` |
| `marginSeconds` | `0` | How many seconds before expiry to compact; `0` uses the TTL's own margin (180 for `1h`, 60 for `5m`) |
| `minContextTokens` | `30000` | Skip compaction below this context size, since re-caching a small context is cheap |
| `instructions` | (empty) | What the compaction summary keeps; empty uses the built-in instructions above |

The screenshots were taken with `ttl: 5m` and `marginSeconds: 280`, so compaction fires 20 seconds after the request.

## Limitations

- A plugin cannot read the cache TTL, so the countdown uses the `ttl` option. `auto` sees only `FORCE_PROMPT_CACHING_5M`: if your TTL is 5 minutes for another reason (an API key without `ENABLE_PROMPT_CACHING_1H`, or usage in overage), set `ttl` to `5m`.
- Which conversations idle compaction covers comes from Claude Code's changelog (2.1.299). If a later release changes it, the plugin may compact a conversation idle compaction would also have taken, or leave one it does not.
- The countdown is an estimate from the time each request was sent. It cannot see the server-side cache itself.

## Development

```sh
claude plugin validate .
claude plugin test .
```

The hooks module is [`hooks/register.ts`](hooks/register.ts); the tests are in [`hooks/register.test.ts`](hooks/register.test.ts).

## License

[MIT](LICENSE)
