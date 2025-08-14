// Глобальное состояние приложения и кэш изображений

export const state = {
    tabs: [],
    allTabs: [],
    activeTabId: localStorage.getItem('activeTabId') || null,
    isInitialLoad: true,
    isLoading: false,
    db: null,
    worker: null,
    uploadedImages: [],

    // Управление галереей
    scrollAnimationEnabled: false,
    imageSpacing: 0,

    // Платформа
    isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
    silentMode: true,

    // Сохранённые настройки
    get savedSettings() {
        return localStorage.getItem('paginationSettings');
    },

    dom: null, // сюда положим ссылки на DOM в main.js

    // Кеш для изображений вкладок
    imageCache: {
        maxSize: 3,
        cache: new Map(),
        add(tabId, images) {
            if (this.cache.size >= this.maxSize) {
                const oldestKey = this.cache.keys().next().value;
                this.cache.delete(oldestKey);
            }
            this.cache.set(tabId, images);
        },
        get(tabId) { return this.cache.get(tabId); },
        remove(tabId) { this.cache.delete(tabId); },
        clear() { this.cache.clear(); }
    }
};
