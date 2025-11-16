import { Injectable } from '@angular/core';
import { IndexedDbService } from '../database/indexeddb.service';
@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  constructor(private db: IndexedDbService) {}
  readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = (e) => reject(e);
      fr.readAsDataURL(file);
    });
  }
  async importFileAsChapter(file: File) {
    const dataUrl = await this.readFileAsDataURL(file);
    const chapter = { id: file.name + '-' + Date.now(), title: file.name, pages: [dataUrl] };
    await this.db.addChapter(chapter);
    return chapter;
  }
}
