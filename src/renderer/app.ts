interface ElectronAPI {
  selectFiles(): Promise<string[]>;
  selectFolder(): Promise<string[]>;
  selectOutputDir(): Promise<string | null>;
  convertFiles(files: string[], outputDir: string, concurrency: number): Promise<any>;
  openOutputDir(dir: string): void;
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
  onConvertStart(callback: (data: unknown) => void): void;
  onConvertProgress(callback: (data: unknown) => void): void;
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

const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const dropSelectBtn = document.getElementById('dropSelectBtn') as HTMLSpanElement;
const dropFolderBtn = document.getElementById('dropFolderBtn') as HTMLSpanElement;
const selectFilesBtn = document.getElementById('selectFilesBtn') as HTMLButtonElement;
const selectFolderBtn = document.getElementById('selectFolderBtn') as HTMLButtonElement;
const selectOutputBtn = document.getElementById('selectOutputBtn') as HTMLButtonElement;
const outputDirInput = document.getElementById('outputDir') as HTMLInputElement;
const concurrencySelect = document.getElementById('concurrency') as HTMLSelectElement;
const fileList = document.getElementById('fileList') as HTMLDivElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const openOutputBtn = document.getElementById('openOutputBtn') as HTMLButtonElement;
const batchProgress = document.getElementById('batchProgress') as HTMLDivElement;
const batchLabel = document.getElementById('batchLabel') as HTMLSpanElement;
const batchPct = document.getElementById('batchPct') as HTMLSpanElement;
const batchFill = document.getElementById('batchFill') as HTMLDivElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;

let ncmFiles: string[] = [];
let isConverting = false;
let currentOutputDir = '';
let doneCount = 0;
let totalFiles = 0;

const MUSIC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

function renderFileList(): void {
  fileList.innerHTML = ncmFiles.map((f, i) => {
    const name = f.split(/[/\\]/).pop() || f;
    return `<div class="file-item" data-index="${i}">
      <div class="icon-svg">${MUSIC_ICON}</div>
      <div class="name" title="${f}">${escapeHtml(name)}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
      <div class="status status-pending">等待</div>
    </div>`;
  }).join('');
  startBtn.disabled = ncmFiles.length === 0;
  statsEl.textContent = ncmFiles.length > 0 ? `${ncmFiles.length} 个文件` : '';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateFileProgress(filePath: string, progress: number, status: string): void {
  const items = fileList.querySelectorAll('.file-item');
  items.forEach((item) => {
    const el = item as HTMLDivElement;
    const nameEl = el.querySelector('.name') as HTMLDivElement;
    if (nameEl.title === filePath) {
      const fill = el.querySelector('.progress-fill') as HTMLDivElement;
      const statusEl = el.querySelector('.status') as HTMLDivElement;
      fill.style.width = `${progress}%`;
      statusEl.className = `status status-${status}`;
      const statusText: Record<string, string> = {
        pending: '等待',
        converting: '转换中',
        done: '完成',
        error: '失败',
      };
      statusEl.textContent = statusText[status] || status;
    }
  });
}

function addFiles(files: string[]): void {
  ncmFiles = [...new Set([...ncmFiles, ...files])];
  renderFileList();
}

function resetBatchProgress(): void {
  doneCount = 0;
  totalFiles = ncmFiles.length;
  batchProgress.style.display = 'block';
  batchFill.style.width = '0%';
  batchPct.textContent = '0%';
  batchLabel.textContent = `0 / ${totalFiles}`;
}

function updateBatchProgress(): void {
  const pct = totalFiles > 0 ? Math.round((doneCount / totalFiles) * 100) : 0;
  batchFill.style.width = `${pct}%`;
  batchPct.textContent = `${pct}%`;
  batchLabel.textContent = `${doneCount} / ${totalFiles}`;
}

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer?.files || [])
    .filter((f) => f.name.toLowerCase().endsWith('.ncm'))
    .map((f) => f.path);
  if (files.length > 0) addFiles(files);
});

// Button clicks
selectFilesBtn.addEventListener('click', async () => {
  const files = await api.selectFiles();
  if (files.length > 0) addFiles(files);
});

dropSelectBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const files = await api.selectFiles();
  if (files.length > 0) addFiles(files);
});

selectFolderBtn.addEventListener('click', async () => {
  const files = await api.selectFolder();
  if (files.length > 0) addFiles(files);
});

dropFolderBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const files = await api.selectFolder();
  if (files.length > 0) addFiles(files);
});

selectOutputBtn.addEventListener('click', async () => {
  const dir = await api.selectOutputDir();
  if (dir) outputDirInput.value = dir;
});

openOutputBtn.addEventListener('click', () => {
  if (currentOutputDir) api.openOutputDir(currentOutputDir);
});

dropZone.addEventListener('click', async () => {
  const files = await api.selectFiles();
  if (files.length > 0) addFiles(files);
});

startBtn.addEventListener('click', async () => {
  if (isConverting || ncmFiles.length === 0) return;
  isConverting = true;
  startBtn.disabled = true;
  startBtn.textContent = '转换中...';
  openOutputBtn.style.display = 'none';

  currentOutputDir = outputDirInput.value || '';
  const concurrency = parseInt(concurrencySelect.value, 10);

  resetBatchProgress();
  await api.convertFiles(ncmFiles, currentOutputDir, concurrency);
});

// Window controls
document.getElementById('btnMinimize')?.addEventListener('click', () => api.windowMinimize());
document.getElementById('btnMaximize')?.addEventListener('click', () => api.windowMaximize());
document.getElementById('btnClose')?.addEventListener('click', () => api.windowClose());

// IPC listeners
api.onConvertProgress((data: unknown) => {
  const d = data as { id: string; progress: number; status: string; totalProgress?: number };
  const statusMap: Record<string, string> = {
    pending: 'pending',
    converting: 'converting',
    done: 'done',
    error: 'error',
  };
  updateFileProgress(d.id, d.progress, statusMap[d.status] || d.status);

  if (d.totalProgress !== undefined) {
    batchFill.style.width = `${d.totalProgress}%`;
    batchPct.textContent = `${d.totalProgress}%`;
  }
});

api.onConvertComplete((data: unknown) => {
  const d = data as { id: string };
  doneCount++;
  updateFileProgress(d.id, 100, 'done');
  updateBatchProgress();
});

api.onConvertError((data: unknown) => {
  const d = data as { id: string };
  doneCount++;
  updateFileProgress(d.id, 0, 'error');
  updateBatchProgress();
});

api.onConvertAllDone(() => {
  isConverting = false;
  startBtn.disabled = false;
  startBtn.textContent = '开始转换';
  batchLabel.textContent = `全部完成 (${doneCount}/${totalFiles})`;
  batchFill.style.width = '100%';
  batchPct.textContent = '100%';
  if (currentOutputDir) openOutputBtn.style.display = 'inline-block';
});
