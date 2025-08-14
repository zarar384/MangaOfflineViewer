// Вкладки: загрузка, отрисовка, переходы, сохранение

import { state } from './state.js';
import { initDB, saveFileToDB, readFromIndexedDB, deleteImagesByTabId } from './db.js';
import { renderPaginationControls } from './pagination.js';
import { renderGallery, showGalleryPage, showHomePage, createClearButtons, isControlPanelHidden } from './gallery.js';
import { saveAsMHTML } from './exportMHTML.js';

export async function loadTabs(page = 1, perPage = 10) {
    if (state.isLoading) return;
    state.isLoading = true;

    try {
        await initDB();
        const savedTabs = localStorage.getItem('mhtmlViewerTabs');

        if (savedTabs) {
            state.allTabs = JSON.parse(savedTabs);

            const startIndex = (page - 1) * perPage;
            const endIndex = startIndex + perPage;
            state.tabs = state.allTabs.slice(startIndex, endIndex);

            localStorage.setItem('paginationSettings', JSON.stringify({ page, perPage }));

            if (state.activeTabId && state.isInitialLoad && state.allTabs.some(tab => tab.id === state.activeTabId)) {
                await displayTabContent(state.activeTabId);
                state.isInitialLoad = false;
            } else {
                await Promise.all([
                    renderTabs(),
                    showHomePage()
                ]);
                state.isInitialLoad = false;
            }

            renderPaginationControls(state.allTabs.length, page, perPage, (p, pp) => loadTabs(p, pp));
        } else {
            addTab('Пример', 'about:blank');
        }
    } finally {
        state.isLoading = false;
    }
}

