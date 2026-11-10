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
tab.mode = Single -> pages = ids из pagesRepo.getOrderedIds(tab.id), chapters = []
tab.mode = Chapters -> chapters = chaptersRepo.getAll(tab.id), pages = ids страниц каждой главы в её порядке
```

В `pages` лежат только `{ id, chapterId }`, без самих картинок. `getOrderedIds()` читает ключи через индекс `[tabId+chapterOrder+order]`, а каждая страница загружается через `pagesRepo.get(id)` уже перед записью. Все картинки сразу в память не попадают.

Обе ветки пишут результат через `ExportOutput`, потом вызывается `output.download()`. Одновременно может идти только один экспорт. Если что-то упало - `output.abort()` очищает временные данные, ошибка возвращается вызывающему компоненту.

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
regex читает только заголовок "data:mime;base64,"
base64-payload режется на куски по EXPORT_CHUNK_BYTES = 256 KB
каждый кусок пишется как есть, без decode/re-encode
```

Причина: iOS хранит страницы как base64-строки (не Blob), чтобы данные переживали refresh - здесь это используется напрямую, а не гоняется через decode -> encode.

Страница не на iOS (`page.src instanceof Blob`):

```txt
Blob режется через slice() по EXPORT_CHUNK_BYTES = 256 KB
каждый срез: await slice.arrayBuffer() -> encodeBase64Chunk(bytes) -> writeQP(результат)
finalizeBase64Encode(b64State) -> writeQP(хвост)
```

Следствие: в памяти одновременно только текущий срез байт плюс его base64-текст, а не всё изображение целиком как одна большая base64-строка. На iOS сама исходная строка текущей страницы всё ещё загружается из базы целиком.

Metadata в конце тела:

```txt
createMetadata(tab.mode, structure, (_, index) => `page-${index+1}`)
если есть -> writeQP(<script id="molv-manga-structure">JSON</script>)
```

Известная, осознанно не чинимая особенность: имя asset'а для metadata всегда `page-${index+1}` по позиции в массиве pages, независимо от того, была ли эта страница реально записана в тело (unsupported `page.src` -> `continue` без записи вообще). Если страница пропущена, нумерация в metadata и реальные `<div id="page-N">` в файле расходятся. Оставлено ради обратной совместимости со старыми экспортами - не трогать без обсуждения. В ZIP/CBZ (ниже) это сделано правильно, ориентироваться на тот подход, а не переносить его сюда.

## 3] ZIP / CBZ export

Использует fflate `Zip` + `ZipPassThrough` как поток: каждая страница читается и добавляется в архив небольшими кусками.

```txt
zip = new Zip(onChunk)
for each page:
  page = await pagesRepo.get(id)
  assetName = `${index+1}.${ext}`
  assetNames.set(id, assetName)
  entry = new ZipPassThrough(assetName); zip.add(entry)
  for each chunk из imageChunks(page):
    entry.push(chunk, false)
    await drain() -> записать полученные куски через output.write()
  entry.push(пустой chunk, true)
  await drain()
```

`imageChunks()` читает Blob через `slice().arrayBuffer()`, а iOS data URL декодирует из base64 кусками, без `fetch(dataURL)` на всю картинку.

`ZipPassThrough` кладёт картинки без повторного сжатия - PNG/JPEG/GIF/WebP уже сжаты. Это убирает лишнюю нагрузку на основной поток, но архив может быть больше, особенно если исходники хорошо сжимаются.

После каждого `push()` ожидается `drain()`, чтобы выходные куски успели записаться до чтения следующих. Иначе весь готовый архив снова накопился бы в памяти.

Здесь имя asset'а берётся из `assetNames.get(id)` - то есть заполняется только для страниц, которые реально попали в архив. Поэтому в ZIP/CBZ metadata и реальные файлы никогда не расходятся, в отличие от MHTML-ветки выше.

Metadata пишется отдельным entry в архиве, через `ZipDeflate` со сжатием:

```txt
.molv/manga-structure.json
```

fflate пишет обычный ZIP, не ZIP64. Если размер результата доходит до `0xffffffff` байт (около 4 ГиБ) или число записей до `0xffff` (включая metadata), экспорт прерывается с ошибкой, чтобы не скачать повреждённый архив.

## 4] createMetadata

Общая для обоих форматов функция; разница только в том, как получить имя asset'а (`getAsset` callback передаётся из каждой ветки).

```txt
mode = Single -> return undefined
mode = Chapters -> { chapters: [{ title, pages: [{ asset }] }] }
```

Правило: если хоть одна страница не получила asset, metadata не публикуется вовсе - `assets.some(asset => !asset) -> return undefined`. Лучше совсем без metadata, чем с частичным/сломанным манифестом. В MHTML эта проверка не ловит пропущенные страницы, потому что имя `page-N` возвращается всегда (особенность выше).

Страницы группируются по `chapterId` одним проходом, потом из этих групп собираются главы.

Версия зашита в саму metadata:

```txt
marker: MANGA_STRUCTURE_METADATA_MARKER
version: MANGA_STRUCTURE_METADATA_VERSION
```

Формат versioned - при импорте под каждую версию свой парсер, см. [import.README.md](../../../shared/components/molv-drop-uploader/import.README.md).

## 5] Сохранение файла

Общее для MHTML и ZIP/CBZ - [export-output.ts](../../../shared/utils/export-output.ts).

```txt
ExportOutput.create()
OPFS + Worker доступны -> временный файл в molv-export-temp
недоступны -> куски сохраняются как Blob
```

OPFS - файловое хранилище сайта внутри браузера. Запись идёт через [export-output.worker.ts](../../../export-output.worker.ts):

```txt
createSyncAccessHandle() -> открыть временный файл
output.write(chunk) -> отправить кусок в Worker -> дождаться записи
output.download() -> flush + close -> завершить Worker -> getFile() -> downloadBlob()
```

Готовый файл лежит в хранилище браузера, а не собирается целиком в массиве байтов. Для него нужно свободное место в квоте сайта. Основной поток периодически уступает управление браузеру, чтобы интерфейс продолжал отвечать.

Fallback без OPFS/Worker:

```txt
output.write(chunk) -> new Blob([chunk])
output.download() -> new Blob(все части) -> downloadBlob()
```

Здесь расход памяти браузера всё ещё может расти вместе с размером файла. Fallback выбирается только при открытии: если запись уже началась и закончилось место или упал Worker, экспорт прерывается, частичный файл не скачивается.

Очистка:

```txt
после запуска скачивания -> через 60 секунд revokeObjectURL() и удаление временного файла
при ошибке -> закрыть дескриптор, завершить Worker, удалить временный файл
при следующем экспорте -> удалить оставшиеся временные файлы старше суток
```

Сначала закрывается дескриптор, потом удаляется файл: одного `terminate()` недостаточно, файловая блокировка может освободиться с задержкой. 60 секунд после запуска скачивания - задержка очистки; события завершения скачивания у `<a download>` нет.
