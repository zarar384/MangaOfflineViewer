// Экспорт текущей вкладки-галереи в MHTML

import { saveFileToDB } from './db.js';

export async function createMHTMLForParser(tab) {
    try {
        let htmlContent = `<!DOCTYPE html>\n<html>\n<head>\n<title>${tab.name}</title>\n</head>\n<body>\n`;

        for (let i = 0; i < tab.images.length; i++) {
            const img = tab.images[i];
            let imgData = img.data;

            if (imgData.startsWith('blob:')) {
                const response = await fetch(imgData);
                const blob = await response.blob();

                const mimeType = 'image/png'; // По умолчанию

                // blob в data:image
                imgData = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(`data:${mimeType};base64,${reader.result.split(',')[1]}`);
                    reader.readAsDataURL(blob);
                });
            }

            htmlContent += `<div id="page-${i + 1}">\n`;
            htmlContent += `<img src="${imgData}" alt="Image ${i + 1}">\n`;
            htmlContent += `</div>\n\n`;
        }

        htmlContent += `</body>\n</html>`;

        const encodedContent = encodeQuotedPrintable(htmlContent);

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
        a.download = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mhtml`;
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
