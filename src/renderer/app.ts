interface ElectronAPI {
  selectFiles(): Promise<string[]>;
  selectFolder(): Promise<string[]>;
  scanPaths(paths: string[]): Promise<string[]>;
  selectOutputDir(): Promise<string | null>;
  convertFiles(files: string[], outputDir: string, concurrency: number): Promise<any>;
  openOutputDir(dir: string): void;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  onConvertStart(callback: (data: unknown) => void): void;
  onConvertProgress(callback: (data: unknown) => void): void;
  onConvertInfo(callback: (data: unknown) => void): void;
  onConvertComplete(callback: (data: unknown) => void): void;
  onConvertError(callback: (data: unknown) => void): void;
  onConvertAllDone(callback: () => void): void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};

const api = window.electronAPI;

// ---------- DOM ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const emptyEl = $('empty');
const fileList = $('fileList');
const dropOverlay = $('dropOverlay');
const startBtn = $<HTMLButtonElement>('startBtn');
const openOutputBtn = $<HTMLButtonElement>('openOutputBtn');
const clearBtn = $<HTMLButtonElement>('clearBtn');
const selectFilesBtn = $<HTMLButtonElement>('selectFilesBtn');
const selectFolderBtn = $<HTMLButtonElement>('selectFolderBtn');
const selectOutputBtn = $<HTMLButtonElement>('selectOutputBtn');
const outputDirInput = $<HTMLInputElement>('outputDir');
const concurrencySelect = $<HTMLSelectElement>('concurrency');
const batchFill = $('batchFill');
const statsEl = $('stats');
const toastEl = $('toast');

// ---------- 状态 ----------
interface Row {
  path: string;
  name: string;
  title?: string;
  artist?: string;
  album?: string;
  format?: string;
  coverUrl?: string;
  status: 'pending' | 'converting' | 'done' | 'error';
  progress: number;
  error?: string;
  el?: HTMLDivElement;
}

const rows: Row[] = [];
const rowIndex = new Map<string, number>();
let isConverting = false;
let currentOutputDir = '';
let firstSuccessPath = '';
let doneCount = 0;
let failCount = 0;

const MUSIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

// ---------- Toast ----------
let toastTimer: number | undefined;
function toast(msg: string, isError = false): void {
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3200);
}

// ---------- 渲染 ----------
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusText(row: Row): { text: string; cls: string } {
  switch (row.status) {
    case 'converting': return { text: '转换中', cls: 'converting' };
    case 'done': return { text: '完成', cls: 'done' };
    case 'error': return { text: '失败', cls: 'error' };
    default: return { text: '等待', cls: '' };
  }
}

function buildRow(row: Row): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'file-row';
  el.dataset.path = row.path;

  const title = row.title || row.name;
  const titleCls = row.title ? '' : ' pending';
  const subParts: string[] = [];
  if (row.artist) subParts.push(row.artist);
  if (row.album) subParts.push(row.album);
  if (!row.title) subParts.push(row.name);
  const sub = subParts.join(' · ');
  const st = statusText(row);
  const cover = row.coverUrl
    ? `<img src="${row.coverUrl}" alt="">`
    : MUSIC_SVG;

  el.innerHTML = `
    <div class="cover">${cover}</div>
    <div class="meta">
      <div class="title${titleCls}" title="${esc(title)}">${esc(title)}</div>
      <div class="sub${row.status === 'error' ? ' error' : ''}" title="${esc(row.error || sub)}">${esc(row.error || sub)}</div>
    </div>
    ${row.format ? `<div class="chip">${esc(row.format.toUpperCase())}</div>` : ''}
    <div class="bar-wrap">
      <div class="bar"><div class="fill"></div></div>
      <span class="bar-pct">0%</span>
    </div>
    <div class="chip ${st.cls}">${st.text}</div>
    <button class="row-remove" title="移除">
      <svg viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.4"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.4"/></svg>
    </button>`;

  el.querySelector('.row-remove')!.addEventListener('click', () => removeRow(row.path));
  return el;
}

