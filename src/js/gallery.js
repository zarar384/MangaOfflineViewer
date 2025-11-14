// Галерея: рендер изображений, стили, главная страница, очистка

import { state } from './state.js';
import { clearImagesDB, getPreviewByTabId } from './db.js';
import { renderPaginationControls } from './pagination.js';
import { loadTabs, tabPreviewClicked, closeTab } from './tabs.js';

// объект состояния галереи
const galleryState = { images: [] };

export function updateGalleryStyles() {
    const gallery = state.dom.imageGallery;
    if (!gallery) return;

    if (state.scrollAnimationEnabled) {
        gallery.style.scrollSnapType = 'y mandatory';
        gallery.querySelectorAll('.gallery-image-container').forEach(container => {
            container.style.scrollSnapAlign = 'start';
        });
    } else {
        gallery.style.scrollSnapType = 'none';
    }

    gallery.querySelectorAll('.gallery-image-container').forEach(container => {
        container.style.padding = state.imageSpacing + 'px 0';
    });
}

export function renderGallery(images) {
    const imageGallery = state.dom.imageGallery;
    imageGallery.innerHTML = '';

    const initialLoadCount = state.isIOS ? 2 : 5;
    galleryState.images = images;

    images.forEach((src, index) => {
        const container = document.createElement('div');
        container.className = 'gallery-image-container';
        container.style.padding = state.imageSpacing + 'px 0';
        container.dataset.index = index;
        container.id = `img-container-${index}`;
        imageGallery.appendChild(container);
    });

    loadImagesInBatches(0, Math.min(initialLoadCount, images.length));

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const container = entry.target;
                const index = parseInt(container.dataset.index);
                loadImage(container, index);
            }
        });
    }, {
        rootMargin: state.isIOS ? '50px 0px' : '300px 0px',
        threshold: state.isIOS ? 0.2 : 0.01
    });

    document.querySelectorAll('.gallery-image-container').forEach(container => {
        observer.observe(container);
    });

    updateGalleryStyles();
}

function loadImagesInBatches(startIndex, endIndex) {
    for (let i = startIndex; i < endIndex; i++) {
        const container = document.getElementById(`img-container-${i}`);
        if (container && !container.querySelector('img')) {
            loadImage(container, i);
        }
    }
}

function loadImage(container, index) {
    if (container.querySelector('img') || !galleryState.images[index]) return;

    const img = document.createElement('img');
    img.className = 'gallery-image';
    img.loading = 'lazy';
    img.src = galleryState.images[index];
    img.alt = `Изображение ${index + 1}`;

    if (state.isIOS) {
        img.style.transform = 'translateZ(0)';
        img.decode().catch(() => { });
    }

    img.onerror = () => {
        img.style.border = '2px solid red';
    };

    container.appendChild(img);
}

// Обработчик скролла для подстраховки
let lastScrollPos = 0;
let scrollCheckTimeout;

export function bindGalleryScrollCheck() {
    const imageGallery = state.dom.imageGallery;
    imageGallery.addEventListener('scroll', () => {
        clearTimeout(scrollCheckTimeout);
        scrollCheckTimeout = setTimeout(() => {
            const currentScrollPos = imageGallery.scrollTop;
            if (Math.abs(currentScrollPos - lastScrollPos) > 50) {
                checkVisibleImages();
            }
            lastScrollPos = currentScrollPos;
        }, 100);
    });
}

function checkVisibleImages() {
    const container = state.dom.imageGallery.getBoundingClientRect();
    document.querySelectorAll('.gallery-image-container').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top >= container.top - 500 && rect.bottom <= container.bottom + 500) {
            const index = parseInt(el.dataset.index);
            if (!el.querySelector('img')) {
                loadImage(el, index);
            }
        }
    });
}

export function showGalleryPage() {
    state.dom.homePage.style.display = 'none';
    state.dom.imageGallery.style.display = 'block';
}

