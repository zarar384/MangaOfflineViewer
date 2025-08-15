// Разные хелперы и утилиты

export function updateProgress(progress) {
    const progressBar = document.getElementById('progressBar');
    if (!progressBar) return;
    const rounded = Math.floor(progress);
    progressBar.style.width = `${rounded}%`;
    progressBar.textContent = `${rounded}%`;

    // Стилизация под завершение
    if (rounded === 100) {
        progressBar.style.background = 'var(--secondary-color)';
        progressBar.style.boxShadow = '0 2px 5px rgba(255, 107, 158, 0.5)';
    } else {
        progressBar.style.background = 'green';
        progressBar.style.boxShadow = '';
    }
}

// Хелпер для задержки
export function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export function parseHTMLForImages(html) {
    const images = [];

    // найти все div с id, начинающимся на "page-"
    const divRegex = /<div\s+[^>]*id="page-[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let divMatch;
    while ((divMatch = divRegex.exec(html)) !== null) {
        const divContent = divMatch[1];

        // найти все img с src внутри этого div
        const imgRegex = /<img\s+[^>]*src="([^">]+)"/gi;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(divContent)) !== null) {
            images.push(imgMatch[1]);
        }
    }

    return images;
}

export function decodeQuotedPrintable(str) {
    return str.replace(/=\r?\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16)));
}

// проверка, является ли файл изображением
export function isImageFile(filename) {
    return filename.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|webp)$/);
}

// Извлечение числа из имени файла (для сортировки)
export function extractNumber(filename) {
    const matches = filename.match(/\d+/g);
    if (matches && matches.length > 0) {
        return parseInt(matches[matches.length - 1], 10);
    }
    return 0;
}
