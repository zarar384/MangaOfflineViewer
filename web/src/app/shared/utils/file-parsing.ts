export function decodeQuotedPrintable(input: string): string {
  if (!input) return input;

  // delete "soft line breaks" =\r\n or =\n
  let s = input.replace(/=\r?\n/g, '');

  s = s.replace(/=([0-9A-F]{2})/gi, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return '';
    }
  });

  return s;
}

// a simple HTML parser returns a Document.
export function parseHTML(html: string): Document {
  const parser = new DOMParser();
  // text/html возвращает документ, где можно сделать querySelectorAll
  return parser.parseFromString(html, 'text/html');
}

/**
 Extract images from HTML (string).
 First, look for div[id^="page-"] 
 then all img s within these divs. If there are no such divs, take all <img>.

 Return the src array (data:... or urls)
 */
export function parseHTMLForImages(html: string): string[] {
  if (!html) return [];

  const doc = parseHTML(html);
  const images: string[] = [];

  // find typical page containers
  let pageDivs = Array.from(doc.querySelectorAll<HTMLElement>('div[id^="page-"]'));

  if (pageDivs.length === 0) {
    // if page-* isn't present, try selectors 
    pageDivs = Array.from(doc.querySelectorAll<HTMLElement>('div.page, .page, article, body'));
  }

  if (pageDivs.length > 0) {
    for (const div of pageDivs) {
      const imgs = Array.from(div.querySelectorAll<HTMLImageElement>('img'));
      for (const img of imgs) {
        const src =
          img.getAttribute('src') ||
          img.getAttribute('data-original-src') ||
          img.getAttribute('data-src') ||
          img.getAttribute('data-srcset') ||
          img.getAttribute('srcset') ||
          null;
        if (src) images.push(normalizeSrc(src));
      }
    }
  } else {
    // fallback: all images in the document
    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>('img'));
    for (const img of imgs) {
      const src =
        img.getAttribute('src') ||
        img.getAttribute('data-original-src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-srcset') ||
        img.getAttribute('srcset') ||
        null;
      if (src) images.push(normalizeSrc(src));
    }
  }

  // remove duplicates
  return Array.from(new Set(images));
}

function normalizeSrc(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();

  // remove quotation marks at the beginning/end
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }

  return s;
}

// sorts file names numerically when possible
export function numericNameSort(a: string, b: string) {
  // extract a number from a name
  const na = a.match(/(\d+)/);
  const nb = b.match(/(\d+)/);
  if (na && nb) return Number(na[0]) - Number(nb[0]);
  return a.localeCompare(b);
}

export function generateId(): string { return Math.random().toString(36).slice(2, 9); }
export function sleepIfNeeded() { return new Promise(r => setTimeout(r, 0)); }

export function calculateProgress(start: number, end: number, index: number, total: number): number {
  if (total === 0) return end;
  const step = (end - start) / total;
  return Math.min(end, Math.floor(start + step * index));
}