// создание кнопок очистки IndexedDB и imageCache (только на главной)
export function createClearButtons(isNotHomePage) {
    const galleryControls = state.dom.galleryControls;
    const isHidden = isControlPanelHidden();

    const existingButtons = galleryControls.querySelectorAll('.clear-btn');
    existingButtons.forEach(button => button.remove());

    if (isNotHomePage) return;

    const existingButton = galleryControls.querySelector('.export-btn');
    if (existingButton) {
        existingButton.remove();
    }

    // Кнопка очистки LocalDb
    const clearLocalDbBtn = document.createElement('button');
    clearLocalDbBtn.className = 'clear-btn';
    clearLocalDbBtn.innerHTML = 'Очистить IndexedDB';
    clearLocalDbBtn.style.display = isHidden ? 'none' : 'flex';
    clearLocalDbBtn.addEventListener('click', async () => {
        try {
            await clearImagesDB();
            state.tabs = [];
            localStorage.setItem('mhtmlViewerTabs', JSON.stringify(state.tabs));
            alert('LocalDb очищен');
            // перезагрузка вкладок с настройками по умолчанию
            loadTabs();
        } catch (e) {
            console.error('Ошибка при очистке LocalDb:', e);
        }
    });

    // Кнопка очистки imageCache
    const clearImageCacheBtn = document.createElement('button');
    clearImageCacheBtn.className = 'clear-btn';
    clearImageCacheBtn.innerHTML = 'Очистить ImageCache';
    clearImageCacheBtn.style.display = isHidden ? 'none' : 'flex';
    clearImageCacheBtn.addEventListener('click', () => {
        state.imageCache.clear();
        alert('imageCache очищен');
    });

    galleryControls.appendChild(clearLocalDbBtn);
    galleryControls.appendChild(clearImageCacheBtn);
}

export function isControlPanelHidden() {
    const controlGroup = state.dom.galleryControls.querySelectorAll('.control-group');
    return controlGroup && controlGroup[1]?.style?.display === 'none';
}

// Главная страница: превью вкладок, плавное появление, пагинация
export async function showHomePage() {

    state.dom.homePage.innerHTML = `
        <div class="loading-container">
            <div class="loading">Загрузка галереи</div>
        </div>
    `;

    state.dom.imageGallery.style.display = 'none';
    state.dom.homePage.style.display = 'grid';

    try {
        const paginationSettings = JSON.parse(localStorage.getItem('paginationSettings') || '{"page":1,"perPage":10}');
        const { page, perPage } = paginationSettings;

        createClearButtons(false);

        const tempContainer = document.createElement('div');
        tempContainer.style.display = 'none';
        document.body.appendChild(tempContainer);

        for (const tab of state.tabs) {
            if (tab.isReadOnly) continue;

            const tabPreview = document.createElement('div');
            tabPreview.className = 'tab-preview';
            tabPreview.dataset.tabId = tab.id;

            let previewImg = '';
            if (tab.isFile) {
                try {
                    const preview = await getPreviewByTabId(tab.id);
                    previewImg = preview
                        ? `<img src="${preview}" class="tab-preview-image" loading="lazy">`
                        : `<div class="tab-preview-image no-preview">Нет превью</div>`;
                } catch (e) {
                    console.warn('Не удалось загрузить превью:', e);
                    previewImg = '<div class="tab-preview-image no-preview">Ошибка загрузки</div>';
                }
            } else if (tab.isImageTab && tab.images?.length > 0) {
                previewImg = `<img src="${tab.images[0].data}" class="tab-preview-image" loading="lazy">`;
            } else {
                previewImg = '<div class="tab-preview-image no-preview">Нет превью</div>';
            }

            tabPreview.innerHTML = `
                ${previewImg}
                <div class="tab-preview-title">${tab.name}</div>
                <div class="tab-preview-close">&times;</div>
            `;

            tabPreview.addEventListener('click', (e) => tabPreviewClicked(e, tab, page, perPage));

            const closeBtn = tabPreview.querySelector('.tab-preview-close');
            closeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await closeTab(tab.id);
                const savedTabs = localStorage.getItem('mhtmlViewerTabs');
                if (savedTabs) {
                    const allTabs = JSON.parse(savedTabs);
                    loadTabs(page, perPage);
                }
            });

            tempContainer.appendChild(tabPreview);
        }

        state.dom.homePage.style.opacity = '0';
        state.dom.homePage.innerHTML = '';

        while (tempContainer.firstChild) {
            state.dom.homePage.appendChild(tempContainer.firstChild);
        }
        tempContainer.remove();

        setTimeout(() => {
            state.dom.homePage.style.transition = 'opacity 0.5s ease';
            state.dom.homePage.style.opacity = '1';
        }, 50);

        const savedTabs = localStorage.getItem('mhtmlViewerTabs');
        if (savedTabs) {
            const allTabs = JSON.parse(savedTabs);
            renderPaginationControls(allTabs.length, page, perPage, async (newPage, newPerPage) => {
                loadTabs(newPage, newPerPage);
            });
        }

    } catch (error) {
        console.error('Ошибка при загрузке домашней страницы:', error);
        state.dom.homePage.innerHTML = `
            <div class="error-message">
                Произошла ошибка при загрузке. Пожалуйста, попробуйте снова.
            </div>
        `;
    }
}