export function renderTabs() {
    const { tabsContainer, addTabBtn, addImageTabBtn } = state.dom;
    tabsContainer.innerHTML = '';

    // Автоматически подбираем ширину вкладок
    const maxTabsWithoutScroll = 8;
    const minTabWidth = 80;
    const maxTabWidth = 200;
    const tabCount = state.tabs.length;
    let tabWidth = maxTabWidth;

    if (tabCount > maxTabsWithoutScroll) {
        const availableWidth = tabsContainer.clientWidth - addTabBtn.offsetWidth - addImageTabBtn.offsetWidth - 20;
        tabWidth = Math.max(minTabWidth, availableWidth / maxTabsWithoutScroll);
    }

    const showCloseBtn = tabWidth > 100;

    state.tabs.forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tab.id === state.activeTabId ? 'active' : ''}`;
        tabElement.dataset.tabId = tab.id;
        tabElement.style.maxWidth = `${tabWidth}px`;
        tabElement.innerHTML = `
            <span>${tab.name}</span>
            ${showCloseBtn ? '<div class="tab-close">&times;</div>' : ''}
        `;

        tabElement.addEventListener('click', function (e) {
            if ((!showCloseBtn || !e.target.classList.contains('tab-close')) &&
                !this.classList.contains('loading')) {
                displayTabContent(tab.id);
            }
        });

        if (showCloseBtn) {
            const closeBtn = tabElement.querySelector('.tab-close');
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                closeTab(tab.id);
            });
        }

        tabsContainer.appendChild(tabElement);
    });
}

export async function addTab(name, url, isFile = false, fileData = null) {
    const newTab = {
        id: 'tab-' + Date.now(),
        name: name,
        url: url,
        isFile: isFile,
        isReadOnly: false
    };

    state.allTabs.push(newTab);
    localStorage.setItem('mhtmlViewerTabs', JSON.stringify(state.allTabs));

    if (isFile && fileData) {
        await saveFileToDB(newTab.id, fileData);
    }

    const settings = JSON.parse(localStorage.getItem('paginationSettings') || '{"page":1,"perPage":10}');
    loadTabs(settings.page, settings.perPage);

    await displayTabContent(newTab.id);
}

export async function closeTab(tabId) {
    if (state.allTabs.length <= 0) return;
    state.imageCache.remove(tabId);

    const tabIndex = state.allTabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    if (state.allTabs[tabIndex].isFile) {
        await deleteImagesByTabId(tabId);
    }

    state.allTabs.splice(tabIndex, 1);
    localStorage.setItem('mhtmlViewerTabs', JSON.stringify(state.allTabs));

    const settings = JSON.parse(localStorage.getItem('paginationSettings') || '{"page":1,"perPage":10}');
    loadTabs(settings.page, settings.perPage);
}

export function saveTabs() {
    const tabsToSave = state.allTabs.filter(tab => tab.isReadOnly == false).map(tab => ({
        id: tab.id,
        name: tab.name,
        isFile: tab.isFile || false,
        url: tab.url,
        isImageTab: tab.isImageTab || false,
        images: tab.images || [],
        isReadOnly: tab.isReadOnly
    }));
    localStorage.setItem('mhtmlViewerTabs', JSON.stringify(tabsToSave));
}

export async function displayTabContent(tabId, fromHomePage = false) {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;

    state.dom.imageGallery.innerHTML = '<div class="loading">Загрузка...</div>';

    const oldPagination = document.querySelector('.pagination-controls');
    if (oldPagination) oldPagination.remove();

    state.activeTabId = tabId;
    localStorage.setItem('activeTabId', tabId);
    renderTabs();

    const tabElement = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
    if (tabElement && fromHomePage) {
        tabElement.classList.add('loading');
    }

    showGalleryPage();

    try {
        addExportButton(tab);
        createClearButtons(true);

        if (tab.isImageTab) {
            const images = tab.images.map(img => img.data);
            renderGallery(images);
        } else if (tab.isFile) {
            const cachedImages = state.imageCache.get(tabId);
            if (cachedImages) {
                renderGallery(cachedImages);
                return;
            }

            const fileData = await readFromIndexedDB(tab.id);
            if (!fileData) throw new Error("Данные не найдены в IndexedDB");
            if (!fileData.images || fileData.images.length === 0) throw new Error("Не удалось извлечь изображения");

            state.imageCache.add(tab.id, fileData.images);
            renderGallery(fileData.images);
        } else {
            state.dom.imageGallery.innerHTML = `<iframe src="${tab.url}" style="width:100%;height:100%;border:none;"></iframe>`;
        }
    } catch (error) {
        console.error('Ошибка отображения:', error);
        state.dom.imageGallery.innerHTML = `
            <div class="error">
                <h3>Ошибка</h3>
                <p>${error.message}</p>
            </div>
        `;
    } finally {
        if (tabElement && fromHomePage) tabElement.classList.remove('loading');
    }
}

// Кнопки экспорта MHTML (только для readonly)
function addExportButton(tab) {
    const galleryControls = state.dom.galleryControls;
    const existingButton = galleryControls.querySelector('.export-btn');
    if (existingButton) existingButton.remove();

    if (!tab.isReadOnly) return;

    const saveMhtmlBtn = document.createElement('button');
    saveMhtmlBtn.className = 'export-btn mhtml';
    saveMhtmlBtn.innerHTML = '💾 Сохранить как MHTML';
    saveMhtmlBtn.style.display = isControlPanelHidden() ? 'none' : 'flex';
    saveMhtmlBtn.addEventListener('click', () => saveAsMHTML(tab));

    galleryControls.appendChild(saveMhtmlBtn);
}

// главная превью — клик по карточке
export function tabPreviewClicked(e, tab, page, perPage) {
    if (!e.target.classList.contains('tab-preview-close')) {
        localStorage.setItem('currentPageBeforeNavigation', JSON.stringify({ page, perPage }));
        displayTabContent(tab.id, true);
    }
}

// формы вкладок (MHTML)
let currentFile = null;

export function showTabForm() {
    state.dom.tabNameInput.value = '';
    state.dom.tabUrlInput.value = '';
    currentFile = null;
    state.dom.tabForm.classList.add('active');
    state.dom.tabNameInput.focus();
}

export function hideTabForm() {
    state.dom.tabForm.classList.remove('active');
}

export function bindTabFileChooser() {
    state.dom.tabUrlInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
            currentFile = e.target.files[0];
            if (!state.dom.tabNameInput.value.trim()) {
                state.dom.tabNameInput.value = currentFile.name.replace(/\.[^/.]+$/, "");
            }
        }
    });

    state.dom.saveBtn.addEventListener('click', function () {
        const name = state.dom.tabNameInput.value.trim();

        if (!name) {
            alert('Пожалуйста, укажите название вкладки');
            return;
        }
        if (!currentFile) {
            alert('Пожалуйста, выберите MHTML файл');
            return;
        }

        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                await addTab(name, '', true, e.target.result);
                import('./utils.js').then(({ updateProgress }) => updateProgress(0));
                hideTabForm();
            } catch (error) {
                console.error('Ошибка добавления вкладки:', error);
                alert('Ошибка при добавлении файла');
            }
        };
        reader.readAsArrayBuffer(currentFile);
    });

    state.dom.cancelBtn.addEventListener('click', hideTabForm);
}
