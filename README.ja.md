# cache-ttl-compact

[English](README.md) | **日本語** | [한국어](README.ko.md)

プロンプトキャッシュが切れるまでの残り時間をステータス行に表示し、キャッシュが生きているうちに自動で `/compact` を実行する Claude Code プラグインです。

![プロンプトの下のカウントダウン](docs/countdown.png)

![キャッシュ満了前の compact](docs/compact.png)

## なぜ必要か

Claude Code は API リクエストのたびに会話をキャッシュします。キャッシュは最後のリクエストから一定時間（TTL）だけ有効です。長いセッションを TTL を超えて放置すると、次のメッセージでコンテキスト全体をキャッシュに書き直すことになり、時間もトークンもかかります。

このプラグインは最後のリクエストからカウントダウンし、満了の直前にセッションがアイドルなら、キャッシュが温かいうちに会話を compact します。戻ってきたときは、冷えた巨大なコンテキストではなく、小さな要約から再開できます。

## 動作

既定値（TTL `1h`、margin `180` 秒）の場合：

| 最後のリクエストからの経過 | ステータス表示 | 動作 |
| --- | --- | --- |
| 1 秒 | `cache 59:59` | 1 秒ごとに更新 |
| 57 分 | `cache 3:00` | アイドル中で context が 30k tokens 以上なら compact し、トーストで通知 |
| compact 後 | （消える） | 次のメッセージまで何もしない |
| 60 分（compact しなかった場合） | `cache expired` | 次のメッセージまで表示 |

- メイン会話のリクエストのたびに（ターン内のツール実行ステップも含めて）カウントダウンをやり直します。サブエージェントのリクエストは数えません。
- ターンの実行中は compact しません。長いターンが margin 内で終わったら、その時点で compact します。
- 試行はキャッシュ期間ごとに 1 回です。見送り・失敗はログに残し、毎秒やり直すことはありません。
- どの compact（`/compact`、自動 compact、他のプラグイン）の後も、次のリクエストまでカウントダウンを消します。
- compact では、作業中のタスク、変更したファイル、設計判断とその理由、未解決の項目を残し、要約は会話の言語で書かれます。

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
      "options": { "ttl": "1h", "marginSeconds": 180, "minContextTokens": 30000 }
    }
  }
}
```

| 項目 | 既定値 | 意味 |
| --- | --- | --- |
| `ttl` | `1h` | プロンプトキャッシュの TTL：`1h` または `5m` |
| `marginSeconds` | `180` | 満了の何秒前に compact するか |
| `minContextTokens` | `30000` | これ未満の context は compact しない（小さい context は再キャッシュが安いため） |

スクリーンショットは `ttl: 5m`、`marginSeconds: 280` で撮影したもので、リクエストの 20 秒後に compact が発火しています。

## 制限

- プラグインからはキャッシュの TTL を読めないため、`ttl` の設定値で数えます。TTL が 5 分に下がった場合（使用量が超過したときなど）は `ttl` を `5m` に切り替えてください。`5m` では `marginSeconds` を `60` 前後にするのがおすすめです。
- カウントダウンは各リクエストの送信時刻からの推定で、サーバー側のキャッシュそのものは見えません。

## 開発

```sh
claude plugin validate .
claude plugin test .
```

hooks モジュールは [`hooks/register.ts`](hooks/register.ts)、テストは [`hooks/register.test.ts`](hooks/register.test.ts) にあります。

## ライセンス

[MIT](LICENSE)
