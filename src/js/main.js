import { getDom } from './domElements.js';
import { state } from './state.js';
import { loadTabs, renderTabs, showTabForm, bindTabFileChooser } from './tabs.js';
import { renderGallery, updateGalleryStyles, bindGalleryScrollCheck, showHomePage } from './gallery.js';
import { handleImageFiles, showImageTabForm, hideImageTabForm, createImageTab } from './imageUpload.js';
import { setSakuraEnabled, toggleSakuraAnimation } from './sakura.js';

document.addEventListener('DOMContentLoaded', async function () {
    // Платформа и задержки для Safari
    window.DELAY_FOR_SAFARI = state.isIOS ? 120 : 0;

    // Service Worker
    // по изменению FILES_TO_CACHE - поменяй версию CACHE_NAME для очистки старого кэша
    const CACHE_NAME = 'manga-viewer-v0.026';

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register(`/service-worker.js?cacheName=${CACHE_NAME}`)
            .then((reg) => console.log('Service Worker registered:', reg.scope))
            .catch((err) => {
                if (!state.silentMode) {
                    console.error('Service Worker registration failed:', err);
                }
            });
    }

    // worker init
    if (!state.worker) {
         state.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    }
    const HOST = import.meta.env.VITE_HOST;
    const PORT = import.meta.env.VITE_PORT;
    state.worker.postMessage({ type: 'init', host: HOST, port: PORT });
    
    if (state.isIOS) {
        // упрощение обработки touch-событий
        document.documentElement.style.touchAction = 'manipulation';
    }

    // DOM references
    state.dom = getDom();

    // Обработчики элементов управления галереей
    state.dom.toggleBtn.addEventListener('click', function () {
        const elementsToToggle = [
            ...document.querySelectorAll('.control-group:not(:first-child)'),
            ...document.querySelectorAll('.clear-btn'),
            ...document.querySelectorAll('.export-btn')
        ].filter(el => el.parentNode === state.dom.galleryControls);

        const isHidden = elementsToToggle[0]?.style.display === 'none';

        elementsToToggle.forEach(element => {
            element.style.display = isHidden ? 'flex' : 'none';
        });

        if (state.dom.hideText && state.dom.showText) {
            state.dom.hideText.style.display = isHidden ? 'inline' : 'none';
            state.dom.showText.style.display = isHidden ? 'none' : 'inline';
        }
    });

    state.dom.animationToggle.addEventListener('change', function () {
        state.scrollAnimationEnabled = this.checked;
        updateGalleryStyles();
    });

    state.dom.spacingSlider.addEventListener('input', function () {
        state.imageSpacing = parseInt(this.value);
        state.dom.spacingValue.textContent = state.imageSpacing + 'px';
        updateGalleryStyles();
    });

    state.dom.sakuraToggle.addEventListener('change', function () {
        setSakuraEnabled(this.checked);
    });

    // Обработчики главной навигации
    state.dom.homeBtn.addEventListener('click', function () {
        state.activeTabId = null;
        localStorage.removeItem('activeTabId');

        const savedPage = localStorage.getItem('currentPageBeforeNavigation');
        const savedSettings = localStorage.getItem('paginationSettings');

        if (savedPage) {
            const { page, perPage } = JSON.parse(savedPage);
            loadTabs(page, perPage);
        } else if (savedSettings) {
            const { page, perPage } = JSON.parse(savedSettings);
            loadTabs(page, perPage);
        } else {
            loadTabs();
        }
    });

    // Галерея: подстраховка подзагрузки
    bindGalleryScrollCheck();

    // Обработчики форм вкладок
    state.dom.addTabBtn.addEventListener('click', showTabForm);
    state.dom.addImageTabBtn.addEventListener('click', showImageTabForm);
    bindTabFileChooser();

    state.dom.cancelImageBtn.addEventListener('click', hideImageTabForm);
    state.dom.createImageTabBtn.addEventListener('click', () => createImageTab(true));

    // Drag and drop для изображений
    state.dom.imageDropZone.addEventListener('click', () => state.dom.imageUploadInput.click());
    state.dom.imageDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        state.dom.imageDropZone.classList.add('drag-over');
    });
    state.dom.imageDropZone.addEventListener('dragleave', () => {
        state.dom.imageDropZone.classList.remove('drag-over');
    });
    state.dom.imageDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        state.dom.imageDropZone.classList.remove('drag-over');
        handleImageFiles(e.dataTransfer.files);
    });
    state.dom.imageUploadInput.addEventListener('change', (e) => {
        handleImageFiles(e.target.files);
        e.target.value = '';
    });

    // Закрытие форм по клику на оверлей
    state.dom.tabForm.addEventListener('click', (e) => {
        if (e.target === state.dom.tabForm) state.dom.tabForm.classList.remove('active');
    });
    state.dom.imageTabForm.addEventListener('click', (e) => {
        if (e.target === state.dom.imageTabForm) state.dom.imageTabForm.classList.remove('active');
    });

    // Очистка ресурсов при выгрузке (iOS)
    function cleanupBeforeUnload() {
        if (state.isIOS) {
            window.galleryImages = null;
            if (state.worker) {
                state.worker.terminate();
            }
            document.querySelectorAll('img').forEach(img => {
                if (img.src.startsWith('blob:')) {
                    URL.revokeObjectURL(img.src);
                }
            });
        }
    }
    window.addEventListener('beforeunload', cleanupBeforeUnload);
    window.addEventListener('pagehide', cleanupBeforeUnload);

    // Инициализация приложения с учётом сохранённых настроек пагинации
    const initialSettings = state.savedSettings
        ? JSON.parse(state.savedSettings)
        : { page: 1, perPage: 10 };

    await loadTabs(initialSettings.page, initialSettings.perPage).then(() => {
        if (state.activeTabId) {
            const tabExists = state.tabs.some(tab => tab.id === state.activeTabId);
            if (tabExists) {
                import('./tabs.js').then(({ displayTabContent }) => displayTabContent(state.activeTabId));
            } else {
                state.activeTabId = null;
                localStorage.removeItem('activeTabId');
            }
        }
    });
});
