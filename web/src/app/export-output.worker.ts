/// <reference lib="webworker" />

import { ExportOutputRequest, ExportOutputResponse } from './shared/models/export-output-message';

let access: FileSystemSyncAccessHandle | undefined;
let position = 0;

addEventListener('message', async ({ data }: MessageEvent<ExportOutputRequest>) => {
    try {
        switch (data.type) {
            case 'open':
                access = await data.handle.createSyncAccessHandle();
                await access.truncate(0);
                position = 0;
                break;
            case 'write': {
                if (!access) throw new Error('Export file is not open.');
                let offset = 0;
                while (offset < data.chunk.byteLength) {
                    const written = access.write(data.chunk.subarray(offset), { at: position });
                    if (written <= 0) throw new Error('Could not write export file.');
                    offset += written;
                    position += written;
                }
                break;
            }
            case 'close':
                // Older Safari versions returned promises from flush/close/truncate.
                await access?.flush();
                await access?.close();
                access = undefined;
                break;
        }
        postMessage({} satisfies ExportOutputResponse);
    } catch (error) {
        try { await access?.close(); } catch { /* Preserve the original error. */ }
        access = undefined;
        postMessage({ error: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error)
        } } satisfies ExportOutputResponse);
    }
});
