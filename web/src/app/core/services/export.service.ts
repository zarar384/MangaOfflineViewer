import { Injectable } from '@angular/core';
import { Zip, ZipDeflate } from 'fflate';
import { Tab } from '../models/tab.model';
import { Page } from '../models/page.model';
import { downloadBlob, getImageExtension } from '../../shared/utils/file-parsing';
import { isIOS } from '../../shared/utils/constants';
import { FileFormat } from 'src/app/shared/enums/file-format';
import { ChaptersRepository } from '../repositories/chapters.repository';
import { PagesRepository } from '../repositories/pages.repository';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { MangaStructureMetadata, MANGA_STRUCTURE_METADATA_MARKER, MANGA_STRUCTURE_METADATA_VERSION } from '../../shared/models/manga-structure-metadata';
import { Chapter } from '../models/chapter.model';
import { createQPEncodeState, encodeQuotedPrintableChunk, finalizeQPEncode, QPEncodeState } from '../../shared/utils/quoted-printable-stream';
import { createBase64EncodeState, encodeBase64Chunk, finalizeBase64Encode } from '../../shared/utils/base64-stream';

type ExportStructure = {
    pages: Page[];
    chapters: Chapter[];
};

// Bytes-per-image-slice fed to the incremental base64 encoder during MHTML export; keeps only a
// small window of an image's bytes resident at once instead of base64-encoding it all in one go.
const MHTML_ENCODE_CHUNK_BYTES = 256 * 1024;

@Injectable({
    providedIn: 'root'
})
export class ExportService {
    constructor(
        private chaptersRepo: ChaptersRepository,
        private pagesRepo: PagesRepository
    ) { }

    // export manga as MHTML or ZIP
    async exportManga(tab: Tab | null, format: FileFormat): Promise<void> {
        if (!tab) {
            console.error('No tab provided for export.');
            return;
        }

        const structure = await this.getExportStructure(tab);

        if (format === FileFormat.MHTML) {
            await this.exportMHTML(tab, structure);
        } else if (format === FileFormat.ZIP || format === FileFormat.CBZ) {
            await this.exportArchive(tab, structure, format);
        }
    }

    // MHTML
    // using for export and import MHTML files (same structure)
    // Streams the document out as an array of byte chunks (header, then incrementally
    // QP-encoded HTML/base64 per page) instead of building one giant HTML string and running a
    // single whole-string QP encode over it - only the current page's bytes are resident in
    // memory per iteration, mirroring the approach already used by exportArchive() below.
    private async exportMHTML(tab: Tab, structure: ExportStructure): Promise<void> {
        try {
            const { pages } = structure;
            const textEncoder = new TextEncoder();
            const chunks: BlobPart[] = [];

            // RFC822 headers are written as plain text (never quoted-printable encoded),
            // matching wrapMHTML()'s previous behavior exactly.
            let headers = `From: <Saved by MHTML Viewer>\r\n`;
            headers += `Subject: ${tab.name}\r\n`;
            headers += `Date: ${new Date().toUTCString()}\r\n`;
            headers += `MIME-Version: 1.0\r\n`;
            headers += `Content-Type: text/html; charset=utf-8\r\n`;
            headers += `Content-Transfer-Encoding: quoted-printable\r\n`;
            headers += `\r\n`;
            chunks.push(textEncoder.encode(headers));

            // A single QP encoder state is shared across the whole body (prologue, every page,
            // metadata, suffix) since the original ran one QP encode pass over the whole HTML.
            let qpState: QPEncodeState = createQPEncodeState();
            const writeQP = (text: string) => {
                if (!text) return;
                const result = encodeQuotedPrintableChunk(text, qpState);
                qpState = result.state;
                if (result.output) chunks.push(textEncoder.encode(result.output));
            };

            writeQP(`<!DOCTYPE html>\n<html>\n<head>\n<title>${tab.name}</title>\n<meta charset="utf-8">\n</head>\n<body>\n`);

            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];

                if (isIOS && typeof page.src === 'string') {
                    // page.src is already a base64 data URL string on iOS; reuse its base64 text
                    // as-is instead of decoding to bytes and re-encoding to base64.
                    const match = page.src.match(/^data:([^;]+);base64,([\s\S]*)$/);
                    if (!match) {
                        console.warn(`Unsupported page source for page ${i + 1}`);
                        continue;
                    }
                    const mimeType = match[1].startsWith('image/') ? match[1] : 'image/png';
                    writeQP(`<div id="page-${i + 1}">\n<img src="data:${mimeType};base64,`);
                    writeQP(match[2]);
                    writeQP(`" alt="Image ${i + 1}" style="display:block;margin:10px 0;">\n</div>\n\n`);
                    continue;
                }

                if (!(page.src instanceof Blob)) {
                    console.warn(`Unsupported page source for page ${i + 1}`);
                    continue;
                }

                const mimeType = page.src.type && page.src.type.startsWith('image/') ? page.src.type : 'image/png';
                writeQP(`<div id="page-${i + 1}">\n<img src="data:${mimeType};base64,`);

                const bytes = new Uint8Array(await page.src.arrayBuffer());
                let b64State = createBase64EncodeState();
                for (let off = 0; off < bytes.length; off += MHTML_ENCODE_CHUNK_BYTES) {
                    const slice = bytes.subarray(off, Math.min(off + MHTML_ENCODE_CHUNK_BYTES, bytes.length));
                    const encResult = encodeBase64Chunk(slice, b64State);
                    b64State = encResult.state;
                    writeQP(encResult.output);
                }
                writeQP(finalizeBase64Encode(b64State));

                writeQP(`" alt="Image ${i + 1}" style="display:block;margin:10px 0;">\n</div>\n\n`);
            }

