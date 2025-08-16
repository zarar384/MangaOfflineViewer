import {  parseHTMLForImages, decodeQuotedPrintable } from './utils.js';

// mhtmlProcessor.js
export class MHTMLProcessor {
    async getResult(file) {
        const html = new TextDecoder().decode(file);
        const decodedHTML  = decodeQuotedPrintable(html);
        const images = parseHTMLForImages(decodedHTML);
        return { images };
    }
}