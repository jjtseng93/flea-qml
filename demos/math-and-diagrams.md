# 數學公式與 Mermaid 圖表

這份檔案展示 Markdown 預覽能畫的東西：公式由 Temml 轉成 MathML，圖表由後端的 Pele 畫成 SVG。
在 HTML 預覽（有 WebEngine 時）兩者都會畫出來；區塊預覽只畫圖表，公式顯示原文。

## 行內公式

愛因斯坦的質能等價 $E = mc^2$，圓面積 $A = \pi r^2$，二次方程的根 $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$。

價格寫成 $5 和 $10 不會被當成公式，程式碼裡的 `$x$` 也不會。

## 獨立公式

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
\qquad
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

### 矩陣與對齊

$$
A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix},
\quad
\det(A) = \begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix} = -2
$$

$$
\begin{aligned}
(a + b)^2 &= a^2 + 2ab + b^2 \\
(a - b)^2 &= a^2 - 2ab + b^2
\end{aligned}
$$

### 分段函數

$$
|x| = \begin{cases} x & \text{若 } x \ge 0 \\ -x & \text{若 } x < 0 \end{cases}
$$

### 化學式（mhchem）

$$
\ce{2H2 + O2 -> 2H2O}
\qquad
\ce{CO2 + H2O <=> H2CO3}
$$

### 直接寫 MathML

<math display="block"><mfrac><mn>1</mn><mi>φ</mi></mfrac><mo>=</mo><mi>φ</mi><mo>−</mo><mn>1</mn></math>

## Mermaid 圖表

### 流程圖

```mermaid
flowchart LR
  A[讀取檔案] --> B{是 Markdown?}
  B -->|是| C[預覽 😀]
  B -->|否| D[純文字]
  C --> E[公式與圖表]
```

### 循序圖

```mermaid
sequenceDiagram
  participant 使用者
  participant 介面
  participant 後端
  使用者->>介面: 開啟 README.md
  介面->>後端: markdownhtml
  後端-->>介面: HTML 頁面（含 SVG 圖）
  介面-->>使用者: 顯示預覽
```

### 類別圖

```mermaid
classDiagram
  class 檔案 {
    +名稱
    +大小
    +開啟()
  }
  class 圖片 {
    +寬度
    +高度
  }
  檔案 <|-- 圖片
```

### 狀態圖

```mermaid
stateDiagram-v2
  [*] --> 閒置
  閒置 --> 載入中: 選取檔案
  載入中 --> 顯示: 完成
  載入中 --> 錯誤: 失敗
  顯示 --> 閒置
  錯誤 --> 閒置
```

### 甘特圖

```mermaid
gantt
  title 預覽功能計畫
  dateFormat YYYY-MM-DD
  section 圖表
  後端畫圖 :done, a1, 2026-11-10, 3d
  HTML 預覽 :active, a2, after a1, 2d
  section 清理
  移除舊 helper :a3, after a2, 2d
```

### 圓餅圖

```mermaid
pie title 檔案類型
  "Markdown" : 40
  "圖片" : 35
  "其他" : 25
```

### 實體關聯圖

```mermaid
erDiagram
  資料夾 ||--o{ 檔案 : 包含
  檔案 ||--o| 縮圖 : 產生
```

### 心智圖

```mermaid
mindmap
  root((flea-qml))
    預覽
      數學公式
      Mermaid 圖表
      程式碼
    檔案操作
      複製
      壓縮
```

### 使用者旅程

```mermaid
journey
  title 整理照片的一天
  section 早上
    匯入照片: 4: 我
    挑選: 3: 我
  section 下午
    壓縮備份: 5: 我
```

### 時間軸

```mermaid
timeline
  title 版本
  2026-10 : 0.4.0 : 0.4.1
  2026-11 : 0.4.2
```

### 象限圖

```mermaid
quadrantChart
  title 待辦優先順序
  x-axis 不急 --> 緊急
  y-axis 不重要 --> 重要
  修 bug: [0.8, 0.9]
  寫文件: [0.3, 0.7]
  整理桌面: [0.2, 0.2]
```

## 畫不出來時

語法錯誤的圖表會保留原始碼，下面再附一行原因：

```mermaid
flowchart TD
  A -->
```

一般的程式碼區塊不受影響：

```js
const 問候 = "這不是圖表";
```
