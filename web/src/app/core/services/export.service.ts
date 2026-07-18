import { Injectable } from '@angular/core';
import { zipSync, unzipSync } from 'fflate';
import { Tab } from '../models/tab.model';
import { Page } from '../models/page.model';
import { blobToDataURL, downloadBlob, encodeQuotedPrintable, getImageExtension } from '../../shared/utils/file-parsing';
import { isIOS } from '../../shared/utils/constants';
import { FileFormat } from 'src/app/shared/enums/file-format';

@Injectable({
    providedIn: 'root'
})
export class ExportService {

    // export manga as MHTML or ZIP
    async exportManga(tab: Tab | null, pages: Page[], format: FileFormat): Promise<void> {
        if (!tab) {
            console.error('No tab provided for export.');
            return;
        }

        if (!pages || pages.length === 0) {
            console.error('No pages available for export.');
            return;
        }

        if (format === FileFormat.MHTML) {
            await this.exportMHTML(tab, pages);
        } else if (format === FileFormat.ZIP || format === FileFormat.CBZ) {
            await this.exportArchive(tab, pages, format);
        }
    }

    // MHTML
    // using for export and import MHTML files (same structure)
    private async exportMHTML(tab: Tab, pages: Page[]): Promise<void> {
        try {
            let htmlContent = `<!DOCTYPE html>\n<html>\n<head>\n<title>${tab.name}</title>\n<meta charset="utf-8">\n</head>\n<body>\n`;

            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                let dataUrl = '';
                if (page.src instanceof Blob) {
                    dataUrl = await blobToDataURL(page.src);
                }
                else if (isIOS && typeof page.src === 'string') {
                    dataUrl = page.src;
                }
                else {
                    console.warn(`Unsupported page source for page ${i + 1}`);
                    continue;
                }

                if (!dataUrl.startsWith('data:image')) {
                    const base64Data = dataUrl.split(',')[1];
                    dataUrl = `data:image/png;base64,${base64Data}`;
                }

                htmlContent += `<div id="page-${i + 1}">\n<img src="${dataUrl}" alt="Image ${i + 1}" style="display:block;margin:10px 0;">\n</div>\n\n`;
            }

            htmlContent += `</body>\n</html>`;

            const mhtml = this.wrapMHTML(tab.name, htmlContent);

            const blob = new Blob([mhtml], { type: 'message/rfc822' });
            downloadBlob(blob, `${tab.name.replace(/[^a-zA-Z0-9А-Яа-яЁё]/gi, '_').toLowerCase()}.mhtml`);

        } catch (error) {
            console.error('Error exporting MHTML:', error);
        }
    }

    private wrapMHTML(name: string, html: string): string {
        let mhtml = `From: <Saved by MHTML Viewer>\r\n`;
        mhtml += `Subject: ${name}\r\n`;
        mhtml += `Date: ${new Date().toUTCString()}\r\n`;
        mhtml += `MIME-Version: 1.0\r\n`;
        mhtml += `Content-Type: text/html; charset=utf-8\r\n`;
        mhtml += `Content-Transfer-Encoding: quoted-printable\r\n`;
        mhtml += `\r\n`;
        mhtml += encodeQuotedPrintable(html);
        return mhtml;
    }

    // ZIP / CBZ
    private async exportArchive(tab: Tab, pages: Page[], extension: FileFormat = FileFormat.ZIP): Promise<void> {
        try {
            const files: Record<string, Uint8Array> = {};

            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                let arrayBuffer: ArrayBuffer;
                let ext: string;

                if (page.src instanceof Blob) {
                    arrayBuffer = await page.src.arrayBuffer();
                    ext = getImageExtension(page.src.type);
                }
                else if (isIOS && typeof page.src === 'string') {
                    const response = await fetch(page.src);
                    arrayBuffer = await response.arrayBuffer();
                    const match = page.src.match(/^data:image\/([a-zA-Z0-9+]+);/);
                    ext = match ? match[1] : 'jpeg';
                }
                else {
                    console.warn(`Unsupported page source for page ${i + 1}`);
                    continue;
                }

                files[`${i + 1}.${ext}`] = new Uint8Array(arrayBuffer);
            }

            const zipped = zipSync(files);
            const content = new Blob([zipped], { type: 'application/zip' });

            downloadBlob(content, `${tab.name.replace(/[^a-zA-Z0-9А-Яа-яЁё]/gi, '_')}.${extension.toLowerCase()}`);

        } catch (error) {
            console.error('Error exporting archive:', error);
        }
    }
}
