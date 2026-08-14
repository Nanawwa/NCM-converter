# NCM 转换器

将网易云音乐加密的 `.ncm` 文件批量还原为原始音频格式(MP3 / FLAC / OGG / WAV 等),并写入歌曲名、艺术家、专辑与封面。

Electron + TypeScript 桌面应用,解密算法参考 [taurusxin/ncmdump](https://github.com/taurusxin/ncmdump)。

## 功能

- 拖拽 / 选择文件 / 选择文件夹(递归扫描)添加 NCM 文件
- 自动识别原始音频格式,按 `歌手 - 歌曲名` 命名输出(重名自动加序号)
- 输出文件内嵌 ID3v2(MP3)或 VORBIS_COMMENT + PICTURE(FLAC)标签与封面
- 1-8 并发转换,实时显示每文件进度与结果
- 支持 MP3、FLAC、OGG、WAV、AAC、APE、WMA、M4A 等格式

## 开发

```bash
npm install
npm run build        # 构建主进程 + 渲染进程
npm run dev          # 构建并启动
npm run dist         # 打包(NSIS 安装包 + Portable)
```

## 结构

```
src/
├── main/
│   ├── index.ts         # 窗口管理
│   ├── ipc-handlers.ts  # IPC 与文件选择
│   ├── ncm-decrypt.ts   # NCM 解密核心
│   ├── tags.ts          # MP3/FLAC 标签写入
│   └── preload.ts       # 安全桥接
├── renderer/            # 界面
└── shared/types.ts
```

## 声明

仅用于个人已购曲目的格式还原,请尊重版权。
