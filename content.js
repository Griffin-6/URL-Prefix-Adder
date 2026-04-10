class FloatingToolbar {
    constructor() {
        this.container = null;
        this.popup = null;
        this.currentPopupType = null;
        this.init();
    }

    async initHideState() {
        const { hidden } = await chrome.storage.local.get('floatingToolbarHidden');
        if (hidden && this.container) {
            this.container.style.display = 'none';
        }
    }

    async toggleVisibility() {
        if (!this.container) return;
        const isHidden = this.container.style.display === 'none';
        const newState = !isHidden;
        this.container.style.display = newState ? 'none' : 'flex';
        await chrome.storage.local.set({ floatingToolbarHidden: newState });
    }

    async init() {
        // 不再加载 Font Awesome
        await this.loadConfig();
        this.createToolbar();
        this.bindEvents();
    }
    
    createToolbar() {
        this.container = document.createElement('div');
        this.container.id = 'floating-toolbar';
        this.container.className = 'floating-toolbar';
    
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'toolbar-buttons';
        buttonsContainer.innerHTML = `
            <div class="toolbar-item" data-action="backToTop" title="返回顶部">
                <span class="icon-symbol">⬆️</span>
                <span class="tooltip">返回顶部</span>
            </div>
            <div class="toolbar-item" data-action="favorites" title="我的收藏">
                <span class="icon-symbol">⭐</span>
                <span class="tooltip">我的收藏</span>
            </div>
            <div class="toolbar-item" data-action="history" title="历史记录">
                <span class="icon-symbol">🕒</span>
                <span class="tooltip">历史记录</span>
            </div>
            <div class="toolbar-item" data-action="changeLine" title="换线">
                <span class="icon-symbol">🔄</span>
                <span class="tooltip">换线</span>
            </div>
            <div class="toolbar-item" data-action="play" title="打开">
                <span class="icon-symbol">📺</span>
                <span class="tooltip">打开</span>
            </div>
        `;
    
        const toggleBtn = document.createElement('div');
        toggleBtn.className = 'toolbar-item toggle-btn';
        toggleBtn.setAttribute('data-action', 'toggle');
        toggleBtn.title = '展开工具栏';
        toggleBtn.innerHTML = `
            <span class="toggle-symbol">↑</span>
            <span class="tooltip">展开</span>
        `;
    
        this.container.appendChild(buttonsContainer);
        this.container.appendChild(toggleBtn);
        document.body.appendChild(this.container);
    }
    
    bindEvents() {
        this.container.addEventListener('click', (e) => {
            const item = e.target.closest('.toolbar-item');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'toggle') {
                this.toggleToolbar();
            } else {
                this[action]?.();
            }
        });
    
        document.addEventListener('click', (e) => {
            if (this.popup && !this.popup.contains(e.target) && !e.target.closest('.toolbar-item[data-action="history"], .toolbar-item[data-action="favorites"]')) {
                this.closePopup();
            }
        });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'toggleFloatingToolbar') {
                this.toggleVisibility();
                sendResponse({ success: true });
            }
            return true;
        });
    }
    
    toggleToolbar() {
        const isExpanded = this.container.classList.contains('expanded');
        this.container.classList.toggle('expanded');
        const toggleSymbol = this.container.querySelector('.toggle-symbol');
        const tooltip = this.container.querySelector('.toggle-btn .tooltip');
        if (isExpanded) {
            // 当前展开 -> 变为收起状态
            toggleSymbol.textContent = '↑';
            tooltip.textContent = '展开';
        } else {
            // 当前收起 -> 变为展开状态
            toggleSymbol.textContent = '↓';
            tooltip.textContent = '收起';
        }
    }
    
    // ========== 按钮动作 ==========
    async play() {
        await this.copyCurrentUrl();
        await this.openWithCurrentPrefix();
    }
    
    async changeLine() {
        await this.copyCurrentUrl();
        await this.openWithNextPrefix();
    }
    
