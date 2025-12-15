// Разные хелперы и утилиты
let parseHTML;
const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

if (isBrowser) {
    parseHTML = (html) => {
        const parser = new DOMParser();
        return parser.parseFromString(html, "text/html");
    };
} else {
    // Node.js 
    const { parse } = await import("node-html-parser");
    parseHTML = (html) => parse(html);
}

export function parseHTMLForImages(html) {
    const root = parseHTML(html);
    const images = [];
    // найти все div с id, начинающимся на "page-"
    const pageDivs = root.querySelectorAll('div[id^="page-"]');

    pageDivs.forEach(div => {
        const imgs = div.querySelectorAll('img');
        imgs.forEach(img => {
            const src = img.getAttribute('src') 
                     || img.getAttribute('data-original-src') 
                     || img.getAttribute('data-src');
            if (src) images.push(src);
        });
    });

    return images;
}

export function decodeQuotedPrintable(str) {
 return str.replace(/=\r?\n/g, '')
              .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
                  String.fromCharCode(parseInt(hex, 16)));
}
