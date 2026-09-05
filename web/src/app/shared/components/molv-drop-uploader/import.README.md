# Import flow

## 1] Точка входа

`onFilesDropped(files)` в [molv-drop-uploader.components.ts](molv-drop-uploader.components.ts) - обрабатывает файлы по одному через `processFile()`.

```txt
.zip / .cbz -> extractArchive()
.mhtml / .mht -> extractMhtml()
обычная картинка -> addImageFile()
```

## 2] ZIP / CBZ import

`openArchiveReader(file)` в [zip-random-access.ts](../../utils/zip-random-access.ts) не грузит архив целиком в память.

```txt
readZipCentralDirectory(file) - читает только EOCD + central directory (маленькие записи в конце файла)
read(name) - File.slice() на нужный entry + inflateSync только для него
```

Fallback, когда формат не поддержан:

```txt
ZIP64 -> ZipRandomAccessUnsupportedError -> unzipSync(весь файл целиком) в память
```

Это осознанно неполный fallback - ZIP64-архивы всё ещё буферизуются целиком, не пытаться "починить" рефакторингом на скорую руку.

Дальше в `extractArchive()`:

```txt
metadata файл есть (.molv/manga-structure.json) и enableMangaStructureMetadata=true -> importStructuredArchive()
иначе -> entries отсортированы numericNameSort, читаются по одному через archive.read(name)
```

Порядок из metadata побеждает физический порядок записей в архиве.

## 3] MHTML import

`scanMhtmlFile()` в [mhtml-stream-scanner.ts](../../utils/mhtml-stream-scanner.ts) читает файл кусками, инкрементально декодирует quoted-printable и base64, и вызывает `onImage` сразу как только очередное изображение декодировано - целиком документ, весь список изображений или base64-текст одной картинки одной строкой никогда не собираются.

Запускается через [mhtml-extractor.service.ts](../../../core/services/mhtml-extractor.service.ts):

```txt
extractStreaming(file, onImage)
worker доступен -> extractWithWorker() (File передаётся в Worker как structured clone, не как копия файла)
worker упал -> extractOnMainThread() (тот же scanMhtmlFile, но в основном потоке)
```

Раньше worker ещё умел отправлять файл на локальный helper server (`server/`) для парсинга - убрано: сервер всё равно буферизовал файл целиком на своей стороне и не работает на iOS Safari. См. комментарий в [app.worker.ts](../../../app.worker.ts).

Сканер ищет внутри потока байт три маркера:

```txt
<div id="page-  -> запоминает pageId для следующей найденной картинки
src="data:image/  -> начинает стриминг base64 payload в Blob
<script id="molv-manga-structure"  -> собирает metadata JSON
```

Важный нюанс матчинга `src="`: это тот же текст, что и хвост `data-src="` / `data-original-src="`. Без проверки символа перед совпадением ("boundary check") строка `data-original-src="data:image/..."` даёт ложное срабатывание - сканер решает, что нашёл вторую картинку внутри одного `<img>`. Из-за этого перед принятием совпадения на `src="` сканер проверяет предыдущий символ (не буква/цифра/дефис), а также умеет буферизовать целиком один `<img ...>` тег и выбирать значение из первого реально присутствующего атрибута по приоритету (`src`, `data-original-src`, `data-src`, `data-srcset`, `srcset`), если настоящего `src` в теге не нашлось. Экспортируемая функция `resolveImgSrcAttribute()` - чистая часть этой логики, без стриминга, её удобно тестировать отдельно.

Любое изменение сканера или `quoted-printable-stream.ts` / `base64-stream.ts` нужно перепроверять на чанках размером 1-7 байт - маркер вроде `=41` или `</script>` может по-настоящему разъехаться на границе двух чтений файла. Регрессионный тест лежит в `web/scripts/mhtml-img-src-priority.regression.ts`.

## 4] Metadata-driven import (обе ветки - ZIP и MHTML)

Единственное место, где стриминг всё-таки буферизует данные заранее: metadata может переставлять страницы относительно их физического порядка в файле, а порядок неизвестен, пока скан не дойдёт до конца (metadata всегда идёт последним элементом).

```txt
extractMhtml() с enableMangaStructureMetadata=true и пустым items():
  scanMhtmlFile собирает blobsByAsset (Map: pageId -> Blob) по ходу единственного прохода по файлу
  metadataJson приходит в самом конце
  parseMangaStructureMetadata(json, доступные assets)
  metadata валидна -> importStructuredMhtml() читает Blob'ы из Map в порядке, заданном metadata
  metadata невалидна или её нет -> import blobsByAsset в физическом порядке (без повторного скана файла)
```

Защита: если metadata ссылается на asset, для которого Blob не был собран ("Missing image data for asset"), весь import откатывается на путь "без metadata" - частично восстановленная структура не остаётся висеть в UI (`catch` внутри `extractMhtml`).

Такая же защита в ZIP-ветке: невалидная или недостижимая metadata -> `console.warn` и fallback на обычный физический порядок entries.

## 5] parseMangaStructureMetadata

В [manga-structure-metadata.ts](../../utils/manga-structure-metadata.ts).

```txt
marker должен совпасть с MANGA_STRUCTURE_METADATA_MARKER, иначе - не наша metadata
version -> switch на конкретный парсер (сейчас есть только v1)
```

Правило версионирования: у каждой версии metadata - свой парсер. Старые парсеры не удаляются и не переиспользуются под новую версию формата, иначе файлы, экспортированные более старой версией приложения, перестанут импортироваться.

## 6] Общий хвост (importStructured)

Общий код для ZIP- и MHTML-веток после того как metadata распарсена:

```txt
items = mode chapters ? все pages всех chapters подряд : pages
for each item: addPage(item) - своя реализация Blob-чтения в каждой ветке
importedMetadata / importedPagesByAsset запоминаются на компоненте для последующего saveAll()
```

`saveAll()` использует `importedMetadata` вместо обычного `saveOrUpdateTabWithPages`, но только если импортированная metadata есть и это новый таб (`!tab.id`) - импорт поверх существующего таба всегда идёт по обычному пути.

## 7] iOS-специфика (`addBlobImage`)

```txt
isIOS -> pageSrc = FileReader.readAsDataURL(blob) (base64 data URL строка)
иначе -> pageSrc = blob (обычный Blob)
```

Причина: на iOS base64 data URL строка переживает refresh страницы, а Blob URL - нет. Любой новый код, читающий или пишущий `page.src`, обязан сохранять эту ветку (`isIOS && typeof page.src === 'string'`), а не считать, что `page.src` - всегда `Blob`.
