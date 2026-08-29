import { Injectable } from '@angular/core';
import { zipSync } from 'fflate';
import { Tab } from '../models/tab.model';
import { Page } from '../models/page.model';
import { blobToDataURL, downloadBlob, encodeQuotedPrintable, getImageExtension } from '../../shared/utils/file-parsing';
import { isIOS } from '../../shared/utils/constants';
import { FileFormat } from 'src/app/shared/enums/file-format';
import { ChaptersRepository } from '../repositories/chapters.repository';
import { PagesRepository } from '../repositories/pages.repository';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { MangaStructureMetadata, MANGA_STRUCTURE_METADATA_MARKER, MANGA_STRUCTURE_METADATA_VERSION } from '../../shared/models/manga-structure-metadata';
import { Chapter } from '../models/chapter.model';

type ExportStructure = {
    pages: Page[];
    chapters: Chapter[];
};

@Injectable({
    providedIn: 'root'
})
export class ExportService {
    constructor(
        private chaptersRepo: ChaptersRepository,
        private pagesRepo: PagesRepository
    ) { }

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

        const structure = await this.getExportStructure(tab, pages);

        if (format === FileFormat.MHTML) {
            await this.exportMHTML(tab, structure);
        } else if (format === FileFormat.ZIP || format === FileFormat.CBZ) {
            await this.exportArchive(tab, structure, format);
        }
    }

    // MHTML
    // using for export and import MHTML files (same structure)
    private async exportMHTML(tab: Tab, structure: ExportStructure): Promise<void> {
        try {
            let htmlContent = `<!DOCTYPE html>\n<html>\n<head>\n<title>${tab.name}</title>\n<meta charset="utf-8">\n</head>\n<body>\n`;
            const { pages } = structure;

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

            const metadata = this.createMetadata(tab.mode, structure, (_, index) => `page-${index + 1}`);
            if (metadata) {
                // The manifest links each logical page to the HTML asset id.
                htmlContent += `<script id="molv-manga-structure" type="application/json">${JSON.stringify(metadata)}</script>\n`;
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
    private async exportArchive(tab: Tab, structure: ExportStructure, extension: FileFormat = FileFormat.ZIP): Promise<void> {
        try {
            const files: Record<string, Uint8Array> = {};
            const { pages } = structure;
            const assetNames = new Map<Page, string>();

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

                const assetName = `${i + 1}.${ext}`;
                files[assetName] = new Uint8Array(arrayBuffer);
                assetNames.set(page, assetName);
            }

            const metadata = this.createMetadata(tab.mode, structure, page => assetNames.get(page));
            if (metadata) {
                files['.molv/manga-structure.json'] = new TextEncoder().encode(JSON.stringify(metadata));
            }

            const zipped = zipSync(files);
            const content = new Blob([zipped], { type: 'application/zip' });

            downloadBlob(content, `${tab.name.replace(/[^a-zA-Z0-9А-Яа-яЁё]/gi, '_')}.${extension.toLowerCase()}`);

        } catch (error) {
            console.error('Error exporting archive:', error);
        }
    }

    private async getExportStructure(tab: Tab, fallbackPages: Page[]): Promise<ExportStructure> {
        if (tab.mode !== ViewMod.Chapters || !tab.id) {
            return { pages: fallbackPages, chapters: [] };
        }

        const chapters = await this.chaptersRepo.getAll(tab.id);
        const pagesByChapter = await Promise.all(
            chapters.map(chapter => this.pagesRepo.getByChapter(tab.id!, chapter.id!))
        );

        return {
            pages: pagesByChapter.flat().map(page => ({ ...page })),
            chapters
        };
    }

    private createMetadata(
        mode: Tab['mode'],
        structure: ExportStructure,
        getAsset: (page: Page, index: number) => string | undefined
    ): MangaStructureMetadata | undefined {
        if(mode === ViewMod.Single) return undefined; // TODO: I haven't figured out yet why metadata is needed for single mode
        const { pages } = structure;
        const isChapters = mode === ViewMod.Chapters;

        // Do not publish a partial manifest when legacy export skipped an unsupported page.
        if (pages.some((page, index) => !getAsset(page, index))) return undefined;

        const base = {
            marker: MANGA_STRUCTURE_METADATA_MARKER,
            version: MANGA_STRUCTURE_METADATA_VERSION
        } as const;

        if (!isChapters) {
            return {
                ...base,
                mode: ViewMod.Single,
                pages: pages.map((page, index) => ({ asset: getAsset(page, index)! }))
            };
        }

        return {
            ...base,
            mode: ViewMod.Chapters,
            chapters: structure.chapters.map(chapter => {
                const chapterPages = pages.filter(page => page.chapterId === chapter.id);
                return {
                    title: chapter.title,
                    pages: chapterPages.map(page => ({ asset: getAsset(page, pages.indexOf(page))! }))
                };
            })
        };
    }
}