backToTop() {
    setTimeout(() => {
        // 强制所有可能的滚动对象到顶部
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        // 再次尝试常见容器
        document.querySelector('html, body, .iqp-scrollbar, main')?.scrollTo?.(0, 0);
    }, 10);
}
    
    async history() {
        if (this.currentPopupType === 'history') {
            this.closePopup();
            return;
        }
        this.closePopup();
        const data = await chrome.runtime.sendMessage({ action: 'getHistory' });
        this.showPopup('history', data);
    }
    
    async favorites() {
        if (this.currentPopupType === 'favorites') {
            this.closePopup();
            return;
        }
        this.closePopup();
        const data = await chrome.runtime.sendMessage({ action: 'getFavorites' });
        this.showPopup('favorites', data);
    }
    
    async copyCurrentUrl() {
        const tab = await chrome.runtime.sendMessage({ action: 'getCurrentTab' });
        await navigator.clipboard.writeText(tab.url);
    }
    
    async openWithCurrentPrefix() {
        const tab = await chrome.runtime.sendMessage({ action: 'getCurrentTab' });
        const all = await chrome.runtime.sendMessage({ action: 'getAllPrefixes' });
        const prefixes = all.prefixes || [];
        const current = prefixes[all.currentIndex] || '';
        if (!current) {
            this.showFeedback('无线路');
            return;
        }
        let original = this.extractOriginalUrl(tab.url, prefixes);
        const newUrl = current + encodeURIComponent(original);
        chrome.runtime.sendMessage({ action: 'openUrl', url: newUrl, inCurrentTab: false });
        chrome.runtime.sendMessage({
            action: 'recordHistory',
            url: newUrl,
            title: '网址页面'
        });
        setTimeout(() => this.closeCurrentTab(), 500);
    }
    
    async openWithNextPrefix() {
        await chrome.runtime.sendMessage({ action: 'rotatePrefix' });
        await this.openWithCurrentPrefix();
    }
    
    extractOriginalUrl(url, prefixes) {
        for (const p of prefixes) {
            if (url.startsWith(p)) {
                try { return decodeURIComponent(url.substring(p.length)); } catch { return url.substring(p.length); }
            }
        }
        return url;
    }
    
    async closeCurrentTab() {
        chrome.runtime.sendMessage({ action: 'closeCurrentTab' });
    }
    
    // ========== 浮层管理 ==========
    showPopup(type, items) {
        const btn = this.container.querySelector(`[data-action="${type}"]`);
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
    
        this.popup = document.createElement('div');
        this.popup.className = `toolbar-popup ${type}-popup`;
    
        let left = rect.left - 270;
        let top = rect.top;
    
        if (left < 5) left = 5;
        if (left + 260 > window.innerWidth) left = window.innerWidth - 270;
        if (top + 350 > window.innerHeight) top = window.innerHeight - 360;
        if (top < 5) top = 5;
    
        this.popup.style.left = left + 'px';
        this.popup.style.top = top + 'px';
    
        if (type === 'history') {
            this.popup.innerHTML = this.renderHistory(items);
        } else {
            this.popup.innerHTML = this.renderFavorites(items);
        }
    
        document.body.appendChild(this.popup);
        this.currentPopupType = type;
    
        this.popup.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-fav')) {
                e.stopPropagation();
                const url = e.target.dataset.url;
                if (url) {
                    chrome.runtime.sendMessage({ action: 'removeFavorite', url: url }, () => {
                        this.refreshPopup('favorites');
                    });
                }
                return;
            }
            if (e.target.classList.contains('add-current')) {
                this.addCurrentToFavorites();
                return;
            }
            const item = e.target.closest('.popup-item');
            if (item) {
                const url = item.dataset.url;
                if (url) window.open(url, '_blank');
            }
        });
    }
    
    renderHistory(items) {
        if (!items.length) return '<div class="popup-empty">暂无最近观看</div>';
        return items.map(item => `
            <div class="popup-item" data-url="${item.url}">
                <div class="popup-title">${this.escapeHtml(item.title)}</div>
                <div class="popup-url">${this.escapeHtml(item.url)}</div>
            </div>
        `).join('');
    }
    
    renderFavorites(items) {
        const validItems = items.filter(item => item.url && item.url !== 'undefined');
        let html = '';
        if (validItems.length) {
            html = validItems.map(item => `
                <div class="popup-item" data-url="${item.url}">
                    <div class="popup-title">${this.escapeHtml(item.title)}</div>
                    <div class="popup-url">${this.escapeHtml(item.url)}</div>
                    <span class="delete-fav" data-url="${item.url}">×</span>
                </div>
            `).join('');
        } else {
            html = '<div class="popup-empty">暂无收藏</div>';
        }
        html += '<div class="popup-footer"><button class="add-current">➕ 收藏当前页面</button></div>';
        return html;
    }
    
    async addCurrentToFavorites() {
        const tab = await chrome.runtime.sendMessage({ action: 'getCurrentTab' });
        chrome.runtime.sendMessage({
            action: 'addFavorite',
            url: tab.url,
            title: tab.title || tab.url
        }, () => {
            this.refreshPopup('favorites');
        });
    }
    
    async refreshPopup(type) {
        if (this.currentPopupType !== type) return;
        const data = await chrome.runtime.sendMessage({ action: type === 'history' ? 'getHistory' : 'getFavorites' });
        this.popup.innerHTML = type === 'history' ? this.renderHistory(data) : this.renderFavorites(data);
    }
    
    closePopup() {
        if (this.popup) {
            this.popup.remove();
            this.popup = null;
            this.currentPopupType = null;
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showFeedback(msg) {
        const el = document.createElement('div');
        el.className = 'floating-feedback';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1500);
    }
    
    async loadConfig() {
        return new Promise(resolve => chrome.storage.sync.get('floatingBallConfig', (r) => {
            this.config = r.floatingBallConfig || {};
            resolve();
        }));
    }

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new FloatingToolbar());
} else {
    new FloatingToolbar();
}