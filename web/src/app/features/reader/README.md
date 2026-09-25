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

Триггер: change в `reader.pages()` при новом open.

```txt
rebuild pageIndexMap
reset virtual window + rebuild virtualization index
clear url caches
detach old image elements (даже при тех же page ids)
updateVisiblePages(startIndex)
reset runtime flags and counters
rebuildChapterTracking()
showLoaderNow()
loadToken++
navToken++
handleNavigation(currentPageId)
```

После готовности цели:

```txt
setupObserver()
observeAllImages()
setupScrollPreloadListener()
resetIsOpen()
tryLoadAdjacentChapters(currentIndex, allowPrev=true, allowNext=true)
```

Ключевое правило open:

```txt
open и явный переход используют handleNavigation()
ждем целевую картинку, не весь буфер
```

## 3] Merge flow

Триггер: `reader.pagesUpdateKind() === 'merge'`.

```txt
capture previousFirstId из старого pageIndexMap
rebuild pageIndexMap + virtualization index
mergeChapterTracking()
resolve anchorId
detect prepend
preserveScroll(anchorId) -> updateVisiblePages(anchorIndex)
release isPrepending
requestAnimationFrame -> observeNewImages() + loadVisibleRange()
```

Prepend detection:

```txt
previousFirstId = начало полного буфера до обновления
новый первый id != previousFirstId
previousFirstId остается в новом буфере
```

Выбор якоря:

```txt
active navigation -> focusPageId, окно обновляется без компенсации
иначе -> страница с наибольшим видимым пересечением
fallback -> bookmark / currentPageId / первая страница окна
```

После prepend:

```txt
loadVisibleRange(8000 iOS / 12000 others)
отложенный callback проверяет destroyed, loadToken и navToken
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

Observer, `loadVisibleRange()` и navigation используют `loadOnePage()`.

```txt
ensurePageLoaded(page)
getOrCreateUrl(page)
resolve missing dimensions (если нужны)
loadImage(img, url)
release load slot
cleanupFarImages()
loadVisibleRange()
```

Ограничения:

```txt
MAX_LOAD = 12
loadingSet хранит img, promise и failed
повторный запрос -> await существующей загрузки
нет слотов -> цель navigation ждет, background подхватит следующий проход
видимые страницы загружаются раньше дальнего запаса
```

Геометрия:

```txt
width/height известны -> место резервируется до назначения src
width/height отсутствуют -> load вне DOM через существующий pipeline
naturalWidth/naturalHeight -> preserveScroll() -> назначение src в DOM
полученные размеры остаются в памяти, БД не меняется
```

В [image-pipeline.service.ts](engine/image-pipeline.service.ts):

```txt
loadIntoElement ждет load и decode() (если доступен)
timeout = 12s
error / timeout -> rejected promise, не успешная готовность
```

Завершение загрузки:

```txt
проверить loadToken и принадлежность записи перед изменением счетчиков
ошибка сохраняется до нового open, автоматического бесконечного retry нет
освободился слот -> loadVisibleRange() подхватывает пропущенные загрузки
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
isNavigating = true
showLoaderNow() для вертикальных режимов
waitForImages()
resolvePageIndexForNavigation()
updateVisiblePages(index)
requestAnimationFrame
waitForImages()
waitForTarget(pageId) -> loadOnePage()
scrollToPageImmediately(pageId)
setCurrentPage + setCurrentPageBookmark + updateActiveChapter
setupObserver + observeAllImages + setupScrollPreloadListener
resetIsOpen + tryLoadAdjacentChapters
hideLoader()
isNavigating = false
focusPageId = null
loadVisibleRange()
```

Готовность и отмена:

```txt
waitForImages() ждет DOM, не загрузку картинки
waitForTarget() ждет целевую картинку через общий pipeline
после async ожиданий -> проверить destroyed и navToken
только текущая navigation пишет позицию и освобождает флаги
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

Используется при изменении виртуального окна и получении размеров старых страниц.

```txt
capture anchor position
isRestoringScroll = true
callback() меняет окно / размеры
detectChanges()
re-query anchor
apply shift compensation to scrollTop/scrollLeft
restore isRestoringScroll
```

Правило коррекции:

```txt
замер, изменение DOM и компенсация выполняются синхронно
между замерами нет requestAnimationFrame
движение пользователя между кадрами не попадает в поправку
```

Геометрия и browser anchoring:

```txt
известные размеры сохраняются до и после загрузки
неизвестные размеры применяются атомарно через preserveScroll()
overflow-anchor:none внутри ридера -> браузер не дублирует компенсацию
```

Без коррекции позиции:

```txt
active navigation
missing container / anchor
```

## 15] Mode / gap reflow

Mode change effect:

```txt
первоначальный запуск -> без перехода
смена режима -> resolve anchor -> handleNavigation(anchor)
смена dualPageCover в dual -> тот же переход с текущей выбранной страницей
```

Выбор цели:

```txt
active navigation -> focusPageId
иначе -> bookmark / currentPageId / viewport anchor
bookmark приоритетнее currentPageId, который может отставать в page mode
dual сохраняет выбранную страницу внутри текущего разворота
более широкая соседняя страница не перезаписывает bookmark
выход из dual -> та же выбранная страница
```

Gap change effect:

```txt
resolve anchor
preserveScroll(anchor)
updateVisiblePages(anchorIndex)
```

Зависимости effects:

```txt
handleNavigation() и preserveScroll() вызываются через untracked
effects страниц и навигации не подписываются на reader.mode
mode effect сохраняет явную зависимость от reader.mode
```

## 16] Input behavior

Dual spreads:

```txt
dualPageCover=true -> [1], [2, 3], [4, 5], ...
dualPageCover=false -> [1, 2], [3, 4], ...
обложка занимает отдельный экран и определяется по полному буферу
переход выравнивает начало разворота, bookmark сохраняет выбранную страницу
шаг назад с любой страницы [2, 3] -> [1] при включенной обложке
последний неполный разворот дополняется пустой половиной экрана
```

Keyboard:

```txt
ArrowRight/ArrowLeft работают только в horizontal и dual
в полях ввода и окнах настройки клавиши не перелистывают ридер
обработанная клавиша отменяет стандартную прокрутку браузера
```

Wheel:

```txt
deltaX обрабатывается только в horizontal и dual
```

Gesture:

```txt
swipe-next/swipe-prev обрабатываются только в horizontal и dual
touch-action:pan-y pinch-zoom исключает вторую горизонтальную прокрутку браузера
multi-touch не распознается как swipe, pinch-zoom остается браузеру
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

Открытие из библиотеки и reader settings:

```txt
TabsService.openToken отменяет результат более старого open()
loadPages() / loadBookmarks() проверяют актуальную mangaId после чтения БД
goToPage() в settings использует open(), без второго независимого перехода
readerGap=0 сохраняется при повторном создании wrapper
```
