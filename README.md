<div align="center">

# 🎵 NCM 转换器

**网易云音乐 NCM 格式批量解密转换工具**

[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Electron](https://img.shields.io/badge/electron-28-47848f?style=flat-square&logo=electron)](https://electronjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-0078d4?style=flat-square)]()

---

将网易云音乐加密的 `.ncm` 文件批量转换为原始音频格式，**完整保留**歌曲元数据与专辑封面。

</div>

---

## ✨ 功能特性

<table>
<tr>
<td width="50%">

### 🎯 核心功能
- 🔄 **批量转换** — 一键处理多个 NCM 文件
- 🎵 **格式保留** — MP3/FLAC 原格式输出，无损转换
- 🏷️ **元数据完整** — 歌曲名、艺术家、专辑信息全保留
- 🖼️ **封面提取** — 自动提取并保存专辑封面图片

</td>
<td width="50%">

### 🚀 体验优化
- 📂 **智能导入** — 拖拽 / 选择文件 / 递归扫描文件夹
- ⚡ **并发控制** — 1-8 线程可调，效率自由掌控
- 🎨 **深色主题** — VSCode 风格 UI，护眼舒适
- 📱 **跨平台** — Windows / Linux / macOS 三端支持

</td>
</tr>
</table>

---

## 📸 界面预览

```
┌──────────────────────────────────────────────────────────┐
│  ● NCM 转换器                              ─  □  ✕       │
├──────────────────────────────────────────────────────────┤
│  ♫ NCM → 原始格式        [选择文件] [选择文件夹]         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐  │
│  │              📂                                    │  │
│  │        拖拽 NCM 文件到此处                         │  │
│  │        选择文件 / 选择文件夹                        │  │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘  │
│                                                          │
│  输出: [默认与源文件相同目录      ] [浏览]  并发: [2 ▾]   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ♪ 周杰伦 - 晴天.flac    [████████████] 100%  完成 │   │
│  │ ♪ 林俊杰 - 江南.mp3     [████████░░░░]  65% 转换中│   │
│  │ ♪ 陈奕迅 - 十年.flac    [░░░░░░░░░░░░]   0% 等待  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [开始转换]         1 / 3    ░░░░░░░░░░░░░░░░   33%      │
├──────────────────────────────────────────────────────────┤
│                                              by Nanawwa  │
└──────────────────────────────────────────────────────────┘
```

---

## 🛠️ 技术架构

```
NCM转换器/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 窗口管理 & 入口
│   │   ├── ipc-handlers.ts      # IPC 通信 & 文件操作
│   │   ├── ncm-decrypt.ts       # 🔐 NCM 解密核心算法
│   │   └── preload.ts           # 安全桥接层
│   ├── renderer/                # 渲染进程 (前端)
│   │   ├── index.html           # VSCode 风格 UI
│   │   └── app.ts               # 交互逻辑
│   └── shared/
│       └── types.ts             # 共享类型定义
├── esbuild.main.mjs             # 主进程构建
├── esbuild.renderer.mjs         # 渲染进程构建
├── electron-builder.yml         # 打包配置
└── capacitor.config.ts          # Android 支持
```

---

## 🔐 解密原理

NCM 文件采用多层加密保护：

```
┌─────────────────────────────────────────────────┐
│  NCM File Structure                             │
├─────────────────────────────────────────────────┤
│  [ Magic Header ]  →  文件标识校验              │
│  [ Encrypted Key ] →  AES-128-ECB + XOR 0x64   │
│  [ Metadata ]      →  XOR 0x63 + Base64 + AES  │
│  [ Album Cover ]   →  封面图片数据              │
│  [ Audio Data ]    →  RC4 KeyBox 逐字节解密     │
└─────────────────────────────────────────────────┘
```

解密算法参考 [taurusxin/ncmdump](https://github.com/taurusxin/ncmdump) 实现。

---

## 🚀 快速开始

### 环境要求

| 依赖 | 版本要求 |
|:---:|:---:|
| Node.js | ≥ 18.0 |
| npm | ≥ 9.0 |

### 安装 & 运行

```bash
# 克隆项目
git clone https://github.com/Nanawwa/NCM-converter.git
cd NCM-converter

# 安装依赖
npm install

# 开发模式启动
npm run dev
```

---

## 📦 打包发布

<details>
<summary><b>Windows</b></summary>

```bash
# 生成 NSIS 安装包 + Portable 免安装版
npm run dist

# 产物位置
release/NCM转换器 Setup 1.0.0.exe   # 安装包
release/NCM转换器 1.0.0.exe          # Portable
```
</details>

<details>
<summary><b>Linux</b></summary>

```bash
# 生成 AppImage + deb 包
npx electron-builder --linux

# 产物位置
release/NCM转换器-1.0.0.AppImage    # 通用包
release/ncm-converter_1.0.0_amd64.deb
```
</details>

<details>
<summary><b>macOS</b></summary>

```bash
# 生成 DMG 安装包
npx electron-builder --mac
```
</details>

<details>
<summary><b>Android (Capacitor)</b></summary>

```bash
npm run build
npx cap sync
npx cap open android

# 在 Android Studio 中构建 APK
```
</details>

---

## ⚙️ 配置选项

| 参数 | 默认值 | 说明 |
|:---:|:---:|:---|
| `并发数` | 2 | 同时处理的文件数量 (1-8) |
| `输出目录` | 源文件目录 | 转换后文件的保存位置 |
| `文件命名` | `歌手 - 歌曲名` | 自动命名，特殊字符过滤 |

---

## 📋 开发命令

```bash
npm run build          # 构建主进程 + 渲染进程
npm run dev            # 构建并启动开发模式
npm run build:main     # 仅构建主进程
npm run build:renderer # 仅构建渲染进程
npm run pack           # 打包为目录（测试用）
npm run dist           # 打包为安装程序
```

---

## 🤝 参考项目

- [taurusxin/ncmdump](https://github.com/taurusxin/ncmdump) — NCM 解密算法参考
- [Electron](https://electronjs.org) — 跨平台桌面框架
- [esbuild](https://esbuild.github.io) — 极速构建工具

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

```
MIT License

Copyright (c) 2024 Nanawwa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

<div align="center">

**Made with ❤️ by [Nanawwa](https://github.com/Nanawwa)**

*If this project helps you, consider giving it a ⭐*

</div>
