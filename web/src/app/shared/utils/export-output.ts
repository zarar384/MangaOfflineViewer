import { ExportOutputRequest, ExportOutputResponse } from '../models/export-output-message';
import { downloadBlob, sleepIfNeeded } from './file-parsing';

const TEMP_DIRECTORY = 'molv-export-temp';
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Sequential output with backpressure. OPFS keeps the completed file out of the JS heap. */
export class ExportOutput {
    private worker?: Worker;
    private workerFailed = false;
    private directory?: FileSystemDirectoryHandle;
    private handle?: FileSystemFileHandle;
    private temporaryName?: string;
    private parts: Blob[] = [];
    private lastYield = performance.now();

    static async create(): Promise<ExportOutput> {
        const output = new ExportOutput();
        if (typeof Worker === 'undefined' || !navigator.storage?.getDirectory) return output;

        try {
            const root = await navigator.storage.getDirectory();
            output.directory = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
            // Clean up only our expired temporary files, including leftovers from closed tabs.
            for await (const [name, entry] of output.directory.entries()) {
                if (entry.kind !== 'file' || !/^export-\d+-[\w-]+$/.test(name)) continue;
                const createdAt = Number(name.split('-')[1]);
                if (Date.now() - createdAt > TEMP_MAX_AGE_MS) {
                    await output.directory.removeEntry(name).catch(() => {});
                }
            }
            output.temporaryName = `export-${Date.now()}-${crypto.randomUUID()}`;
            output.handle = await output.directory.getFileHandle(output.temporaryName, { create: true });
            // getFile() was absent in early OPFS implementations; detect before writing anything.
            if (typeof output.handle.getFile !== 'function') throw new Error('OPFS getFile is unavailable.');
            output.worker = new Worker(new URL('../../export-output.worker', import.meta.url), { type: 'module' });
            await output.request({ type: 'open', handle: output.handle });
        } catch (error) {
            await output.abort();
            console.warn('Disk-backed export unavailable; using Blob output:', error);
        }
        return output;
    }

    async write(chunk: Uint8Array<ArrayBuffer>): Promise<void> {
        if (!chunk.length) return;
        if (this.worker) {
            // Do not transfer fflate's buffers: its compressor may still own them.
            await this.request({ type: 'write', chunk });
        } else {
            // Release each typed array immediately instead of retaining every output buffer
            // alongside the final Blob. This fallback still needs O(output size) blob storage.
            this.parts.push(new Blob([chunk]));
        }
        // Awaiting resolved promises alone does not give rendering/input a turn on iOS.
        if (performance.now() - this.lastYield >= 16) {
            await sleepIfNeeded();
            this.lastYield = performance.now();
        }
    }

    async download(filename: string, mimeType: string): Promise<void> {
        if (this.worker && this.handle) {
            await this.request({ type: 'close' });
            this.worker.terminate();
            this.worker = undefined;
            const file = await this.handle.getFile();
            const directory = this.directory!;
            const name = this.temporaryName!;
            // slice changes MIME type without reading the disk-backed file into an ArrayBuffer.
            downloadBlob(file.slice(0, file.size, mimeType), filename, () => {
                void directory.removeEntry(name).catch(error => console.warn('Export cleanup failed:', error));
            });
            // The download callback now owns cleanup; abort must not remove a live download.
            this.temporaryName = undefined;
            this.handle = undefined;
            this.directory = undefined;
        } else {
            const blob = new Blob(this.parts, { type: mimeType });
            this.parts = [];
            downloadBlob(blob, filename);
        }
    }

    async abort(): Promise<void> {
        // Termination alone releases an OPFS lock asynchronously; deleting immediately can
        // fail with NoModificationAllowedError and leak the temporary file until the next day.
        if (this.worker && !this.workerFailed) {
            try { await this.request({ type: 'close' }); } catch { /* Still terminate below. */ }
        }
        this.worker?.terminate();
        this.worker = undefined;
        this.parts = [];
        if (this.directory && this.temporaryName) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await this.directory.removeEntry(this.temporaryName);
                    break;
                } catch (error) {
                    if (attempt === 2) console.warn('Export cleanup failed:', error);
                    else await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        }
        this.handle = undefined;
        this.directory = undefined;
        this.temporaryName = undefined;
    }

    private request(message: ExportOutputRequest): Promise<void> {
        const worker = this.worker!;
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                worker.onmessage = null;
                worker.onerror = null;
                worker.onmessageerror = null;
            };
            const fail = (error: Error) => { this.workerFailed = true; cleanup(); reject(error); };
            const timeout = setTimeout(() => fail(new Error('Export file writer timed out.')), 30_000);
            worker.onmessage = ({ data }: MessageEvent<ExportOutputResponse>) => {
                cleanup();
                if (data.error) reject(new DOMException(data.error.message, data.error.name));
                else resolve();
            };
            worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'Export worker failed.')); };
            worker.onmessageerror = () => fail(new Error('Could not read export worker response.'));
            try { worker.postMessage(message); } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
}