function updateRow(row: Row): void {
  if (!row.el) return;
  const el = row.el;

  // 标题与副行
  const titleEl = el.querySelector('.title') as HTMLDivElement;
  const subEl = el.querySelector('.sub') as HTMLDivElement;
  const title = row.title || row.name;
  titleEl.textContent = title;
  titleEl.className = 'title' + (row.title ? '' : ' pending');
  titleEl.title = title;

  if (row.status === 'error') {
    subEl.textContent = row.error || '转换失败';
    subEl.className = 'sub error';
    subEl.title = row.error || '';
  } else {
    const parts: string[] = [];
    if (row.artist) parts.push(row.artist);
    if (row.album) parts.push(row.album);
    if (!row.title) parts.push(row.name);
    subEl.textContent = parts.join(' · ');
    subEl.className = 'sub';
    subEl.title = '';
  }

  // 封面
  const coverEl = el.querySelector('.cover') as HTMLDivElement;
  if (row.coverUrl && !coverEl.querySelector('img')) {
    coverEl.innerHTML = `<img src="${row.coverUrl}" alt="">`;
  }

  // 格式 chip
  let formatChip = el.querySelector('.chip.format') as HTMLDivElement | null;
  if (row.format && !formatChip) {
    formatChip = document.createElement('div');
    formatChip.className = 'chip format';
    el.insertBefore(formatChip, el.querySelector('.bar-wrap'));
  }
  if (formatChip) formatChip.textContent = row.format ? row.format.toUpperCase() : '';

  // 状态 chip
  const st = statusText(row);
  const statusChip = el.querySelector('.chip:not(.format)') as HTMLDivElement;
  statusChip.className = `chip ${st.cls}`;
  statusChip.textContent = st.text;

  // 进度
  const fill = el.querySelector('.fill') as HTMLDivElement;
  const pct = el.querySelector('.bar-pct') as HTMLSpanElement;
  fill.className = 'fill' + (row.status === 'done' ? ' done' : row.status === 'error' ? ' error' : '');
  fill.style.width = `${row.progress}%`;
  pct.textContent = row.status === 'done' ? '100%' : `${row.progress}%`;
}

function renderAll(): void {
  const hasRows = rows.length > 0;
  emptyEl.style.display = hasRows ? 'none' : 'flex';
  fileList.style.display = hasRows ? 'block' : 'none';
  fileList.innerHTML = '';
  for (const row of rows) {
    const el = buildRow(row);
    row.el = el;
    fileList.appendChild(el);
  }
  startBtn.disabled = hasRows === false || isConverting;
  clearBtn.disabled = !hasRows || isConverting;
  updateStats();
}

function updateStats(): void {
  if (rows.length === 0) {
    statsEl.innerHTML = '';
    return;
  }
  const done = rows.filter((r) => r.status === 'done').length;
  const failed = rows.filter((r) => r.status === 'error').length;
  const busy = rows.filter((r) => r.status === 'converting').length;
  let html = `共 <b>${rows.length}</b> 个`;
  if (done > 0 || failed > 0 || busy > 0) {
    html += ` · 已完成 <b class="ok">${done}</b> · 失败 <b class="bad">${failed}</b>`;
  }
  if (isConverting) html += ` · 转换中 <b>${busy}</b>`;
  statsEl.innerHTML = html;
}

// ---------- 行操作 ----------
function addRows(paths: string[]): void {
  let added = 0;
  for (const p of paths) {
    if (rowIndex.has(p)) continue;
    const name = p.split(/[/\\]/).pop() || p;
    rows.push({ path: p, name, status: 'pending', progress: 0 });
    rowIndex.set(p, rows.length - 1);
    added++;
  }
  if (added > 0) {
    renderAll();
    if (added < paths.length) toast(`已忽略 ${paths.length - added} 个重复文件`);
  } else if (paths.length > 0) {
    toast('这些文件已经在列表里了');
  }
}

function removeRow(path: string): void {
  if (isConverting) return;
  const i = rowIndex.get(path);
  if (i === undefined) return;
  const row = rows[i];
  if (row.coverUrl) URL.revokeObjectURL(row.coverUrl);
  rows.splice(i, 1);
  rowIndex.clear();
  rows.forEach((r, idx) => rowIndex.set(r.path, idx));
  renderAll();
}

function clearAll(): void {
  if (isConverting) return;
  for (const r of rows) if (r.coverUrl) URL.revokeObjectURL(r.coverUrl);
  rows.length = 0;
  rowIndex.clear();
  batchFill.style.width = '0%';
  firstSuccessPath = '';
  doneCount = 0;
  failCount = 0;
  openOutputBtn.style.display = 'none';
  renderAll();
}

// ---------- 添加文件 ----------
async function pickFiles(): Promise<void> {
  const files = await api.selectFiles();
  if (files.length > 0) addRows(files);
}

async function pickFolder(): Promise<void> {
  const files = await api.selectFolder();
  if (files.length === 0) {
    toast('该文件夹里没有找到 .ncm 文件');
    return;
  }
  addRows(files);
  toast(`找到 ${files.length} 个 NCM 文件`);
}

// ---------- 拖放 ----------
let dragDepth = 0;

window.addEventListener('dragenter', (e) => {
  if (isConverting || !e.dataTransfer) return;
  if (Array.from(e.dataTransfer.types).includes('Files')) {
    dragDepth++;
    dropOverlay.classList.add('show');
  }
});

window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('show');
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
});

window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('show');
  if (isConverting) return;
  const paths = Array.from(e.dataTransfer?.files || [])
    .map((f) => (f as any).path)
    .filter(Boolean);
  if (paths.length === 0) return;
  const ncm = await api.scanPaths(paths);
  if (ncm.length === 0) {
    toast('拖入的内容里没有 .ncm 文件');
    return;
  }
  addRows(ncm);
  if (ncm.length > 1) toast(`已添加 ${ncm.length} 个 NCM 文件`);
});

