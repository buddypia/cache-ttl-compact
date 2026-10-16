# cache-ttl-compact

**English** | [日本語](README.ja.md) | [한국어](README.ko.md)

A Claude Code plugin that shows how long your prompt cache has left in the status line, and runs `/compact` on its own while the cache is still warm.

![Countdown under the prompt](docs/countdown.png)

![Compacting before the cache expires](docs/compact.png)

## Why

Claude Code caches the conversation on every API request. The cache lives for a fixed time (the TTL) after the last request. Leave a long session idle past the TTL, and the next message has to write the whole context into the cache again, which costs time and tokens.

This plugin counts down from your last request. Just before the cache expires, if the session is idle, it compacts the conversation while the cache is still warm. When you come back, you start from a small summary instead of a cold, full-size context.

## What it does

With the defaults (TTL `1h`, margin `180` seconds):

| Time since the last request | Status line | Action |
| --- | --- | --- |
| 1 s | `cache 59:59` | Updates every second |
| 57 min | `cache 3:00` | Compacts if the session is idle and the context is at least 30k tokens, and shows a toast |
| After compacting | (cleared) | Nothing more until your next message |
| 60 min, if it did not compact | `cache expired` | Stays until your next message |

- The countdown starts over on every request from the main conversation, including each tool-use step inside a turn. Subagent requests are ignored.
- It never compacts while a turn is running. If a long turn ends inside the margin, it compacts right then.
- It tries once per cache period. A skipped or failed compaction is logged and not retried every second.
- Any compaction (`/compact`, auto-compact, another plugin) clears the countdown until the next request.
- The compaction keeps the task in progress, changed files, design decisions with their reasons, and open items, and writes the summary in the language of the conversation.

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
      "options": { "ttl": "1h", "marginSeconds": 180, "minContextTokens": 30000 }
    }
  }
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `ttl` | `1h` | Prompt-cache TTL: `1h` or `5m` |
| `marginSeconds` | `180` | How many seconds before expiry to compact |
| `minContextTokens` | `30000` | Skip compaction below this context size, since re-caching a small context is cheap |

The screenshots were taken with `ttl: 5m` and `marginSeconds: 280`, so compaction fires 20 seconds after the request.

## Limitations

- A plugin cannot read the cache TTL, so the countdown uses the `ttl` option. If your TTL drops to 5 minutes (for example, when usage goes into overage), switch `ttl` to `5m`; with `5m`, a `marginSeconds` around `60` works better than the default.
- The countdown is an estimate from the time each request was sent. It cannot see the server-side cache itself.

## Development

```sh
claude plugin validate .
claude plugin test .
```

The hooks module is [`hooks/register.ts`](hooks/register.ts); the tests are in [`hooks/register.test.ts`](hooks/register.test.ts).

## License

[MIT](LICENSE)
