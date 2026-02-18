# RIVERBED

高效能、資料驅動的山岳攝影集，使用 Astro + Cloudflare R2 構建。

## 專案架構

### 技術棧
- **Framework**: Astro (SSR with Cloudflare Adapter)
- **Storage**: Cloudflare R2 (Private Bucket)
- **Content**: MDX + Astro Content Collections
- **Styling**: Tailwind CSS

### 目錄結構
```
src/
├── content/
│   ├── folders/          # 資料夾元資料 (JSON)
│   │   └── taiwan.json
│   └── albums/           # 相簿內容 (MDX)
│       └── jade-mountain.mdx
├── components/
│   ├── Row.astro         # 照片排版組件
│   └── Photo.astro       # 照片展示組件 (支援標籤)
├── pages/
│   ├── index.astro       # 首頁 (資料夾列表)
│   ├── [folder]/
│   │   ├── index.astro   # 相簿列表
│   │   └── [album].astro # 相簿檢視器
│   └── api/
│       └── image/
│           └── [...path].ts  # 圖片代理 API
public/
└── r2/                   # 本地開發用圖片 (不提交到 Git)
scripts/
└── new-album.js          # 自動生成相簿工具
```

## 快速開始

### 1. 安裝依賴
```bash
npm install
```

### 2. 設定環境

#### 開發模式
將照片放在 `public/r2/` 目錄下：
```
public/r2/
└── taiwan/
    └── jade-mountain/
        ├── jade-mountain-01.jpg
        ├── jade-mountain-02.jpg
        └── ...
```

#### 生產模式
配置 Cloudflare R2 Bucket 並上傳照片，確保 `wrangler.toml` 中的 binding 設定正確：
```toml
[[r2_buckets]]
binding = "RIVERBED"
bucket_name = "riverbed-assets"
```

### 3. 啟動開發伺服器

**純 Astro 開發模式** (使用本地圖片):
```bash
npm run dev
```

**R2 模擬模式** (測試 R2 整合):
```bash
npm run dev:r2
```

## 內容管理

### 建立資料夾

在 `src/content/folders/` 建立 JSON 檔案：

```json
{
  "title": "台灣高山",
  "homeCols": 3,
  "albumCols": 3,
  "order": 1
}
```

**欄位說明**:
- `title`: 資料夾顯示名稱
- `homeCols`: 首頁顯示欄數
- `albumCols`: 相簿列表頁欄數
- `order`: 排序順序 (數字越小越前面)

### 建立相簿

#### 方法 1: 使用自動化工具 (推薦)

```bash
npm run new-album <folder> <album-slug> <album-title>
```

範例:
```bash
npm run new-album taiwan jade-mountain "玉山主峰"
```

這會自動掃描 `public/r2/taiwan/jade-mountain/` 中的所有圖片，並生成包含所有照片的 MDX 檔案。

#### 方法 2: 手動建立

在 `src/content/albums/` 建立 MDX 檔案：

```mdx
---
title: "玉山主峰"
coverKey: "taiwan/jade-mountain/jade-mountain-01.jpg"
order: 1
folder: "taiwan"
---

## 登頂之路

玉山主峰海拔 3,952 公尺。

<Row cols={2}>
  <Photo key="taiwan/jade-mountain/jade-mountain-01.jpg" caption="清晨的玉山主峰" tags={[]} />
  <Photo key="taiwan/jade-mountain/jade-mountain-02.jpg" caption="登山步道" tags={[]} />
</Row>

<Row cols={1}>
  <Photo
    key="taiwan/jade-mountain/jade-mountain-summit.jpg"
    caption="玉山主峰山頂"
    tags={[
      { name: "玉山主峰", x: 45, y: 30 },
      { name: "玉山東峰", x: 65, y: 35 }
    ]}
  />
</Row>
```

### MDX 組件使用

#### `<Row>` 組件
用於排版照片，使用 Flexbox 自動填滿空間。

```mdx
<Row cols={3}>
  <!-- 3 張照片並排 -->
</Row>
```

#### `<Photo>` 組件
展示單張照片，支援標籤標註。

**Props**:
- `itemKey`: R2 路徑 (例: `"taiwan/photo.jpg"`)
- `caption`: 照片說明 (選填)
- `tags`: 山岳標籤陣列 (選填)

**標籤格式**:
```javascript
tags={[
  { name: "山峰名稱", x: 45, y: 30 }  // x, y 為百分比座標 (0-100)
]}
```

## 座標開發工具

在相簿頁面，點擊任何照片會在 Console 輸出點擊位置的百分比座標，方便標註山岳位置。

```javascript
// Console 輸出範例:
Tag coordinates: { x: 45.23, y: 30.67 }
Click position on image: (45.23%, 30.67%)
```

## 部署

### 建置專案
```bash
npm run build
```

### 部署到 Cloudflare Pages
```bash
wrangler pages deploy dist
```

確保在 Cloudflare Pages 設定中綁定 R2 Bucket：
- Binding name: `RIVERBED`
- Bucket: `riverbed-assets`

## 圖片代理機制

`/api/image/[...path].ts` 根據環境自動切換圖片來源：

- **開發模式**: 從 `public/images/remote/` 讀取
- **生產模式**: 從 R2 Bucket 讀取，並加入快取標頭 (`Cache-Control: public, max-age=31536000, immutable`)

## 路由結構

- `/` - 首頁 (所有資料夾)
- `/taiwan` - 台灣高山資料夾 (相簿列表)
- `/taiwan/jade-mountain` - 玉山主峰相簿

## 開發提示

1. **本地開發**: 將照片放在 `public/r2/` 並使用 `npm run dev`
2. **自動生成**: 使用 `npm run new-album` 快速建立相簿骨架
3. **標籤定位**: 使用內建的座標工具點擊照片獲取精確座標
4. **響應式設計**: 所有組件已針對行動裝置優化

## License

MIT