// ---------- 开始转换 ----------
function resetRowsForConvert(): void {
  for (const r of rows) {
    r.status = 'pending';
    r.progress = 0;
    r.error = undefined;
    updateRow(r);
  }
}

startBtn.addEventListener('click', async () => {
  if (isConverting || rows.length === 0) return;
  isConverting = true;
  doneCount = 0;
  failCount = 0;
  firstSuccessPath = '';
  openOutputBtn.style.display = 'none';

  currentOutputDir = outputDirInput.value.trim();
  const concurrency = parseInt(concurrencySelect.value, 10) || 2;

  startBtn.disabled = true;
  clearBtn.disabled = true;
  startBtn.innerHTML = `转换中…`;
  batchFill.style.width = '0%';

  resetRowsForConvert();

  const paths = rows.map((r) => r.path);
  const res = await api.convertFiles(paths, currentOutputDir, concurrency);
  if (res && res.error) {
    isConverting = false;
    startBtn.disabled = false;
    startBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>开始转换`;
    toast(res.error, true);
  }
});

// ---------- 主进程事件 ----------
api.onConvertStart(() => {
  resetRowsForConvert();
});

api.onConvertInfo((data: unknown) => {
  const d = data as {
    id: string;
    songName: string;
    artist: string;
    album: string;
    format: string;
    cover?: Uint8Array;
    coverMime?: string;
  };
  const i = rowIndex.get(d.id);
  if (i === undefined) return;
  const row = rows[i];
  row.title = d.songName || undefined;
  row.artist = d.artist || undefined;
  row.album = d.album || undefined;
  if (d.format && d.format !== 'unknown') row.format = d.format;
  if (d.cover && d.cover.length > 0) {
    const blob = new Blob([d.cover], { type: d.coverMime || 'image/jpeg' });
    if (row.coverUrl) URL.revokeObjectURL(row.coverUrl);
    row.coverUrl = URL.createObjectURL(blob);
  }
  updateRow(row);
});

api.onConvertProgress((data: unknown) => {
  const d = data as { id: string; progress: number; status: string; totalProgress?: number };
  const i = rowIndex.get(d.id);
  if (i !== undefined) {
    const row = rows[i];
    if (d.status === 'converting') row.status = 'converting';
    row.progress = Math.round(d.progress);
    updateRow(row);
  }
  if (d.totalProgress !== undefined) {
    batchFill.style.width = `${d.totalProgress}%`;
  }
});

api.onConvertComplete((data: unknown) => {
  const d = data as { id: string; outputPath: string };
  const i = rowIndex.get(d.id);
  if (i !== undefined) {
    const row = rows[i];
    row.status = 'done';
    row.progress = 100;
    updateRow(row);
  }
  doneCount++;
  if (!firstSuccessPath && d.outputPath) firstSuccessPath = d.outputPath;
  updateStats();
});

api.onConvertError((data: unknown) => {
  const d = data as { id: string; error: string };
  const i = rowIndex.get(d.id);
  if (i !== undefined) {
    const row = rows[i];
    row.status = 'error';
    row.progress = 0;
    row.error = d.error || '未知错误';
    updateRow(row);
  }
  failCount++;
  updateStats();
});

api.onConvertAllDone(() => {
  isConverting = false;
  startBtn.disabled = rows.length === 0;
  clearBtn.disabled = rows.length === 0;
  startBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>开始转换`;
  batchFill.style.width = '100%';

  const total = doneCount + failCount;
  if (failCount === 0) {
    toast(`转换完成:${doneCount} 个文件全部成功`);
  } else {
    toast(`转换完成:成功 ${doneCount} 个,失败 ${failCount} 个`, failCount > 0);
  }

  if (doneCount > 0) {
    openOutputBtn.style.display = 'inline-flex';
  }
  updateStats();
});

// ---------- 其它按钮 ----------
selectFilesBtn.addEventListener('click', pickFiles);
selectFolderBtn.addEventListener('click', pickFolder);
clearBtn.addEventListener('click', clearAll);

selectOutputBtn.addEventListener('click', async () => {
  const dir = await api.selectOutputDir();
  if (dir) outputDirInput.value = dir;
});

openOutputBtn.addEventListener('click', () => {
  const dir = currentOutputDir || (firstSuccessPath ? firstSuccessPath.replace(/[/\\][^/\\]+$/, '') : '');
  if (dir) api.openOutputDir(dir);
});

document.getElementById('btnMinimize')?.addEventListener('click', () => api.windowMinimize());
document.getElementById('btnMaximize')?.addEventListener('click', () => api.windowMaximize());
document.getElementById('btnClose')?.addEventListener('click', () => api.windowClose());

renderAll();
