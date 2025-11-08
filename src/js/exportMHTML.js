// Экспорт текущей вкладки-галереи в MHTML

import { saveFileToDB } from './db.js';

// экспорт MHTML в корректном для импорта формате
export async function createMHTMLForParser(tab) {
    try {
        let htmlContent = `<!DOCTYPE html>\n<html>\n<head>\n<title>${tab.name}</title>\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n</head>\n<body>\n`;

        for (let i = 0; i < tab.images.length; i++) {
            const img = tab.images[i];
            let imgData = img.data;

            // blob в data URL
            if (imgData.startsWith('blob:')) {
                const response = await fetch(imgData);
                const blob = await response.blob();

                // MIME-тип из blob
                let mimeType = 'image/png';
                if (blob.type && blob.type.startsWith('image/')) {
                    mimeType = blob.type;
                }

                imgData = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        // замена MIME-типа на тот, который ожидается при импорте 
                        const result = reader.result;
                        const base64Data = result.split(',')[1];
                        resolve(`data:${mimeType};base64,${base64Data}`);
                    };
                    reader.readAsDataURL(blob);
                });
            } else if (imgData.startsWith('data:text/plain')) {
                // замена MIME-типа на тот, который ожидается при импорте 
                const base64Data = imgData.split('base64,')[1];
                imgData = `data:image/png;base64,${base64Data}`;
            }

            htmlContent += `<div id="page-${i + 1}">\n`;
            htmlContent += `<img src="${imgData}" alt="Image ${i + 1}" style="display: block; margin: 10px 0;">\n`;
            htmlContent += `</div>\n\n`;
        }

        htmlContent += `</body>\n</html>`;

        let mhtml = `From: <Saved by MHTML Viewer>\r\n`;
        mhtml += `Subject: ${tab.name}\r\n`;
        mhtml += `Date: ${new Date().toUTCString()}\r\n`;
        mhtml += `MIME-Version: 1.0\r\n`;
        mhtml += `Content-Type: text/html; charset=utf-8\r\n`;
        mhtml += `Content-Transfer-Encoding: quoted-printable\r\n`;
        mhtml += `\r\n`;
        mhtml += encodeQuotedPrintable(htmlContent);

        return { mhtml, name: tab.name };

    } catch (error) {
        console.error('Error creating MHTML:', error);
        throw error;
    }
}

function encodeQuotedPrintable(str) {
    return str.replace(/[^\x20-\x7E\r\n]/g, function (chr) {
        if (chr === '\r' || chr === '\n') return chr;
        return '=' + chr.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    })
        .replace(/ /g, function (match, offset, original) {
            // кодировка пробелов только в конце строки
            if (offset === original.length - 1 || original[offset + 1] === '\r' || original[offset + 1] === '\n') {
                return '=20';
            }
            return ' ';
        })
        .replace(/\t/g, '=09')
        .replace(/=$/gm, '=3D');
}

// Функция сохранения MHTML
export async function saveAsMHTML(tab) {
    try {
        let previewData = null;

        const { mhtml, name } = await createMHTMLForParser(tab);
        const arrayBuffer = new TextEncoder().encode(mhtml);

        await saveFileToDB(tab.id, arrayBuffer);

        const blob = new Blob([mhtml], { type: 'message/rfc822' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${name.replace(/[^a-zA-Z0-9А-Яа-яЁё]/gi, '_').toLowerCase()}.mhtml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(url), 100);

        // создать вкладку-читатель
        import('./imageUpload.js').then(({ createImageTab }) => createImageTab(false));

        return { preview: previewData, name };

    } catch (error) {
        console.error('Error saving MHTML:', error);
        alert('Ошибка при сохранении MHTML: ' + error.message);
        return null;
    }
}
