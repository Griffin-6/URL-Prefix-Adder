// ==================== 前缀管理器（兼容旧字符串数组，支持备注） ====================
class PrefixManager {
    constructor() {
        this.prefixItems = [];    // 存储 { url, note }
        this.currentIndex = 0;
        this.loadData();
    }

    async loadData() {
        const data = await chrome.storage.sync.get(['prefixItems', 'currentIndex']);
        let raw = data.prefixItems;
        // 迁移旧数据（字符串数组 -> 对象数组）
        if (!raw || !Array.isArray(raw)) {
            const old = await chrome.storage.sync.get('prefixes');
            if (old.prefixes && Array.isArray(old.prefixes)) {
                raw = old.prefixes.map(url => ({ url, note: '' }));
                await chrome.storage.sync.remove('prefixes');
            } else {
                raw = [];
            }
        }
        this.prefixItems = raw;
        this.currentIndex = data.currentIndex || 0;
        if (this.currentIndex >= this.prefixItems.length && this.prefixItems.length) {
            this.currentIndex = 0;
        }
        await this.saveData();
    }

    async saveData() {
        await chrome.storage.sync.set({
            prefixItems: this.prefixItems,
            currentIndex: this.currentIndex
        });
    }

    // 获取当前前缀字符串（兼容旧 content.js）
    getCurrentPrefix() {
        return this.prefixItems[this.currentIndex]?.url || '';
    }

    // 获取前缀字符串数组（兼容旧 getAllPrefixes）
    getPrefixStrings() {
        return this.prefixItems.map(item => item.url);
    }

    // 获取完整对象数组
    getPrefixItems() {
        return [...this.prefixItems];
    }

    async rotatePrefix() {
        if (this.prefixItems.length === 0) return '';
        this.currentIndex = (this.currentIndex + 1) % this.prefixItems.length;
        await this.saveData();
        return this.getCurrentPrefix();
    }

    async addPrefix(url, note = '') {
        url = url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            throw new Error('前缀必须以 http:// 或 https:// 开头');
        }
        if (!this.prefixItems.some(item => item.url === url)) {
            this.prefixItems.push({ url, note });
            await this.saveData();
        }
    }

    async removePrefix(index) {
        if (this.prefixItems.length <= 1) {
            throw new Error('至少保留一条前缀');
        }
        if (index >= 0 && index < this.prefixItems.length) {
            this.prefixItems.splice(index, 1);
            if (this.currentIndex >= this.prefixItems.length) {
                this.currentIndex = Math.max(0, this.prefixItems.length - 1);
            }
            await this.saveData();
        }
    }

    async updatePrefixNote(index, note) {
        if (index >= 0 && index < this.prefixItems.length) {
            this.prefixItems[index].note = note || '';
            await this.saveData();
        }
    }

    async setCurrentIndex(index) {
        if (index >= 0 && index < this.prefixItems.length) {
            this.currentIndex = index;
            await this.saveData();
        }
    }

    async batchAddPrefixes(urls) {
        let added = 0;
        for (let u of urls) {
            u = u.trim();
            if (u && (u.startsWith('http://') || u.startsWith('https://')) && !this.prefixItems.some(i => i.url === u)) {
                this.prefixItems.push({ url: u, note: '' });
                added++;
            }
        }
        if (added) await this.saveData();
        return added;
    }
}

const prefixManager = new PrefixManager();

// ==================== 右键菜单：隐藏/显示悬浮球 ====================
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'toggleFloatingBall',
        title: '隐藏/显示悬浮球',
        contexts: ['action']
    });
    // 初始化历史/收藏
    chrome.storage.local.get(['history', 'favorites'], (res) => {
        if (!res.history) chrome.storage.local.set({ history: [] });
        if (!res.favorites) chrome.storage.local.set({ favorites: [] });
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'toggleFloatingBall' && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleFloatingToolbar' });
    }
});

// ==================== 备份/恢复所有数据 ====================
async function exportAllData() {
    const sync = await chrome.storage.sync.get(['prefixItems', 'currentIndex']);
    const local = await chrome.storage.local.get(['history', 'favorites']);
    return { version: '2.0', ...sync, ...local };
}

