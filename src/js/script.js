document.addEventListener('DOMContentLoaded', function () {
    // Основные элементы DOM
    const tabsContainer = document.getElementById('tabsContainer');
    const addTabBtn = document.getElementById('addTabBtn');
    const addImageTabBtn = document.getElementById('addImageTabBtn');
    const tabForm = document.getElementById('tabForm');
    const imageTabForm = document.getElementById('imageTabForm');
    const homeBtn = document.getElementById('homeBtn');
    const imageGallery = document.getElementById('imageGallery');
    const homePage = document.getElementById('homePage');

    // Элементы форм
    const tabNameInput = document.getElementById('tabName');
    const tabUrlInput = document.getElementById('tabUrl');
    const saveBtn = document.getElementById('saveBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const imageTabNameInput = document.getElementById('imageTabName');
    const imageDropZone = document.getElementById('imageDropZone');
    const imageUploadInput = document.getElementById('imageUploadInput');
    const previewImages = document.getElementById('previewImages');
    const cancelImageBtn = document.getElementById('cancelImageBtn');
    const createImageTabBtn = document.getElementById('createImageTabBtn');

    // Переменные для управления галереей
    let scrollAnimationEnabled = false;
    let imageSpacing = 0;

    // Получаем элементы управления галереей
    // кнопка скрытия
    const toggleBtn = document.getElementById('toggleMenuBtn');
    const hideText = toggleBtn.querySelector('.hide-text');
    const showText = toggleBtn.querySelector('.show-text');
    const galleryControls = document.querySelector('.gallery-controls');

    // элементы управления
    const animationToggle = document.getElementById('animationToggle');
    const spacingSlider = document.getElementById('spacingSlider');
    const spacingValue = document.getElementById('spacingValue');
    const sakuraToggle = document.getElementById('sakuraToggle');

    // Состояние приложения
    let tabs = [];
    let activeTabId = null;
    let currentFile = null;
    let db = null;
    let uploadedImages = [];

    // Кеш для хранения загруженных изображений
    const imageCache = {
        maxSize: 3, // Максимальное количество вкладок в кеше
        cache: new Map(),

        add: function (tabId, images) {
            if (this.cache.size >= this.maxSize) {
                const oldestKey = this.cache.keys().next().value;
                this.cache.delete(oldestKey);
            }
            this.cache.set(tabId, images);
        },

        get: function (tabId) {
            return this.cache.get(tabId);
        },

        remove: function (tabId) {
            this.cache.delete(tabId);
        }
    };

    // Загрузка вкладок из localStorage
    async function loadTabs() {
        await initDB();
        const savedTabs = localStorage.getItem('mhtmlViewerTabs');
        if (savedTabs) {
            tabs = JSON.parse(savedTabs);
            renderTabs();
            showHomePage();
        } else {
            // Добавляем демо-вкладку при первом запуске
            addTab('Пример', 'about:blank');
        }
    }

    // Обработчики событий элементов управления галереей
    toggleBtn.addEventListener('click', function() {
        const elementsToToggle = [
            ...document.querySelectorAll('.control-group:not(:first-child)'),
            ...document.querySelectorAll('.clear-btn'),
            ...document.querySelectorAll('.export-btn')
        ].filter(el => el.parentNode === galleryControls);
        
        const isHidden = elementsToToggle[0]?.style.display === 'none';
        
        elementsToToggle.forEach(element => {
            element.style.display = isHidden ? 'flex' : 'none';
        });
        
        hideText.style.display = isHidden ? 'inline' : 'none';
        showText.style.display = isHidden ? 'none' : 'inline';
    });

    animationToggle.addEventListener('change', function () {
        scrollAnimationEnabled = this.checked;
        updateGalleryStyles();
    });

    spacingSlider.addEventListener('input', function () {
        imageSpacing = parseInt(this.value);
        spacingValue.textContent = imageSpacing + 'px';
        updateGalleryStyles();
    });

    sakuraToggle.addEventListener('change', function () {
        sakuraAnimationEnabled = this.checked;
        toggleSakuraAnimation();
    });

    // Функция для обновления стилей галереи
    function updateGalleryStyles() {
        const gallery = document.getElementById('imageGallery');

        if (scrollAnimationEnabled) {
            gallery.style.scrollSnapType = 'y mandatory';
            gallery.querySelectorAll('.gallery-image-container').forEach(container => {
                container.style.scrollSnapAlign = 'start';
            });
        } else {
            gallery.style.scrollSnapType = 'none';
        }

        gallery.querySelectorAll('.gallery-image-container').forEach(container => {
            container.style.padding = imageSpacing + 'px 0';
        });
    }

    // Сохранение вкладок в localStorage
    function saveTabs() {
        const tabsToSave = tabs.filter(tab => tab.isReadOnly == false).map(tab => ({
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


    // Отрисовка вкладок в шапке
    function renderTabs() {
        tabsContainer.innerHTML = '';

        // Автоматически подбираем ширину вкладок
        const maxTabsWithoutScroll = 8;
        const minTabWidth = 80;
        const maxTabWidth = 200;
        const tabCount = tabs.length;
        let tabWidth = maxTabWidth;

        if (tabCount > maxTabsWithoutScroll) {
            const availableWidth = tabsContainer.clientWidth - addTabBtn.offsetWidth - addImageTabBtn.offsetWidth - 20;
            tabWidth = Math.max(minTabWidth, availableWidth / maxTabsWithoutScroll);
        }

        const showCloseBtn = tabWidth > 100;

        tabs.forEach(tab => {
            const tabElement = document.createElement('div');
            tabElement.className = `tab ${tab.id === activeTabId ? 'active' : ''}`;
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

    // Добавление новой вкладки
    async function addTab(name, url, isFile = false, fileData = null) {
        const newTab = {
            id: 'tab-' + Date.now(),
            name: name,
            url: url,
            isFile: isFile,
            isReadOnly: false
        };

        tabs.push(newTab);

        if (isFile && fileData) {
            await saveFileToDB(newTab.id, fileData);
        }

        saveTabs();
        renderTabs();
        await displayTabContent(newTab.id);
    }

    // Закрытие вкладки
    async function closeTab(tabId) {
        if (tabs.length <= 0) return;
        imageCache.remove(tabId);

        const tabIndex = tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return;

        // Удаляем связанные данные из IndexedDB
        if (tabs[tabIndex].isFile) {
            await deleteImagesByTabId(tabId);
        }

        tabs.splice(tabIndex, 1);
        saveTabs();

        if (tabId === activeTabId && tabs.length > 0) {
            const newActiveTabIndex = Math.min(tabIndex, tabs.length - 1);
            displayTabContent(tabs[newActiveTabIndex].id);
        }
        else if (tabs.length == 0) {
            loadTabs();
        }
        else {
            renderTabs();
        }
    }

    // Инициализация базы данных
    async function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('MHTMLViewerDB', 3);

            request.onerror = (event) => reject(event.target.error);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files', { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains('images')) {
                    const imageStore = db.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
                    imageStore.createIndex('tabId', 'tabId', { unique: false });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
        });
    }

    // Сохранение файла в IndexedDB
    async function saveFileToDB(id, fileData) {
        const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
        let currentChunk = 0;

        const arrayBuffer = fileData instanceof ArrayBuffer
            ? fileData
            : await fileData.buffer;

        const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

        let fullText = '';

        // читаем чанки
        while (currentChunk < totalChunks) {
            const start = currentChunk * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);

            const chunkData = arrayBuffer.slice(start, end);
            let chunkText = new TextDecoder('utf-8').decode(chunkData);
            fullText += chunkText;

            currentChunk++;
            updateProgress((currentChunk / totalChunks) * 50); // 50% на чтение
            await new Promise(r => setTimeout(r, 0)); // ччть подождать для UI
        }

        fullText = decodeQuotedPrintable(fullText);

        const images = await parseHTMLInChunks(fullText, updateProgress);

        // превью из первого изображения
        let preview = null;
        const firstImage = images.find(img => img.startsWith('data:image/'));
        if (firstImage) {
            try {
                preview = await createThumbnail(firstImage);
            } catch (e) {
                console.warn('Не удалось создать превью:', e);
            }
        }

        return await saveToIndexedDB(id, preview, images)
    }

    async function saveToIndexedDB(id, preview, images) {
        return new Promise(async (resolve, reject) => {
                const CHUNK_SIZE = 5; // 5 изображений за раз
                let allImages = [];
                
                const existingData = await new Promise((res) => {
                    const transaction = db.transaction(['files'], 'readonly');
                    const store = transaction.objectStore('files');
                    const request = store.get(id);
                    request.onsuccess = () => res(request.result);
                    request.onerror = () => res(null);
                });
    
                if (existingData) {
                    allImages = existingData.images || [];
                }
    
                for (let i = 0; i < images.length; i += CHUNK_SIZE) {
                    const chunk = images.slice(i, i + CHUNK_SIZE);
                    allImages.push(...chunk);
    
                    await new Promise((chunkResolve, chunkReject) => {
                        const transaction = db.transaction(['files'], 'readwrite');
                        const store = transaction.objectStore('files');
    
                        const data = { 
                            id, 
                            preview: preview, 
                            images: allImages 
                        };
    
                        const request = store.put(data);
                        request.onerror = (e) => chunkReject(e.target.error);
                        request.onsuccess = () => chunkResolve();
                    });
    
                    await new Promise(r => setTimeout(r, 50)); // пауза для Safari
                }
    
                resolve();
        });
    }
    async function parseHTMLInChunks(fullText, updateProgress) {
        try {
            const doc = new DOMParser().parseFromString(fullText, 'text/html');
            const pageDivs = doc.querySelectorAll('div[id^="page-"]');
            const images = [];
            let processedCount = 0;
            const totalPages = pageDivs.length;
    
            // лимит времени выполнения для iOS
            const startTime = performance.now();
            const TIME_LIMIT = 1000; 
    
            for (let i = 0; i < totalPages; i++) {
                const div = pageDivs[i];
                const imgs = div.querySelectorAll('img[src]');
    
                for (let j = 0; j < imgs.length; j++) {
                    if (imgs[j].src) {
                        images.push(imgs[j].src);
                    }
                }
    
                processedCount++;
                
                const currentProgress = 50 + (processedCount / totalPages) * 50;
                updateProgress(currentProgress); 
                await new Promise(r => setTimeout(r, 0));
    
                // для сафари на ипхоне нужно дать паузу 
                if (performance.now() - startTime > TIME_LIMIT) {
                    await new Promise(resolve => {
                        setTimeout(() => {
                            resolve();
                            if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
                                return new Promise(r => setTimeout(r, 100));
                            }
                        }, 0);
                    });
                }
            }
    
            updateProgress(100);
            await new Promise(r => setTimeout(r, 50));
            
            return images;
    
        } catch (error) {
            console.error('Error in parseHTMLInChunks:', error);
            if (!navigator.userAgent.match(/iPhone|iPad|iPod|Android/i)) {
                const errorWindow = window.open('', '_blank');
                errorWindow.document.write(`
                    <h1>Error Details</h1>
                    <p><strong>Message:</strong> ${error.message}</p>
                    <p><strong>Stack:</strong></p>
                    <pre>${error.stack}</pre>
                    <p><strong>HTML Size:</strong> ${fullText?.length || 'unknown'} bytes</p>
                `);
            }
            
            throw error; 
        }
    }

    // Получение файла из IndexedDB
    async function getImagesByTabId(tabId) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['files'], 'readonly');
            const store = transaction.objectStore('files');
            const request = store.get(tabId);

            request.onerror = (event) => reject(event.target.error);
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
        });
    }


    // Удаление файла из IndexedDB
    async function deleteImagesByTabId(tabId) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');

            const request = store.delete(tabId);

            request.onerror = (event) => reject(event.target.error);
            request.onsuccess = () => resolve();
        });
    }

    // Обновление превью в IndexedDB
    async function updatePreviewInDB(tabId, preview) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['files'], 'readwrite');
            const store = transaction.objectStore('files');

            const getRequest = store.get(tabId);

            getRequest.onsuccess = function () {
                const data = getRequest.result;
                if (!data) return reject('Запись не найдена');

                data.preview = preview;
                const putRequest = store.put(data);

                putRequest.onsuccess = resolve;
                putRequest.onerror = reject;
            };

            getRequest.onerror = reject;
        });
    }

    async function clearImagesDB() {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            const clearRequest = store.clear();

            clearRequest.onerror = (event) => reject(event.target.error);
            clearRequest.onsuccess = () => resolve();
        });
    }

    function updateProgress(progress) {
        const progressBar = document.getElementById('progressBar');
        if (progressBar) {
            progressBar.style.boxShadow = progress == 100 ? '0 2px 5px rgba(255, 107, 158, 0.5)': "";
            progressBar.style.background = progress == 100 ?'var(--secondary-color)': "green";
            progressBar.style.width = `${progress}%`;
            progressBar.textContent = `${Math.floor(progress)}%`;
        }
    };
    // Отображение содержимого вкладки
    async function displayTabContent(tabId, fromHomePage = false) {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;

        activeTabId = tabId;
        renderTabs();

        const tabElement = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
        if (tabElement && fromHomePage) {
            tabElement.classList.add('loading');
        }

        imageGallery.innerHTML = '<div class="loading">Загрузка...</div>';
        showGalleryPage();

        try {
            addExportButton(tab);
            createClearButtons(true);
            if (tab.isImageTab) {
                // Обработка вкладки с изображениями
                const images = tab.images.map(img => img.data);
                renderGallery(images);
            } else if (tab.isFile) {
                // Обработка MHTML файла
                const cachedImages = imageCache.get(tabId);
                if (cachedImages) {
                    renderGallery(cachedImages);
                    return;
                }

                const fileData = await getImagesByTabId(tab.id);
                if (!fileData || !fileData.images || fileData.images.length === 0) {
                    throw new Error("Не удалось извлечь изображения");
                }

                imageCache.add(tab.id, fileData.images);
                renderGallery(fileData.images)
            } else {
                // Обработка обычных URL
                imageGallery.innerHTML = `<iframe src="${tab.url}" style="width:100%;height:100%;border:none;"></iframe>`;
            }
        } catch (error) {
            console.error('Ошибка отображения:', error);
            imageGallery.innerHTML = `
                <div class="error">
                    <h3>Ошибка</h3>
                    <p>${error.message}</p>
                </div>
            `;
        } finally {
            if (tabElement && fromHomePage) {
                tabElement.classList.remove('loading');
            }
        }
    }

    // Обновленная функция для добавления кнопок экспорта
    function addExportButton(tab) {
        const existingButton = galleryControls.querySelector('.export-btn');
        if (existingButton) {
            existingButton.remove();
        }

        if (!tab.isReadOnly) return;

        // Кнопка сохранения как MHTML
        const saveMhtmlBtn = document.createElement('button');
        saveMhtmlBtn.className = 'export-btn mhtml';
        saveMhtmlBtn.innerHTML = '💾 Сохранить как MHTML';
        saveMhtmlBtn.style.display = isConrolPanelHidden() ? 'none' : 'flex';
        saveMhtmlBtn.addEventListener('click', () => saveAsMHTML(tab));

        // Добавляем кнопку в блок управления галереей
        galleryControls.appendChild(saveMhtmlBtn);
    }

    async function createMHTMLForParser(tab) {
        try {
            let htmlContent = `<!DOCTYPE html>\n<html>\n<head>\n<title>${tab.name}</title>\n</head>\n<body>\n`;

            for (let i = 0; i < tab.images.length; i++) {
                const img = tab.images[i];
                let imgData = img.data;

                if (imgData.startsWith('blob:')) {
                    const response = await fetch(imgData);
                    const blob = await response.blob();

                    const mimeType = 'image/png'; // По умолчанию, если MIME не указан, используем 'image/png'

                    // Конвертируем blob в data:image
                    imgData = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(`data:${mimeType};base64,${reader.result.split(',')[1]}`);
                        reader.readAsDataURL(blob);
                    });
                }

                // Добавляем изображения в HTML контент
                htmlContent += `<div id="page-${i + 1}">\n`;
                htmlContent += `<img src="${imgData}" alt="Image ${i + 1}">\n`;
                htmlContent += `</div>\n\n`;
            }

            htmlContent += `</body>\n</html>`;

            // Кодируем HTML в quoted-printable
            const encodedContent = encodeQuotedPrintable(htmlContent);

            // Формируем MHTML
            let mhtml = `From: <Saved by MHTML Viewer>\n`;
            mhtml += `Subject: ${tab.name}\n`;
            mhtml += `MIME-Version: 1.0\n`;
            mhtml += `Content-Type: text/html; charset=utf-8\n`;
            mhtml += `Content-Transfer-Encoding: quoted-printable\n\n`;
            mhtml += encodedContent;

            return { mhtml, name: tab.name };

        } catch (error) {
            console.error('Error creating MHTML:', error);
            throw error;
        }
    }

    function encodeQuotedPrintable(str) {
        return str.replace(/[^\x20-\x7E]/g, function (chr) {
            return '=' + chr.charCodeAt(0).toString(16).toUpperCase();
        }).replace(/ /g, '=20');
    }

    // Функция сохранения MHTML
    async function saveAsMHTML(tab) {
        try {
            let previewData = null;
            // const firstDataImage = tab.images.find(img => img.data.startsWith('data:image/'));
            // if (firstDataImage) {
            //     try {
            //         previewData = await createSimpleThumbnail(firstDataImage.data);
            //     } catch (e) {
            //         console.warn('Не удалось создать превью:', e);
            //     }
            // }

            const { mhtml, name } = await createMHTMLForParser(tab);
            const arrayBuffer = new TextEncoder().encode(mhtml);

            await saveFileToDB(tab.id, arrayBuffer);

            const blob = new Blob([mhtml], { type: 'message/rfc822' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mhtml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => URL.revokeObjectURL(url), 100);
            createImageTab(false)

            return { preview: previewData, name };

        } catch (error) {
            console.error('Error saving MHTML:', error);
            alert('Ошибка при сохранении MHTML: ' + error.message);
            return null;
        }
    }

    // Парсинг MHTML файла
    async function parseMHTMLFile(tabId, fileData) {
        try {
            // Преобразуем arrayBuffer в текст mhtmlText
            const arrayBuffer = fileData instanceof ArrayBuffer ?
                fileData :
                fileData.buffer;

            let mhtmlText = new TextDecoder('utf-8').decode(arrayBuffer);
            mhtmlText = decodeQuotedPrintable(mhtmlText);

            // Парсинг HTML и извлечение изображений
            const doc = new DOMParser().parseFromString(mhtmlText, 'text/html');
            const images = [];
            const pageDivs = doc.querySelectorAll('div[id^="page-"]');

            pageDivs.forEach(div => {
                const imgs = div.querySelectorAll('img[src]');
                imgs.forEach(img => {
                    if (img.src) images.push(img.src);
                });
            });

            // Создаем превью, если его нет
            if (images.length > 0) {
                try {
                    const firstImage = images.find(img => img.startsWith('data:image/'));
                    if (firstImage) {
                        const preview = await createThumbnail(firstImage);
                        await updatePreviewInDB(tabId, preview);
                    }
                } catch (e) {
                    console.warn('Не удалось создать превью:', e);
                }
            }

            renderGallery(images);
            return images;
        } catch (error) {
            console.error('Ошибка парсинга MHTML:', error);
            throw error;
        }
    }

    // Декодирование quoted-printable
    function decodeQuotedPrintable(str) {
        return str
            .replace(/=\r?\n/g, '')
            .replace(/=([0-9A-F]{2})/g, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16)))
            .replace(/\s+/g, ' ');
    }

    // Создание миниатюры изображения
    async function createThumbnail(imageSrc) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';

            img.onload = function () {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Устанавливаем размер превью
                const maxSize = 300;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width *= maxSize / height;
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };

            img.onerror = function () {
                resolve(null);
            };

            img.src = imageSrc;
        });
    }

    // Отображение галереи изображений с виртуализацией
    function renderGallery(images) {
        imageGallery.innerHTML = '';

        // Сохраняем ссылки на все изображения
        window.galleryImages = images;

        // Создаем контейнеры для всех изображений
        images.forEach((src, index) => {
            const container = document.createElement('div');
            container.className = 'gallery-image-container';
            container.style.padding = imageSpacing + 'px 0';
            container.dataset.index = index;
            container.id = `img-container-${index}`;
            imageGallery.appendChild(container);
        });

        // Инициализируем Intersection Observer
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const container = entry.target;
                    const index = parseInt(container.dataset.index);
                    loadImage(container, index);
                }
            });
        }, {
            rootMargin: '300px 0px 300px 0px', // Загружаем заранее
            threshold: 0.01
        });

        // Наблюдаем за всеми контейнерами
        document.querySelectorAll('.gallery-image-container').forEach(container => {
            observer.observe(container);
        });

        // Загружаем первые 5 изображений сразу
        for (let i = 0; i < Math.min(5, images.length); i++) {
            const container = document.getElementById(`img-container-${i}`);
            if (container) loadImage(container, i);
        }
        updateGalleryStyles();
    }

    function loadImage(container, index) {
        // Если изображение уже загружено - пропускаем
        if (container.querySelector('img') || !window.galleryImages[index]) return;

        const img = document.createElement('img');
        img.className = 'gallery-image';
        img.loading = 'lazy';
        img.src = window.galleryImages[index];
        img.alt = `Изображение ${index + 1}`;

        img.onerror = () => {
            img.style.border = '2px solid red';
        };

        container.appendChild(img);
    }

    // Обработчик скролла для подстраховки
    let lastScrollPos = 0;
    let scrollCheckTimeout;

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

    function checkVisibleImages() {
        const container = imageGallery.getBoundingClientRect();
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

    // Отображение главной страницы
    async function showHomePage() {
        imageGallery.style.display = 'none';
        homePage.style.display = 'grid';
        homePage.innerHTML = '';

        // Добавляем кнопки для очистки IndexedDb и imageCache
        createClearButtons(false);

        for (const tab of tabs) {
            if (tab.isReadOnly) continue;
            const tabPreview = document.createElement('div');
            tabPreview.className = 'tab-preview';
            tabPreview.dataset.tabId = tab.id;

            let previewImg = '';
            if (tab.isFile) {
                try {
                    const fileData = await getImagesByTabId(tab.id);
                    if (fileData?.preview) {
                        previewImg = `<img src="${fileData.preview}" class="tab-preview-image">`;
                    } else {
                        previewImg = `<div class="tab-preview-image" style="background:#eee;display:flex;align-items:center;justify-content:center;">Нет превью</div>`;
                    }
                } catch (e) {
                    console.warn('Не удалось загрузить превью:', e);
                }
            } else if (tab.isImageTab && tab.images?.length > 0) {
                previewImg = `<img src="${tab.images[0].data}" class="tab-preview-image">`;
            } else {
                previewImg = `<div class="tab-preview-image" style="background:#eee;display:flex;align-items:center;justify-content:center;">Нет превью</div>`;
            }

            tabPreview.innerHTML = `
                ${previewImg}
                <div class="tab-preview-title">${tab.name}</div>
                <div class="tab-preview-close">&times;</div>
            `;

            tabPreview.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tab-preview-close')) {
                    displayTabContent(tab.id, true);
                }
            });

            const closeBtn = tabPreview.querySelector('.tab-preview-close');
            closeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await closeTab(tab.id);
                tabPreview.remove();
            });

            homePage.appendChild(tabPreview);
        }
    }

    function isConrolPanelHidden(){
        const controlGroup = galleryControls.querySelectorAll('.control-group');
        return controlGroup && controlGroup[1]?.style?.display === 'none';
    }
    
    // Функция для создания кнопок очистки IndexedDB и imageCache
    function createClearButtons(isNotHomePage) {
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
        clearLocalDbBtn.style.display = isConrolPanelHidden() ? 'none' : 'flex';
        clearLocalDbBtn.addEventListener('click', async () => {
            try {
                await clearImagesDB();
                tabs = []
                localStorage.setItem('mhtmlViewerTabs', JSON.stringify(tabs));
                alert('LocalDb очищен');
                loadTabs();
            } catch (e) {
                console.error('Ошибка при очистке LocalDb:', e);
            }
        });

        // Кнопка очистки imageCache
        const clearImageCacheBtn = document.createElement('button');
        clearImageCacheBtn.className = 'clear-btn';
        clearImageCacheBtn.innerHTML = 'Очистить ImageCache';
        clearImageCacheBtn.style.display = isConrolPanelHidden() ? 'none' : 'flex';
        clearImageCacheBtn.addEventListener('click', () => {
            imageCache.cache.clear();
            alert('imageCache очищен');
        });

        // Добавляем кнопки в блок управления галереей
        galleryControls.appendChild(clearLocalDbBtn);
        galleryControls.appendChild(clearImageCacheBtn);
    }

    function showGalleryPage() {
        homePage.style.display = 'none';
        imageGallery.style.display = 'block';
    }

    // Работа с изображениями
    async function handleImageFiles(files) {
        const imageFiles = [];
        const zipFiles = [];

        // Сначала разделяем файлы на изображения и ZIP-архивы
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (isImageFile(file.name)) {
                imageFiles.push(file);
            } else if (file.name.toLowerCase().endsWith('.zip')) {
                zipFiles.push(file);
            }
        }

        // Сортируем изображения по числовому значению в имени файла
        imageFiles.sort((a, b) => {
            const numA = extractNumber(a.name);
            const numB = extractNumber(b.name);
            return numA - numB;
        });

        // Загружаем отсортированные изображения
        for (const file of imageFiles) {
            await loadImageFile(file);
        }

        // Обрабатываем ZIP-архивы по очереди
        for (const file of zipFiles) {
            await loadZipFile(file);
        }
    }

    // Извлечение числа из имени файла
    function extractNumber(filename) {
        // Ищем последовательности цифр в имени файла
        const matches = filename.match(/\d+/g);
        if (matches && matches.length > 0) {
            // Берем последнюю последовательность цифр (для случаев типа "img_1_01.jpg")
            return parseInt(matches[matches.length - 1], 10);
        }
        return 0; // Если чисел нет, считаем как 0
    }

    // Загрузка отдельного изображения
    function loadImageFile(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const imageData = {
                    name: file.name,
                    data: e.target.result,
                    isGif: file.type === 'image/gif'
                };
                uploadedImages.push(imageData);
                renderPreviewImage(imageData, uploadedImages.length - 1);
                resolve();
            };
            reader.readAsDataURL(file);
        });
    }

    // Загрузка изображений из ZIP архива
    async function loadZipFile(file) {
        const loadingIndicator = document.createElement('span');
        loadingIndicator.className = 'zip-loading';
        loadingIndicator.textContent = 'Обработка ZIP...';
        imageDropZone.appendChild(loadingIndicator);

        try {
            const zip = new JSZip();
            const content = await zip.loadAsync(file);

            let loadedCount = 0;
            const imageEntries = [];

            // Собираем все файлы изображений из архива (включая GIF)
            content.forEach(function (relativePath, zipEntry) {
                if (!zipEntry.dir && isImageFile(zipEntry.name)) {
                    imageEntries.push(zipEntry);
                }
            });

            // Сортируем файлы по числовому значению в имени
            imageEntries.sort((a, b) => {
                const numA = extractNumber(a.name);
                const numB = extractNumber(b.name);
                return numA - numB;
            });

            // Обрабатываем изображения по очереди
            for (const zipEntry of imageEntries) {
                try {
                    const fileData = await zipEntry.async('blob');
                    const imgUrl = URL.createObjectURL(fileData);

                    const imageData = {
                        name: zipEntry.name,
                        data: imgUrl,
                        isGif: zipEntry.name.toLowerCase().endsWith('.gif')
                    };

                    uploadedImages.push(imageData);
                    renderPreviewImage(imageData, uploadedImages.length - 1);
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

    // Проверка, является ли файл изображением
    function isImageFile(filename) {
        return filename.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|webp)$/);
    }


    // Отображение превью изображения
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
            uploadedImages.splice(index, 1);
            previewDiv.remove();
        });

        previewDiv.appendChild(img);
        previewDiv.appendChild(removeBtn);
        previewImages.appendChild(previewDiv);
    }

    // Создание вкладки с изображениями
    async function createImageTab(isReadOnly) {
        const name = imageTabNameInput.value.trim();
        if (!name) {
            alert('Пожалуйста, укажите название вкладки');
            return;
        }

        if (isReadOnly && uploadedImages.length === 0) {
            alert('Пожалуйста, добавьте хотя бы одно изображение');
            return;
        }

        var newTab = {
            id: 'img-tab-' + Date.now(),
            name: name,
            isImageTab: true,
            images: uploadedImages,
            isReadOnly: true
        };

        const existingTabIndex = tabs.findIndex(tab => tab.name === newTab.name);

        if (existingTabIndex !== -1) {
            // Если вкладка существует, обновляем её
            newTab = tabs[existingTabIndex];
            newTab.isReadOnly = isReadOnly;
            newTab.images = uploadedImages;
            newTab.isImageTab = isReadOnly;
            newTab.isFile = !isReadOnly;
        } else {
            tabs.push(newTab);
        }

        saveTabs();
        renderTabs();
        await displayTabContent(newTab.id);
        hideImageTabForm();
    }

    // Показать/скрыть формы
    function showTabForm() {
        tabNameInput.value = '';
        tabUrlInput.value = '';
        currentFile = null;
        tabForm.classList.add('active');
        tabNameInput.focus();
    }

    function hideTabForm() {
        tabForm.classList.remove('active');
    }

    function showImageTabForm() {
        imageTabNameInput.value = '';
        uploadedImages = [];
        previewImages.innerHTML = '';
        imageTabForm.classList.add('active');
        imageTabNameInput.focus();
    }

    function hideImageTabForm() {
        imageTabForm.classList.remove('active');
    }

    // Обработчики событий
    addTabBtn.addEventListener('click', showTabForm);
    addImageTabBtn.addEventListener('click', showImageTabForm);
    homeBtn.addEventListener('click', showHomePage);
    cancelBtn.addEventListener('click', hideTabForm);
    cancelImageBtn.addEventListener('click', hideImageTabForm);
    createImageTabBtn.addEventListener('click', () => createImageTab(true));

    // Обработка выбора файла MHTML
    tabUrlInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
            currentFile = e.target.files[0];

            if (!tabNameInput.value.trim()) {
                tabNameInput.value = currentFile.name.replace(/\.[^/.]+$/, "");
            }
        }
    });

    // Сохранение MHTML вкладки
    saveBtn.addEventListener('click', function () {
        const name = tabNameInput.value.trim();

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
                updateProgress(0);
                hideTabForm();
            } catch (error) {
                console.error('Ошибка добавления вкладки:', error);
                alert('Ошибка при добавлении файла');
            }
        };

        reader.readAsArrayBuffer(currentFile);
    });

    // Drag and drop для изображений
    imageDropZone.addEventListener('click', () => imageUploadInput.click());

    imageDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        imageDropZone.classList.add('drag-over');
    });

    imageDropZone.addEventListener('dragleave', () => {
        imageDropZone.classList.remove('drag-over');
    });

    imageDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        imageDropZone.classList.remove('drag-over');
        handleImageFiles(e.dataTransfer.files);
    });

    imageUploadInput.addEventListener('change', (e) => {
        handleImageFiles(e.target.files);
        e.target.value = '';
    });

    // Закрытие форм по клику на оверлей
    tabForm.addEventListener('click', (e) => {
        if (e.target === tabForm) hideTabForm();
    });

    imageTabForm.addEventListener('click', (e) => {
        if (e.target === imageTabForm) hideImageTabForm();
    });

    // Инициализация приложения
    loadTabs();
});

