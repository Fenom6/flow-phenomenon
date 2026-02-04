# Flow Phenomenon: Organic

> **"Information not as stock, but as flow."**
>
> 情報を「固定された記録」としてではなく、絶えず変化し通り過ぎていく「現象」として可視化する、実験的Webアプリケーション。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Mobile%20Web-orange.svg)
![Tech](https://img.shields.io/badge/tech-p5.js-pink.svg)

## Demo
**[Launch Application](https://fenom6.github.io/flow-phenomenon/)**
*(スマートフォンでアクセスし、画面の回転ロックを解除してご覧ください)*

## 概要 (Overview)

このプロジェクトは、スマートフォンのローカルセンサーと数理モデル（Perlin Noise）を融合させ、デジタル空間上の粒子を「有機的な流体」としてシミュレーションします。
サーバーとの通信を行わず、デバイスの物理的な傾きや接触が、ダイレクトに画面内の現象として反映されます。

## 特徴 (Features)

* **Organic Flow Field (Perlin Noise):**
    パーリンノイズにより生成された不可視の「場（Field）」が、粒子に風や水流のような有機的なうねりを与えます。静止状態でも粒子は生き物のように自律的に流動します。
* **Physical Gravity:**
    スマホの傾き（`DeviceOrientation`）がそのまま重力ベクトルとなり、流体全体の流れる方向を決定します。
* **Tactile Interference:**
    画面へのタッチ操作が「場への干渉（斥力）」として作用し、流れを指でかき乱すことができます。
* **Visual Persistence:**
    加算合成（Additive Blending）と残像処理により、情報の密度とエネルギーを光の強弱として表現します。

## 技術スタック (Tech Stack)

* **HTML5 / CSS3**
* **JavaScript (ES6)**
* **p5.js** (Creative Coding Library)
    * `noise()` for Perlin noise generation
    * `p5.Vector` for physics simulation
    * `blendMode(ADD)` for visual effects

## 動作環境 (Requirements)

* **Device:** 加速度/ジャイロセンサーを搭載したスマートフォン
* **Browser:** モダンブラウザ (Safari, Chrome)
* **Note:** iOS 13以降のデバイスでは、初回起動時にセンサー使用の許可（"INITIALIZE ORGANIC FLOW"ボタン）が必要です。

## クイックスタート (Usage)

特別なビルド環境は不要です。

1.  このリポジトリをClone、またはDownloadします。
2.  `index.html` をWebサーバー上で開きます。
    * **注意:** iOSのセキュリティ制約上、センサーを使用するには **HTTPS環境** が必須です（GitHub Pages推奨）。

## 設定・カスタマイズ (Configuration)

`index.html` 内の変数を変更することで、流体の粘度や挙動を調整できます。

```javascript
const numParticles = 800; // 粒子の総数
let noiseScale = 0.005;   // ノイズの細かさ（小さいほど大きなうねり）
let timeOffset = 0;       // 時間経過による場の変化速度# flow-phenomenon
