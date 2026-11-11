import { Injectable } from '@angular/core';
import { Zip, ZipDeflate, ZipPassThrough, ZipInputFile } from 'fflate';
import { Tab } from '../models/tab.model';
import { Page } from '../models/page.model';
import { detectImageFormat, ImageFormat, imageFormatFromFilename, imageFormatFromMime } from '../../shared/utils/image-format';
import { isIOS } from '../../shared/utils/constants';
import { FileFormat } from 'src/app/shared/enums/file-format';
import { ChaptersRepository } from '../repositories/chapters.repository';
import { PagesRepository } from '../repositories/pages.repository';
import { ViewMod } from '../../shared/enums/viewmod.enum';
import { MangaStructureMetadata, MANGA_STRUCTURE_METADATA_MARKER, MANGA_STRUCTURE_METADATA_VERSION } from '../../shared/models/manga-structure-metadata';
import { Chapter } from '../models/chapter.model';
import { createQPEncodeState, encodeQuotedPrintableChunk, finalizeQPEncode } from '../../shared/utils/quoted-printable-stream';
import { createBase64EncodeState, encodeBase64Chunk, finalizeBase64Encode, createBase64DecodeState, decodeBase64Chunk } from '../../shared/utils/base64-stream';
import { ExportOutput } from '../../shared/utils/export-output';

type ExportPage = { id: number; chapterId?: number };
type ExportStructure = { pages: ExportPage[]; chapters: Chapter[] };

const EXPORT_CHUNK_BYTES = 256 * 1024;
const DATA_URL_HEADER = /^data:([^;]+);base64,/;
// fflate writes classic ZIP, not ZIP64. Fail before its 32/16-bit fields wrap around.
const ZIP_MAX_BYTES = 0xffffffff;
const ZIP_MAX_ENTRIES = 0xffff;

function encodeMhtmlSubject(name: string, encoder: TextEncoder): string {
    const subject = name.replace(/[\x00-\x1f\x7f]+/g, ' ');
    if (subject.length <= 67 && !/[<=\x7f-\uffff]/.test(subject)) return subject;

    // The scanner also sees headers. Encode names that might look like body markers,
    // keeping each RFC 2047 word and the Subject line within their size limits.
    const bytes = encoder.encode(subject);
    const words: string[] = [];
    for (let offset = 0; offset < bytes.length;) {
        let end = Math.min(offset + 39, bytes.length);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        const encoded = btoa(String.fromCharCode(...bytes.subarray(offset, end)));
        words.push(`=?UTF-8?B?${encoded}?=`);
        offset = end;
    }
    return words.join('\r\n ');
}

@Injectable({ providedIn: 'root' })
export class ExportService {
    private exporting = false;

    constructor(
        private chaptersRepo: ChaptersRepository,
        private pagesRepo: PagesRepository
    ) { }

    async exportManga(tab: Tab | null, format: FileFormat): Promise<void> {
        if (!tab) return;
        if (this.exporting) throw new Error('An export is already in progress.');
        if (![FileFormat.MHTML, FileFormat.ZIP, FileFormat.CBZ].includes(format)) {
            throw new Error(`Unsupported export format: ${format}`);
        }
        this.exporting = true;
        let output: ExportOutput | undefined;
        try {
            const structure = await this.getExportStructure(tab);
            output = await ExportOutput.create();
            if (format === FileFormat.MHTML) await this.exportMHTML(tab, structure, output);
            else await this.exportArchive(tab, structure, output);

            const name = tab.name.replace(/[^a-zA-Z0-9А-Яа-яЁё]/gi, '_');
            await output.download(
                `${format === FileFormat.MHTML ? name.toLowerCase() : name}.${format}`,
                format === FileFormat.MHTML ? 'message/rfc822' : 'application/zip'
            );
        } catch (error) {
            await output?.abort();
            // Let callers handle failure; never report a failed/truncated download as success.
            throw error;
        } finally {
            this.exporting = false;
        }
    }

