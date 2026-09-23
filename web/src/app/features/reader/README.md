# Reader runtime flow

## 1] Основные сущности

P = полный буфер страниц из [reader.service.ts](../../core/services/reader.service.ts).

```txt
P растет через mergePages(next/prev)
P не режется в reader.service
```

I = pageIndexMap в [reader.component.ts](reader-component/reader.component.ts).

```txt
pageId -> global index
```

V = visiblePages.

```txt
V = виртуальное окно
в DOM только V
```

## 2] Open flow

Триггер: change в `reader.pages()`.

```txt
rebuild pageIndexMap
rebuild virtualization index
reset runtime flags and counters
clear url caches
updateVisiblePages(startIndex)
rebuildChapterTracking()
showLoaderNow()
loadToken++
navToken++
setupObserver()
observeAllImages()
setupScrollPreloadListener()
tryLoadAdjacentChapters(startIndex, allowPrev=false)
```

Ключевое правило open:

```txt
на первом кадре preload только next chapter
prev preload отключен чтобы не сдвигать viewport
```

## 3] Merge flow

Триггер: `reader.pagesUpdateKind() === 'merge'`.

```txt
mergeChapterTracking()
resolve anchorId
detect prepend
preserveScroll(anchorId)
updateVisiblePages(anchorIndex)
observeNewImages()
loadVisibleRange()
```

Prepend detection:

```txt
firstNewId идет раньше firstVisibleId в global index
```

Поведение в page mode после prepend:

```txt
scrollToPageImmediately(anchorId)
```

После снятия `isPrepending`:

```txt
loadVisibleRange(8000 iOS / 12000 others)
```

## 4] Virtual window

Параметры в [virtualization-engine.service.ts](engine/virtualization-engine.service.ts):

```txt
WINDOW = 60
JUMP_THRESHOLD = 50
```

Следствие:

```txt
обычно в DOM до ~120 страниц
```

Обновление окна:

```txt
start = centerIndex - WINDOW
end = centerIndex + WINDOW
clamp to [0, total]
```

Большой jump:

```txt
distance >= JUMP_THRESHOLD
evict old ids
replace whole visible slice
```

## 5] Observer

Observer создается в `setupObserver()`.

```txt
root = readerContainer
threshold = 0
```

Root margin:

```txt
page mode: 0px
horizontal/dual: 1500px iOS, 2500px others по X
scroll: 1500px iOS, 2500px others по Y
```

Порядок обработки entries:

```txt
берутся только intersecting
сортировка по расстоянию до center
```

Если есть `focusPageId`, center смещается к нему.

Блокировки observer:

```txt
isNavigating
isPrepending
isRestoringScroll
```

Правило обновления позиции:

```txt
scroll mode: можно писать currentPage
page mode: currentPage не трогается из observer
bookmark обновляется только когда нет активной navigation
```

## 6] Image loading pipeline

Пайплайн вызывается из observer и из `loadVisibleRange()`.

```txt
ensurePageLoaded(page)
getOrCreateUrl(page)
loadImage(img, url)
cleanupFarImages(currentId)
```

Ограничения:

```txt
MAX_LOAD = 12
loadingSet защищает от дублей
```

В [image-pipeline.service.ts](engine/image-pipeline.service.ts):

```txt
loadIntoElement timeout = 12s
img.onerror не роняет пайплайн
decode() используется когда доступен
```

## 7] Loader

`visibleUnloadedCount` растет только для реально видимых изображений.

```txt
start visible load -> visibleUnloadedCount++
finish visible load -> visibleUnloadedCount--
```

Показ:

```txt
scheduleLoader() with LOADER_DELAY_MS = 300
```

Скрытие:

```txt
visibleUnloadedCount == 0 -> hideLoader()
```

## 8] Memory cleanup

Радиус очистки:

```txt
CLEANUP_RADIUS = 20 iOS
CLEANUP_RADIUS = 50 others
```

Очистка в [image-pipeline.service.ts](engine/image-pipeline.service.ts):

```txt
revoke url outside [currentIndex - radius, currentIndex + radius]
remove id from pageUrls and loadingSet
```

Блок:

```txt
cleanup не запускается при isRestoringScroll
```

## 9] Scroll preload

`setupScrollPreloadListener()` добавляет throttled scroll listener.

```txt
listener -> requestAnimationFrame
loadVisibleRange()
updateReadingPosition()
```

Default preload range в `loadVisibleRange()`:

```txt
1500px iOS
2500px others
```

`loadVisibleRange()` пропускается при:

```txt
isPrepending
isRestoringScroll
```

## 10] Adjacent chapter loading

Порог:

```txt
CHAPTER_TRIGGER = 20
```

```txt
near end -> getNextChapter + mergePages(next)
near start -> getPrevChapter + mergePages(prev)
```

Защиты:

```txt
fetchingNext
fetchingPrev
loadedChapterIds
```

## 11] Chapter tracking

Структура:

```txt
chapterId -> { first, last }
```

Open:

```txt
rebuildChapterTracking()
```

Merge:

```txt
mergeChapterTracking()
```

Активная глава:

```txt
updateActiveChapter(currentPageId)
```

## 12] Navigation

`handleNavigation(pageId)` использует `navToken` для отмены старых асинхронных цепочек.

```txt
navToken++
focusPageId = pageId
showLoaderNow()
waitForImages()
resolvePageIndexForNavigation()
isNavigating = true
updateVisiblePages(index)
preload around target
requestAnimationFrame + forced reflow
waitForTarget(pageId)
scrollController.scrollToPage()
setCurrentPage + setCurrentPageBookmark + updateActiveChapter
hideLoader()
isNavigating = false
```

Target preload range:

```txt
before = MAX_LOAD * 2
after = MAX_LOAD
```

## 13] Navigation outside current buffer

Если target page отсутствует в `pageIndexMap`:

```txt
pagesRepo.get(pageId)
resolve target chapter
getMetaByChapter(targetChapter)
mergePages(next|prev)
waitForPageIndexUpdate(pageId)
```

`waitForPageIndexUpdate`:

```txt
слушает pageIndexMapUpdated$
timeout = 10s
```

## 14] preserveScroll

Используется когда меняется виртуальное окно и нужно удержать якорь в том же месте экрана.

```txt
capture anchor position
callback() mutates DOM/window
next animation frame
re-query anchor
apply shift compensation to scrollTop/scrollLeft
```

Bypass conditions:

```txt
mode = page
isNavigating
isRestoringScroll
missing anchor
```

## 15] Mode / gap reflow

Mode change effect:

```txt
resolve anchor
set isNavigating=true
updateVisiblePages(anchorIndex)
setupObserver + observeAllImages
scrollToPageImmediately(anchor)
loadVisibleRange()
release flags
```

Gap change effect:

```txt
resolve anchor
preserveScroll(anchor)
updateVisiblePages(anchorIndex)
```

## 16] Input behavior

Keyboard:

```txt
ArrowRight/ArrowLeft работают только в horizontal и dual
```

Wheel:

```txt
deltaX обрабатывается только в horizontal и dual
```

Gesture:

```txt
swipe-next/swipe-prev обрабатываются только в horizontal и dual
tap event пробрасывается
```

## 17] State guards

Флаги:

```txt
isNavigating
isPrepending
isRestoringScroll
freezeBookmarkUpdates = isPrepending || isNavigating || isRestoringScroll
```

Назначение:

```txt
блокировать гонки между observer, merge и navigation
```

## 18] Tokens

`navToken`:

```txt
новая navigation отменяет старую async цепочку
```

`loadToken`:

```txt
новый open/reset отменяет старые async load continuation
```