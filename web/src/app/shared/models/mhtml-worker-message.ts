import type { MhtmlScannedImage } from '../utils/mhtml-stream-scanner';

export type MhtmlWorkerRequest =
  | { type: 'processLocal'; file: File }
  | { type: 'ackImage' };

export type MhtmlWorkerResponse =
  | { type: 'image'; image: MhtmlScannedImage }
  | { type: 'metadata'; json: string }
  | { type: 'progress'; progress: number }
  | { type: 'result' }
  | { type: 'error'; message: string };