    private async exportMHTML(tab: Tab, structure: ExportStructure, output: ExportOutput): Promise<void> {
        const encoder = new TextEncoder();
        const subject = encodeMhtmlSubject(tab.name, encoder);
        await output.write(encoder.encode(
            `From: <Saved by MHTML Viewer>\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\n` +
            `MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n`
        ));
        // Keep the legacy encoding and a single state across all page/chunk boundaries.
        let qpState = createQPEncodeState();
        const writeQP = async (text: string) => {
            for (let offset = 0; offset < text.length; offset += EXPORT_CHUNK_BYTES) {
                const result = encodeQuotedPrintableChunk(text.slice(offset, offset + EXPORT_CHUNK_BYTES), qpState);
                qpState = result.state;
                await output.write(encoder.encode(result.output));
            }
        };
        // HTML character references keep the title ASCII through the legacy QP codec.
        const title = tab.name.replace(/[&<>=\x00-\x1f\x7f-\u{10ffff}]/gu, character => `&#${character.codePointAt(0)};`);
        await writeQP(`<!DOCTYPE html>\n<html>\n<head>\n<title>${title}</title>\n<meta charset="utf-8">\n</head>\n<body>\n`);

        for (let i = 0; i < structure.pages.length; i++) {
            const page = await this.readPage(structure.pages[i]);
            const src = page.src;
            const dataUrl = isIOS && typeof src === 'string' ? DATA_URL_HEADER.exec(src) : null;
            if (!(src instanceof Blob) && (typeof src !== 'string' || !dataUrl)) {
                console.warn(`Unsupported page source for page ${i + 1}`);
                continue;
            }
            const { mimeType } = await this.getPageImageFormat(src, dataUrl, page.name);
            await writeQP(`<div id="page-${i + 1}">\n<img src="data:${mimeType};base64,`);

            if (isIOS && typeof src === 'string' && dataUrl) {
                // Do not match/copy the whole payload or decode then re-encode the iOS string.
                for (let offset = dataUrl[0].length; offset < src.length; offset += EXPORT_CHUNK_BYTES) {
                    await writeQP(src.slice(offset, offset + EXPORT_CHUNK_BYTES));
                }
            } else if (src instanceof Blob) {
                let state = createBase64EncodeState();
                for (let offset = 0; offset < src.size; offset += EXPORT_CHUNK_BYTES) {
                    const bytes = new Uint8Array(await src.slice(offset, offset + EXPORT_CHUNK_BYTES).arrayBuffer());
                    const result = encodeBase64Chunk(bytes, state);
                    state = result.state;
                    await writeQP(result.output);
                }
                await writeQP(finalizeBase64Encode(state));
            }
            await writeQP(`" alt="Image ${i + 1}" style="display:block;margin:10px 0;">\n</div>\n\n`);
        }

        // Preserve unconditional index-based MHTML naming for legacy compatibility (AGENTS.md).
        const metadata = this.createMetadata(tab.mode, structure, (_, index) => `page-${index + 1}`);
        if (metadata) {
            // Keep the same metadata schema. JSON escapes protect Unicode, literal equals
            // signs and the script boundary through both the legacy codec and HTML.
            const json = JSON.stringify(metadata).replace(/[<=\x7f-\uffff]/g, character =>
                `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
            );
            await writeQP(`<script id="molv-manga-structure" type="application/json">${json}</script>\n`);
        }
        await writeQP('</body>\n</html>');
        await output.write(encoder.encode(finalizeQPEncode(qpState)));
    }

    private async exportArchive(tab: Tab, structure: ExportStructure, output: ExportOutput): Promise<void> {
        const assetNames = new Map<number, string>();
        // fflate's callback is synchronous. Drain every push before producing the next chunk;
        // an async callback/promise chain here would silently buffer the whole archive again.
        let pending: Uint8Array<ArrayBuffer>[] = [];
        let streamError: Error | undefined;
        let totalBytes = 0;
        let entryCount = 0;
        const zip = new Zip((error, chunk) => {
            if (error) { streamError = error; return; }
            totalBytes += chunk.length;
            if (totalBytes >= ZIP_MAX_BYTES) {
                streamError = new Error('Export exceeds the classic ZIP size limit (4 GiB).');
            } else pending.push(chunk);
        });
        const drain = async () => {
            if (streamError) throw streamError;
            const chunks = pending;
            pending = [];
            for (const chunk of chunks) await output.write(chunk);
        };
        const add = (entry: ZipInputFile) => {
            if (++entryCount >= ZIP_MAX_ENTRIES) throw new Error('Export exceeds the classic ZIP entry limit.');
            zip.add(entry);
        };

        try {
            for (let i = 0; i < structure.pages.length; i++) {
                const page = await this.readPage(structure.pages[i]);
                const src = page.src;
                const dataUrl = isIOS && typeof src === 'string' ? DATA_URL_HEADER.exec(src) : null;
                if (!(src instanceof Blob) && (typeof src !== 'string' || !dataUrl)) {
                    console.warn(`Unsupported page source for page ${i + 1}`);
                    continue;
                }
                const { extension } = await this.getPageImageFormat(src, dataUrl, page.name);
                const name = `${i + 1}.${extension}`;
                assetNames.set(structure.pages[i].id, name);
                // PNG/JPEG/WebP/GIF are already compressed. STORE avoids expensive main-thread
                // recompression and is supported by both the existing importer and CBZ readers.
                const entry = new ZipPassThrough(name);
                add(entry);
                for await (const chunk of this.imageChunks(page)) {
                    entry.push(chunk, false);
                    await drain();
                }
                entry.push(new Uint8Array(0), true);
                await drain();
            }
            const metadata = this.createMetadata(tab.mode, structure, page => assetNames.get(page.id));
            if (metadata) {
                const entry = new ZipDeflate('.molv/manga-structure.json');
                add(entry);
                const json = JSON.stringify(metadata);
                const encoder = new TextEncoder();
                // Preserve surrogate pairs while bounding metadata compression work, too.
                for (let offset = 0; offset < json.length;) {
                    let end = Math.min(offset + EXPORT_CHUNK_BYTES, json.length);
                    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
                    entry.push(encoder.encode(json.slice(offset, end)), false);
                    await drain();
                    offset = end;
                }
                entry.push(new Uint8Array(0), true);
                await drain();
            }
            zip.end();
            await drain();
        } finally {
            zip.terminate();
            pending = [];
        }
    }

    private async getPageImageFormat(
        src: Blob | string,
        dataUrl: RegExpExecArray | null,
        name?: string
    ): Promise<ImageFormat> {
        const type = src instanceof Blob ? src.type : dataUrl![1];
        const mime = type.split(';', 1)[0].trim().toLowerCase();
        const declaredImageMime = /^image\/[a-z0-9][a-z0-9.+-]*$/.test(mime) ? mime : undefined;

        let prefix: Uint8Array;
        if (src instanceof Blob) {
            prefix = new Uint8Array(await src.slice(0, 12).arrayBuffer());
        } else {
            const start = dataUrl![0].length;
            const text = src.slice(start, start + 48).replace(/\s/g, '');
            prefix = decodeBase64Chunk(text, createBase64DecodeState()).output;
        }

        const format = detectImageFormat(prefix) ?? imageFormatFromMime(mime);
        // Keep the established .jpeg name for correctly typed mobile JPEG pages.
        if (dataUrl && mime === 'image/jpeg' && format?.mimeType === mime) {
            return { ...format, extension: 'jpeg' };
        }
        if (format) return format;
        if (!declaredImageMime && name) {
            const namedFormat = imageFormatFromFilename(name);
            if (namedFormat) return namedFormat;
        }

        const mobileExtension = /^image\/([a-z0-9+]+)$/.exec(mime)?.[1];
        return {
            mimeType: declaredImageMime ?? 'image/png',
            extension: dataUrl ? mobileExtension ?? 'jpeg' : 'png'
        };
    }

    private async *imageChunks(page: Page): AsyncGenerator<Uint8Array<ArrayBuffer>> {
        if (page.src instanceof Blob) {
            for (let offset = 0; offset < page.src.size; offset += EXPORT_CHUNK_BYTES) {
                yield new Uint8Array(await page.src.slice(offset, offset + EXPORT_CHUNK_BYTES).arrayBuffer());
            }
        } else if (isIOS && typeof page.src === 'string') {
            const header = DATA_URL_HEADER.exec(page.src)!;
            let state = createBase64DecodeState();
            for (let offset = header[0].length; offset < page.src.length; offset += EXPORT_CHUNK_BYTES) {
                const text = page.src.slice(offset, offset + EXPORT_CHUNK_BYTES).replace(/\s/g, '');
                // fetch(dataURL) buffered both the complete string and decoded image on Safari.
                if (/[^A-Za-z0-9+/=]/.test(text)) throw new Error('Invalid base64 page source.');
                const result = decodeBase64Chunk(text, state);
                state = result.state;
                yield new Uint8Array(result.output);
            }
            // fetch also accepted unpadded base64. Preserve that compatibility.
            if (state.pending.length === 1) throw new Error('Invalid base64 page source.');
            if (state.pending.length) {
                yield new Uint8Array(decodeBase64Chunk('='.repeat(4 - state.pending.length), state).output);
            }
        }
    }

    private async readPage(reference: ExportPage): Promise<Page> {
        const page = await this.pagesRepo.get(reference.id);
        if (!page) throw new Error(`Page ${reference.id} was removed during export.`);
        return page;
    }

    private async getExportStructure(tab: Tab): Promise<ExportStructure> {
        if (!tab.id) return { pages: [], chapters: [] };
        if (tab.mode === ViewMod.Single) {
            return { pages: (await this.pagesRepo.getOrderedIds(tab.id)).map(id => ({ id })), chapters: [] };
        }
        const chapters = await this.chaptersRepo.getAll(tab.id);
        const pages: ExportPage[] = [];
        for (const chapter of chapters) {
            for (const id of await this.pagesRepo.getOrderedIds(tab.id, chapter)) {
                pages.push({ id, chapterId: chapter.id });
            }
        }
        return { pages, chapters };
    }

    private createMetadata(
        mode: Tab['mode'], structure: ExportStructure,
        getAsset: (page: ExportPage, index: number) => string | undefined
    ): MangaStructureMetadata | undefined {
        if (mode !== ViewMod.Chapters) return undefined;
        const assets = structure.pages.map(getAsset);
        if (assets.some(asset => !asset)) return undefined;
        const base = { marker: MANGA_STRUCTURE_METADATA_MARKER, version: MANGA_STRUCTURE_METADATA_VERSION } as const;
        // Linear grouping instead of filter/indexOf for every page of every chapter.
        const byChapter = new Map<number | undefined, { asset: string }[]>();
        structure.pages.forEach((page, index) => {
            let group = byChapter.get(page.chapterId);
            if (!group) { group = []; byChapter.set(page.chapterId, group); }
            group.push({ asset: assets[index]! });
        });
        return { ...base, mode: ViewMod.Chapters, chapters: structure.chapters.map(chapter => ({
            title: chapter.title, pages: byChapter.get(chapter.id) ?? []
        })) };
    }
}
