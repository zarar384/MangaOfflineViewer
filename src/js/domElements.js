// Получение и экспорт ссылок на DOM-элементы. Вызывать после DOMContentLoaded.

export function getDom() {
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

    // Получаем элементы управления галереей
    const toggleBtn = document.getElementById('toggleMenuBtn');
    const galleryControls = document.querySelector('.gallery-controls');
    const hideText = toggleBtn ? toggleBtn.querySelector('.hide-text') : null;
    const showText = toggleBtn ? toggleBtn.querySelector('.show-text') : null;

    // элементы управления
    const animationToggle = document.getElementById('animationToggle');
    const spacingSlider = document.getElementById('spacingSlider');
    const spacingValue = document.getElementById('spacingValue');
    const sakuraToggle = document.getElementById('sakuraToggle');

    return {
        tabsContainer, addTabBtn, addImageTabBtn, tabForm, imageTabForm, homeBtn,
        imageGallery, homePage,
        tabNameInput, tabUrlInput, saveBtn, cancelBtn,
        imageTabNameInput, imageDropZone, imageUploadInput, previewImages,
        cancelImageBtn, createImageTabBtn,
        toggleBtn, hideText, showText, galleryControls,
        animationToggle, spacingSlider, spacingValue, sakuraToggle
    };
}