            const metadata = this.createMetadata(tab.mode, structure, (_, index) => `page-${index + 1}`);
            if (metadata) {
                // The manifest links each logical page to the HTML asset id.
                writeQP(`<script id="molv-manga-structure" type="application/json">${JSON.stringify(metadata)}</script>\n`);
            }
            writeQP(`</body>\n</html>`);

            const flushed = finalizeQPEncode(qpState);
            if (flushed) chunks.push(textEncoder.encode(flushed));

            const blob = new Blob(chunks, { type: 'message/rfc822' });
            downloadBlob(blob, `${tab.name.replace(/[^a-zA-Z0-9А-Яа-яЁё]/gi, '_').toLowerCase()}.mhtml`);

        } catch (error) {
            console.error('Error exporting MHTML:', error);
        }
    }

    // ZIP / CBZ
    // Streams one page into the archive at a time instead of holding every page's bytes
    // plus the whole compressed output in memory simultaneously (Zip/ZipDeflate are synchronous,
    // main-thread streams from fflate; only the current page's bytes are resident per iteration).
    private async exportArchive(tab: Tab, structure: ExportStructure, extension: FileFormat = FileFormat.ZIP): Promise<void> {
        try {
            const { pages } = structure;
            const assetNames = new Map<Page, string>();
            const chunks: Uint8Array<ArrayBuffer>[] = [];
            let streamError: unknown;

            const zipStream = new Zip((error, chunk) => {
                if (error) { streamError = error; return; }
                if (chunk) chunks.push(chunk);
            });

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

                if (streamError) throw streamError;

                const assetName = `${i + 1}.${ext}`;
                assetNames.set(page, assetName);

                const entryStream = new ZipDeflate(assetName);
                zipStream.add(entryStream);
                entryStream.push(new Uint8Array(arrayBuffer), true);
            }

            const metadata = this.createMetadata(tab.mode, structure, page => assetNames.get(page));
            if (metadata) {
                const metaStream = new ZipDeflate('.molv/manga-structure.json');
                zipStream.add(metaStream);
                metaStream.push(new TextEncoder().encode(JSON.stringify(metadata)), true);
            }

            zipStream.end();
            if (streamError) throw streamError;

            const content = new Blob(chunks, { type: 'application/zip' });
            downloadBlob(content, `${tab.name.replace(/[^a-zA-Z0-9А-Яа-яЁё]/gi, '_')}.${extension.toLowerCase()}`);

        } catch (error) {
            console.error('Error exporting archive:', error);
        }
    }

    private async getExportStructure(tab: Tab): Promise<ExportStructure> {
        if (!tab.id) {
            return { pages: [], chapters: [] };
        }

        if (tab.mode === ViewMod.Single) {
            var pages = await this.pagesRepo.getAll(tab.id);
            return { pages, chapters: [] };
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