async function importAllData(data) {
    if (data?.version !== '2.0') throw new Error('不支持的备份文件版本');
    await chrome.storage.sync.set({
        prefixItems: data.prefixItems || [],
        currentIndex: data.currentIndex || 0
    });
    await chrome.storage.local.set({
        history: data.history || [],
        favorites: data.favorites || []
    });
    await prefixManager.loadData(); // 重新加载
}

// ==================== 消息监听（保留所有原有接口） ====================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        switch (request.action) {
            // ----- 原有前缀相关（兼容 content.js）-----
            case 'getCurrentPrefix':
                sendResponse({ prefix: prefixManager.getCurrentPrefix() });
                break;
            case 'rotatePrefix':
                sendResponse({ prefix: await prefixManager.rotatePrefix() });
                break;
            case 'getCurrentTab':
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                sendResponse(tab);
                break;
            case 'openUrl':
                if (request.inCurrentTab && sender.tab) {
                    await chrome.tabs.update(sender.tab.id, { url: request.url });
                } else {
                    await chrome.tabs.create({ url: request.url });
                }
                sendResponse({ success: true });
                break;
            case 'addPrefix':
                try {
                    await prefixManager.addPrefix(request.prefix);
                    sendResponse({ success: true });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                break;
            case 'removePrefix':
                try {
                    await prefixManager.removePrefix(request.index);
                    sendResponse({ success: true });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                break;
            case 'getAllPrefixes':
                sendResponse({
                    prefixes: prefixManager.getPrefixStrings(),
                    currentIndex: prefixManager.currentIndex
                });
                break;
            case 'closeCurrentTab':
                if (sender.tab) await chrome.tabs.remove(sender.tab.id);
                sendResponse({ success: true });
                break;

            // ----- 新增管理接口（popup 使用）-----
            case 'getFullPrefixes':
                sendResponse({
                    prefixItems: prefixManager.getPrefixItems(),
                    currentIndex: prefixManager.currentIndex
                });
                break;
            case 'updatePrefixNote':
                await prefixManager.updatePrefixNote(request.index, request.note);
                sendResponse({ success: true });
                break;
            case 'setCurrentIndex':
                await prefixManager.setCurrentIndex(request.index);
                sendResponse({ success: true });
                break;
            case 'batchAddPrefixes':
                sendResponse({ success: true, added: await prefixManager.batchAddPrefixes(request.urls) });
                break;
            case 'exportAllData':
                sendResponse(await exportAllData());
                break;
            case 'importAllData':
                try {
                    await importAllData(request.data);
                    sendResponse({ success: true });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
                break;

            // ----- 历史/收藏（原样保留）-----
            case 'getHistory': {
                const { history } = await chrome.storage.local.get('history');
                sendResponse(history || []);
                break;
            }
            case 'getFavorites': {
                const { favorites } = await chrome.storage.local.get('favorites');
                sendResponse(favorites || []);
                break;
            }
            case 'recordHistory': {
                const { url, title } = request;
                if (!url || url === 'undefined') {
                    sendResponse({ success: false });
                    return;
                }
                const { history } = await chrome.storage.local.get('history');
                let newHistory = history || [];
                newHistory = newHistory.filter(item => item.url !== url);
                newHistory.unshift({ url, title: title || url, timestamp: Date.now() });
                if (newHistory.length > 3) newHistory = newHistory.slice(0, 3);
                await chrome.storage.local.set({ history: newHistory });
                sendResponse({ success: true });
                break;
            }
            case 'addFavorite': {
                const { url, title } = request;
                if (!url || url === 'undefined') {
                    sendResponse({ success: false });
                    return;
                }
                const { favorites } = await chrome.storage.local.get('favorites');
                let fav = favorites || [];
                if (!fav.some(item => item.url === url)) {
                    fav.unshift({ url, title: title || url, timestamp: Date.now() });
                    await chrome.storage.local.set({ favorites: fav });
                }
                sendResponse({ success: true });
                break;
            }
            case 'removeFavorite': {
                const { url } = request;
                const { favorites } = await chrome.storage.local.get('favorites');
                let fav = favorites || [];
                fav = fav.filter(item => item.url !== url);
                await chrome.storage.local.set({ favorites: fav });
                sendResponse({ success: true });
                break;
            }

            default:
                sendResponse({ error: '未知操作' });
        }
    })();
    return true;
});