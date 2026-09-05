# Export flow

## 1] Точка входа

`exportManga(tab, format)` в [export.service.ts](../export.service.ts) - единственная публичная точка входа.

```txt
format = MHTML -> exportMHTML()
format = ZIP | CBZ -> exportArchive()
```

Общее для обеих веток:

```txt
getExportStructure(tab)
tab.mode = Single -> pages = pagesRepo.getAll(tab.id), chapters = []
tab.mode = Chapters -> pages = все страницы всех глав (flat), chapters = chaptersRepo.getAll(tab.id)
```

## 2] MHTML export

Формат - не настоящий multipart MIME, а один quoted-printable HTML-документ: RFC822 заголовки + тело вида `<div id="page-N"><img src="data:mime;base64,...">`.

Заголовки пишутся как есть, без QP-кодирования:

```txt
From / Subject / Date / MIME-Version / Content-Type / Content-Transfer-Encoding
```

Дальше один QP-энкодер (`qpState`) держит state на всё тело целиком - prologue, каждую страницу, metadata, суффикс - как будто это один непрерывный QP pass, только выполняемый маленькими кусками через `writeQP()`.

```txt
writeQP(prologue)
for each page: writeQP(открытие div+img, base64 данные, закрытие img+div)
writeQP(metadata script tag, если есть)
writeQP(суффикс)
finalizeQPEncode(qpState) - хвост, который QP не смог решить внутри последнего чанка
```

Страница на iOS (`typeof page.src === 'string'`, это уже data URL):

```txt
regex достаёт mimeType и base64-payload из "data:mime;base64,payload"
payload пишется как есть, без decode/re-encode
```

Причина: iOS хранит страницы как base64-строки (не Blob), чтобы данные переживали refresh - здесь это используется напрямую, а не гоняется через decode -> encode.

Страница не на iOS (`page.src instanceof Blob`):

```txt
bytes = await page.src.arrayBuffer()
режется на срезы по MHTML_ENCODE_CHUNK_BYTES = 256 KB
каждый срез: encodeBase64Chunk(slice) -> writeQP(результат)
finalizeBase64Encode(b64State) -> writeQP(хвост)
```

Следствие: в памяти одновременно только текущий срез байт плюс его base64-текст, а не всё изображение целиком как одна большая base64-строка.

Metadata в конце тела:

```txt
createMetadata(tab.mode, structure, (_, index) => `page-${index+1}`)
если есть -> writeQP(<script id="molv-manga-structure">JSON</script>)
```

Известная, осознанно не чинимая особенность: имя asset'а для metadata всегда `page-${index+1}` по позиции в массиве pages, независимо от того, была ли эта страница реально записана в тело (unsupported `page.src` -> `continue` без записи вообще). Если страница пропущена, нумерация в metadata и реальные `<div id="page-N">` в файле расходятся. Оставлено ради обратной совместимости со старыми экспортами - не трогать без обсуждения. В ZIP/CBZ (ниже) это сделано правильно, ориентироваться на тот подход, а не переносить его сюда.

## 3] ZIP / CBZ export

Использует fflate `Zip` + `ZipDeflate` как поток: каждая страница добавляется в архив сразу после того, как её байты прочитаны, а не после того как весь список страниц собран в памяти.

```txt
zipStream = new Zip(onChunk)
for each page:
  arrayBuffer = page.src.arrayBuffer() (Blob) или fetch(page.src).arrayBuffer() (iOS data URL)
  assetName = `${index+1}.${ext}`
  assetNames.set(page, assetName)
  entryStream = new ZipDeflate(assetName); zipStream.add(entryStream)
  entryStream.push(bytes, true)
```

Здесь имя asset'а берётся из `assetNames.get(page)` - то есть заполняется только для страниц, которые реально попали в архив. Поэтому в ZIP/CBZ metadata и реальные файлы никогда не расходятся, в отличие от MHTML-ветки выше.

Metadata пишется отдельным entry в архиве:

```txt
.molv/manga-structure.json
```

## 4] createMetadata

Общая для обоих форматов функция; разница только в том, как получить имя asset'а (`getAsset` callback передаётся из каждой ветки).

```txt
mode = Single -> return undefined (TODO в коде: пока не понятно, зачем metadata нужна для Single)
mode = Chapters -> { chapters: [{ title, pages: [{ asset }] }] }
```

Правило: если хоть одна страница не получила asset (unsupported source в MHTML-ветке), metadata не публикуется вовсе - `pages.some(page => !getAsset(page)) -> return undefined`. Лучше совсем без metadata, чем с частичным/сломанным манифестом.

Версия зашита в саму metadata:

```txt
marker: MANGA_STRUCTURE_METADATA_MARKER
version: MANGA_STRUCTURE_METADATA_VERSION
```

Формат versioned - при импорте под каждую версию свой парсер, см. [import.README.md](../../../shared/components/molv-drop-uploader/import.README.md).