// Дополнительная логика для сакуры
let sakuraAnimationEnabled = false;
let sakuraInterval;

// Функция для создания лепестков сакуры
function createSakura() {
    if (!sakuraAnimationEnabled) return;

    const sakura = document.createElement('div');
    sakura.className = 'sakura';

    // Случайная позиция по горизонтали
    sakura.style.left = Math.random() * window.innerWidth + 'px';

    // Случайный размер
    const size = Math.random() * 15 + 10;
    sakura.style.width = size + 'px';
    sakura.style.height = size + 'px';

    // Случайная прозрачность
    sakura.style.opacity = Math.random() * 0.5 + 0.3;

    // Случайная скорость падения (2-5s)
    const duration = Math.random() * 3 + 2;
    sakura.style.animationDuration = duration + 's';

    document.body.appendChild(sakura);

    // Удаляем элемент после завершения анимации
    setTimeout(() => {
        sakura.remove();
    }, duration * 1000);
}

// Функция для управления анимацией сакуры
function toggleSakuraAnimation() {
    if (sakuraAnimationEnabled) {
        // Включаем анимацию
        sakuraInterval = setInterval(createSakura, 300);

        // Создаем несколько лепестков сразу
        for (let i = 0; i < 15; i++) {
            setTimeout(createSakura, i * 100);
        }
    } else {
        // Выключаем анимацию
        clearInterval(sakuraInterval);

        // Удаляем все лепестки сакуры
        document.querySelectorAll('.sakura').forEach(el => el.remove());
    }
}
