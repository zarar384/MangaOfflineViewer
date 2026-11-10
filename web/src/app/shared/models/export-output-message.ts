// One request at a time: the producer waits for acknowledgement before sending more bytes.
export type ExportOutputRequest =
    | { type: 'open'; handle: FileSystemFileHandle }
    | { type: 'write'; chunk: Uint8Array }
    | { type: 'close' };

export type ExportOutputResponse = {
    error?: { name: string; message: string };
};
