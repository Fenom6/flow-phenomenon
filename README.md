# Flow Phenomenon: Organic

> **Information not as stock, but as flow.**
>
> 情報を固定された記録ではなく、絶えず変化し通り過ぎる「現象」として可視化するWebアート。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Mobile%20Web-orange.svg)
![Tech](https://img.shields.io/badge/tech-p5.js-pink.svg)

## Demo

**[Flow Phenomenon を起動](https://fenom6.github.io/flow-phenomenon/)**

スマートフォンでは開始ボタンを押し、表示された場合だけセンサー利用を許可してください。拒否してもタッチモードで体験できます。

## できること

- **Organic Flow Field:** Perlin Noise が、静止中も変化し続ける有機的な流れをつくります。
- **Tilt Gravity:** 端末の傾きを画面方向へ補正し、開始時の持ち方を中立位置として流れへ反映します。
- **Tactile Interference:** タッチ、ペン、マウスで粒子を押し分けられます。マルチタッチにも対応します。
- **Four Palettes:** 深海、オーロラ、焔、月光をボタン、ダブルタップ、数字キーで切り替えられます。
- **Burst:** シェイク、画面ボタン、Spaceキーで粒子を外向きに爆ぜさせます。
- **Accessible Controls:** 傾きやシェイクを使わなくても、常設ボタンとキーボードで全演出を操作できます。
- **Adaptive Performance:** 高DPIを抑え、フレーム時間に応じて粒子数を範囲内で調整します。
- **Offline Ready:** p5.jsを同梱し、初回読込後はService Workerからオフライン起動できます。

## 操作

| 操作 | タッチ／スマートフォン | デスクトップ／キーボード |
|---|---|---|
| 流れを動かす | 端末を傾ける、画面をドラッグ | マウス移動、押しながらドラッグ |
| 色を変える | `COLOR`、ダブルタップ | `COLOR`、`1`〜`4` |
| バースト | `BURST`、シェイク | `BURST`、`Space` |
| 停止／再開 | `FLOW` | `FLOW`、`P` |
| 操作案内 | `操作` | `操作`、`H` または `?` |
| センサー再確認／再調整 | 左上のモード表示 | 左上のモード表示 |

## センサーとプライバシー

- 傾き・モーションセンサーは、対応ブラウザの **HTTPS** または `localhost` でのみ利用できます。
- iOSでは利用開始時のユーザー操作と明示許可が必要です。
- 許可、API、実際のセンサー値受信を別々に判定し、値が届かない場合は自動的に `TOUCH MODE` へ戻ります。
- センサー値を送信、保存、分析するコードはありません。アプリの静的ファイルもすべて同一オリジンから読み込みます。
- センサーを拒否した後は、左上の `TOUCH MODE` を押すと再確認できます。OS側で恒久拒否した場合はブラウザ設定の変更が必要です。

## ローカル起動

ビルドやパッケージインストールは不要です。センサー、Service Worker、CSPを正しく確認するため、`file://` ではなくローカルHTTPサーバーを使います。

```powershell
git clone https://github.com/Fenom6/flow-phenomenon.git
Set-Location -LiteralPath '.\flow-phenomenon'
py -3 -m http.server 4173 --bind 127.0.0.1
```

ブラウザで <http://127.0.0.1:4173/> を開きます。スマートフォン実機からセンサーを使う場合は、GitHub PagesなどのHTTPS環境へ配置してください。

## 検証

Node.jsだけで、JavaScript構文、manifestとアイコン実寸、CSP・アクセシビリティの必須フック、Service Workerの資産・更新番号・オフライン遷移、同梱p5.js／ライセンス／依存NOTICEを検証できます。

```powershell
node .\scripts\validate.mjs
node --test .\tests\flow-core.test.mjs .\tests\app-guards.test.mjs .\tests\service-worker.test.mjs
```

実機リリース前の最小確認行列:

1. iOS Safari: センサー許可、拒否、再訪、縦向き、横向き左右。
2. Android Chrome: センサー有効、センサー無効、縦向き、横向き左右。
3. センサーなし環境: タッチ／マウス、全ボタン、キーボード。
4. 小型画面: `320×568`、標準画面: `390×844`、横画面: `844×390`。
5. 初回オンライン読込後、ネットワークを切って再読込。

## 構成

```text
index.html             セマンティックな画面構造とメタデータ
styles.css             レスポンシブUI、safe area、reduced motion
flow-core.js           画面軸、時間換算、粒子境界の純粋計算
app.js                 粒子描画、入力、許可状態、性能制御
sw.js                  同一オリジン資産のオフラインキャッシュ
manifest.webmanifest   インストール情報
icons/                 favicon / PWAアイコン
vendor/                固定したp5.js 1.9.0、上流ライセンス、依存NOTICE
scripts/validate.mjs   依存なしのリリース前検証
tests/                 純粋計算・ブラウザーガード・Service WorkerのNode標準テスト
```

主な調整値は `app.js` 冒頭にあります。

```javascript
const INITIAL_PARTICLES = 800;
const MIN_PARTICLES = 280;
const MAX_PARTICLES = 1200;
const GRAVITY_STRENGTH = 0.055;
```

OSで「視差効果を減らす」が有効な場合は、粒子数、速度、明滅を自動的に抑えます。

## 技術スタック

- HTML5 / CSS3 / JavaScript
- [p5.js 1.9.0](https://github.com/processing/p5.js/tree/v1.9.0)
- Device Orientation / Device Motion / Pointer Events / Service Worker
- ビルドツール、バックエンド、解析SDKなし

## ライセンス

アプリ本体は [MIT License](./LICENSE) です。同梱するp5.jsは GNU LGPL 2.1 です。出典・ハッシュ・LGPL原文・バンドル内依存の著作権表示は [`vendor/`](./vendor/) に分離しています。

## 既知の確認事項

デスクトップのブラウザ試験ではセンサー値を生成できないため、傾き方向、シェイク閾値、長時間の発熱・電池消費はiOS／Android実機で最終確認してください。
