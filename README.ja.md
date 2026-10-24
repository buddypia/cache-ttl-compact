# cache-ttl-compact

[English](README.md) | **日本語** | [한국어](README.ko.md)

プロンプトキャッシュが切れるまでの残り時間をステータス行に表示し、キャッシュが生きているうちに自動で `/compact` を実行する Claude Code プラグインです。

![プロンプトの下のカウントダウン](docs/countdown.png)

![キャッシュ満了前の compact](docs/compact.png)

## なぜ必要か

Claude Code は API リクエストのたびに会話をキャッシュします。キャッシュは最後のリクエストから一定時間（TTL）だけ有効です。長いセッションを TTL を超えて放置すると、次のメッセージでコンテキスト全体をキャッシュに書き直すことになり、時間もトークンもかかります。

このプラグインは最後のリクエストからカウントダウンし、満了の直前にセッションがアイドルなら、キャッシュが温かいうちに会話を compact します。戻ってきたときは、冷えた巨大なコンテキストではなく、小さな要約から再開できます。

Claude Code 2.1.299 以降は、この一部を自分で行います。idle compaction は 200K tokens 以上の会話が約 54 分アイドルのままだと、1h キャッシュが切れる前に compact します。プラグインはそうした会話を idle compaction に任せ、idle compaction が扱わない場合だけ compact します：

- idle compaction の最小値（200K tokens、または `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`）未満で `minContextTokens` 以上の context
- 5m TTL
- `"idleCompaction": false`、または 2.1.299 より前の Claude Code

ターミナルには独自のカウントダウンがないため、カウントダウンはどの場合も表示します。

## 動作

TTL `1h`、既定の margin（180 秒）の場合：

| 最後のリクエストからの経過 | ステータス表示 | 動作 |
| --- | --- | --- |
| 1 秒 | `cache 59:59` | 1 秒ごとに更新 |
| 57 分 | `cache 3:00` | アイドル中で context が 30k tokens 以上、かつ idle compaction が扱わないなら compact し、トーストで通知 |
| compact 後 | （消える） | 次のメッセージまで何もしない |
| 60 分（compact しなかった場合） | `cache expired` | 次のメッセージまで表示 |

- メイン会話のリクエストのたびに（ターン内のツール実行ステップも含めて）カウントダウンをやり直します。サブエージェントのリクエストは数えません。
- ターンの実行中は compact しません。長いターンが margin 内で終わったら、その時点で compact します。
- 試行はキャッシュ期間ごとに 1 回です。見送り・失敗はログに残し、毎秒やり直すことはありません。
- どの compact（`/compact`、自動 compact、idle compaction、他のプラグイン）の後も、次のリクエストまでカウントダウンを消します。
- compact では、作業中のタスク、変更したファイル、設計判断とその理由、未解決の項目を残し、要約は会話の言語で書かれます。`instructions` オプションで置き換えられます。

表示はプロンプトの下、Claude Code 自身の通知と並んで `⚠ cache-ttl-compact: cache 59:37` のように出ます。既存の `statusLine` コマンドは置き換えません。

## インストール

Claude Code のターミナルセッションのプロンプトで：

```
/plugin install cache-ttl-compact --marketplace buddypia/cache-ttl-compact
```

マーケットプレイスの追加に `y` で答え、スコープを選びます（user スコープならすべてのセッションで読み込まれます）。

シェルから：

```sh
claude plugin install cache-ttl-compact --marketplace buddypia/cache-ttl-compact
```

`/plugin` が使えないデスクトップアプリでは、プロンプト欄の横の **+** → **Plugins** → **Add marketplace** で `buddypia/cache-ttl-compact` を追加し、**Add plugin** を選びます。

ローカルに clone して使う場合は `claude --plugin-dir <clone のパス>` で起動するか、`~/.claude/settings.json` の `env` ブロックの `CLAUDE_CODE_PLUGIN_DIRS` にパスを追加します。

## 設定

`/config`、または `~/.claude/settings.json` の `pluginConfigs` で変更できます：

```json
{
  "pluginConfigs": {
    "cache-ttl-compact": {
      "options": { "ttl": "auto", "marginSeconds": 0, "minContextTokens": 30000, "instructions": "" }
    }
  }
}
```

| 項目 | 既定値 | 意味 |
| --- | --- | --- |
| `ttl` | `auto` | プロンプトキャッシュの TTL：`auto`、`1h`、`5m`。`auto` は `FORCE_PROMPT_CACHING_5M` が設定されていれば `5m`、なければ `1h` |
| `marginSeconds` | `0` | 満了の何秒前に compact するか。`0` は TTL ごとの既定値（`1h` は 180、`5m` は 60） |
| `minContextTokens` | `30000` | これ未満の context は compact しない（小さい context は再キャッシュが安いため） |
| `instructions` | （空） | compact の要約に残す内容。空なら上の既定の指示 |

スクリーンショットは `ttl: 5m`、`marginSeconds: 280` で撮影したもので、リクエストの 20 秒後に compact が発火しています。

## 制限

- プラグインからはキャッシュの TTL を読めないため、`ttl` の設定値で数えます。`auto` が見るのは `FORCE_PROMPT_CACHING_5M` だけです。別の理由で TTL が 5 分のとき（`ENABLE_PROMPT_CACHING_1H` のない API キー、使用量の超過など）は `ttl` を `5m` にしてください。
- idle compaction が扱う範囲は Claude Code の changelog（2.1.299）に基づきます。以降のリリースで変わると、idle compaction と重ねて compact したり、扱われない会話を残したりすることがあります。
- カウントダウンは各リクエストの送信時刻からの推定で、サーバー側のキャッシュそのものは見えません。

## 開発

```sh
claude plugin validate .
claude plugin test .
```

hooks モジュールは [`hooks/register.ts`](hooks/register.ts)、テストは [`hooks/register.test.ts`](hooks/register.test.ts) にあります。

## ライセンス

[MIT](LICENSE)
