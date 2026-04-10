let items = [];
let currentIdx = 0;

async function load() {
    const res = await chrome.runtime.sendMessage({ action: 'getFullPrefixes' });
    items = res.prefixItems || [];
    currentIdx = res.currentIndex || 0;
    render();
}

function render() {
    const container = document.getElementById('prefixList');
    if (!items.length) {
        container.innerHTML = '<div style="text-align:center;padding:20px;opacity:0.6;">暂无前缀，请添加</div>';
        return;
    }
    container.innerHTML = items.map((item, idx) => `
        <div class="prefix-item ${idx === currentIdx ? 'current' : ''}" data-idx="${idx}">
            <div style="flex:1; min-width:0;">
                <div class="prefix-url" title="${escapeHtml(item.url)}">${escapeHtml(shorten(item.url, 70))}</div>
                <div class="note">
                    <span>${item.note ? `📝 ${escapeHtml(item.note)}` : '无备注'}</span>
                    <button class="btn-icon edit-note" data-idx="${idx}" title="编辑备注">✏️</button>
                    <button class="btn-icon set-current" data-idx="${idx}" title="设为当前线路">⭐</button>
                </div>
            </div>
            <button class="btn-icon delete-item" data-idx="${idx}" title="删除">🗑️</button>
        </div>
    `).join('');

    // 事件绑定
    document.querySelectorAll('.edit-note').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            const newNote = prompt('编辑备注（留空清除）:', items[idx].note || '');
            if (newNote !== null) {
                await chrome.runtime.sendMessage({ action: 'updatePrefixNote', index: idx, note: newNote.trim() });
                await load();
            }
        });
    });
    document.querySelectorAll('.set-current').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            await chrome.runtime.sendMessage({ action: 'setCurrentIndex', index: idx });
            await load();
            showToast(`已切换至第 ${idx+1} 条`);
        });
    });
    document.querySelectorAll('.delete-item').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            if (items.length === 1) { showToast('至少保留一条前缀', 'error'); return; }
            if (confirm('删除此前缀？')) {
                const res = await chrome.runtime.sendMessage({ action: 'removePrefix', index: idx });
                if (res.success) await load();
                else showToast(res.error || '删除失败', 'error');
            }
        });
    });
}

async function addPrefix() {
    const input = document.getElementById('newPrefix');
    const url = input.value.trim();
    if (!url) return showToast('请输入前缀地址', 'error');
    if (!url.startsWith('http')) return showToast('需以 http:// 或 https:// 开头', 'error');
    const res = await chrome.runtime.sendMessage({ action: 'addPrefix', prefix: url });
    if (res.success) {
        input.value = '';
        await load();
        showToast('添加成功');
    } else {
        showToast(res.error || '添加失败', 'error');
    }
}

async function importTxt(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        const lines = e.target.result.split(/\r?\n/).filter(l => l.trim() && l.startsWith('http'));
        if (!lines.length) return showToast('文件中无有效前缀', 'error');
        const res = await chrome.runtime.sendMessage({ action: 'batchAddPrefixes', urls: lines });
        if (res.success) {
            await load();
            showToast(`导入 ${res.added} 条新前缀`);
        } else showToast('导入失败', 'error');
    };
    reader.readAsText(file);
}

async function exportTxt() {
    const urls = items.map(i => i.url).join('\n');
    const blob = new Blob([urls], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prefixes_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已导出');
}

async function fullBackup() {
    const data = await chrome.runtime.sendMessage({ action: 'exportAllData' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prefix_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已备份');
}

function restoreBackup(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const res = await chrome.runtime.sendMessage({ action: 'importAllData', data });
            if (res.success) {
                await load();
                showToast('恢复成功');
            } else showToast(res.error || '恢复失败', 'error');
        } catch { showToast('备份文件解析失败', 'error'); }
    };
    reader.readAsText(file);
}

// 深色模式
function initTheme() {
    const dark = localStorage.getItem('popupTheme') !== 'light';
    if (!dark) document.body.classList.add('light');
}
function toggleTheme() {
    document.body.classList.toggle('light');
    localStorage.setItem('popupTheme', document.body.classList.contains('light') ? 'light' : 'dark');
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, function(m){ return m==='&'?'&amp;':m==='<'?'&lt;':'&gt;'; }); }
function shorten(s, len) { return s.length > len ? s.slice(0,len-3)+'...' : s; }

let toastTimer;
function showToast(msg, type='') {
    let t = document.getElementById('toastMsg');
    if (!t) {
        t = document.createElement('div');
        t.id = 'toastMsg';
        t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#000c;color:#FFD966;padding:6px 16px;border-radius:40px;font-size:13px;backdrop-filter:blur(8px);z-index:9999';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.style.opacity = '0', 1800);
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    load();
    document.getElementById('addBtn').addEventListener('click', addPrefix);
    document.getElementById('importTxtBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('exportTxtBtn').addEventListener('click', exportTxt);
    document.getElementById('backupBtn').addEventListener('click', fullBackup);
    document.getElementById('restoreBtn').addEventListener('click', () => document.getElementById('restoreFile').click());
    document.getElementById('importFile').addEventListener('change', e => { if(e.target.files[0]) importTxt(e.target.files[0]); e.target.value=''; });
    document.getElementById('restoreFile').addEventListener('change', e => { if(e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value=''; });
    document.getElementById('newPrefix').addEventListener('keypress', e => { if(e.key === 'Enter') addPrefix(); });
    document.getElementById('themeToggle').addEventListener('click', () => { toggleTheme(); showToast('主题已切换'); });
});