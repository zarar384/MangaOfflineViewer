// Drag&Drop, ZIP-обработка, превью и создание вкладки с изображениями

import { state } from './state.js';
import { isImageFile, extractNumber } from './utils.js';
import JSZip from "https://cdn.skypack.dev/jszip@3.10.1";
import { saveTabs, displayTabContent } from './tabs.js';

export async function handleImageFiles(files) {
    const images = Array.from(files).filter(f => isImageFile(f.name));
    const zips = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.zip'));

    images.sort((a, b) => extractNumber(a.name) - extractNumber(b.name));

    for (const file of images) {
        loadImageFile(file);
    }

    for (const file of zips) {
        await loadZipFile(file);
    }
}

function loadImageFile(file) {
    const imgUrl = URL.createObjectURL(file);
    const imageData = {
        name: file.name,
        data: imgUrl,
        isGif: file.type === 'image/gif'
    };
    state.uploadedImages.push(imageData);
    renderPreviewImage(imageData, state.uploadedImages.length - 1);
}

async function loadZipFile(file) {
    const loadingIndicator = document.createElement('span');
    loadingIndicator.className = 'zip-loading';
    loadingIndicator.textContent = 'Обработка ZIP...';
    state.dom.imageDropZone.appendChild(loadingIndicator);

    try {
        const zip = new JSZip();
        const content = await zip.loadAsync(file);

        let loadedCount = 0;
        const imageEntries = [];

        content.forEach(function (relativePath, zipEntry) {
            if (!zipEntry.dir && isImageFile(zipEntry.name)) {
                imageEntries.push(zipEntry);
            }
        });

        imageEntries.sort((a, b) => {
            const numA = extractNumber(a.name);
            const numB = extractNumber(b.name);
            return numA - numB;
        });

        for (const zipEntry of imageEntries) {
            try {
                const fileData = await zipEntry.async('blob');
                const imgUrl = URL.createObjectURL(fileData);

                const imageData = {
                    name: zipEntry.name,
                    data: imgUrl,
                    isGif: zipEntry.name.toLowerCase().endsWith('.gif')
                };

                state.uploadedImages.push(imageData);
                renderPreviewImage(imageData, state.uploadedImages.length - 1);
                loadedCount++;
            } catch (error) {
                console.error('Ошибка загрузки изображения из ZIP:', zipEntry.name, error);
            }
        }

        loadingIndicator.textContent = `Загружено ${loadedCount} изображений`;
        setTimeout(() => loadingIndicator.remove(), 3000);
    } catch (error) {
        console.error('Ошибка обработки ZIP-архива:', error);
        loadingIndicator.textContent = 'Ошибка обработки ZIP';
        loadingIndicator.style.color = '#e74c3c';
    }
}

function renderPreviewImage(imageData, index) {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'preview-image';

    const img = document.createElement('img');
    img.src = imageData.data;

    const removeBtn = document.createElement('div');
    removeBtn.className = 'preview-image-remove';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.uploadedImages.splice(index, 1);
        previewDiv.remove();
    });

    previewDiv.appendChild(img);
    previewDiv.appendChild(removeBtn);
    state.dom.previewImages.appendChild(previewDiv);
}

// Создание вкладки с изображениями
export async function createImageTab(isReadOnly) {
    const name = state.dom.imageTabNameInput.value.trim();
    if (!name) {
        alert('Пожалуйста, укажите название вкладки');
        return;
    }

    if (isReadOnly && state.uploadedImages.length === 0) {
        alert('Пожалуйста, добавьте хотя бы одно изображение');
        return;
    }

    let newTab = {
        id: 'img-tab-' + Date.now(),
        name: name,
        isImageTab: true,
        images: state.uploadedImages,
        isReadOnly: true
    };

    const existingTabIndex = state.allTabs.findIndex(tab => tab.name === newTab.name);

    if (existingTabIndex !== -1) {
        newTab = state.allTabs[existingTabIndex];
        newTab.isReadOnly = isReadOnly;
        newTab.images = state.uploadedImages;
        newTab.isImageTab = isReadOnly;
        newTab.isFile = !isReadOnly;
    } else {
        state.allTabs.push(newTab);
        state.tabs.push(newTab);
    }

    saveTabs();
    const { renderTabs } = await import('./tabs.js');
    renderTabs();
    await displayTabContent(newTab.id);
    hideImageTabForm();
}

// Показать/скрыть формы
export function showImageTabForm() {
    state.dom.imageTabNameInput.value = '';
    state.uploadedImages = [];
    state.dom.previewImages.innerHTML = '';
    state.dom.imageTabForm.classList.add('active');
    state.dom.imageTabNameInput.focus();
}

export function hideImageTabForm() {
    state.dom.imageTabForm.classList.remove('active');
}
