# Reader Image Loading Flow (ReaderComponent + ReaderService)

---

## 1] DEFINITIONS

**P = {p₁, p₂, ..., pₙ}**

* полный буфер страниц
* растёт через mergePages(next / prev)
* никогда не режется

---

**pᵢ.src = ∅**

* загружена только meta
* картинки ещё нет
* lazy fetch через ensurePageLoaded

---

**I: id -> index**

* pageIndexMap
* pageId -> global index
* O(1) lookup

---

**V ⊆ P -> visiblePages**

* виртуальное окно
* только visiblePages существуют в DOM
* остальные страницы не рендерятся

---

## 2] INITIALIZATION (OPEN)

### OPEN FLOW

```txt
reader.pages() change
-> rebuild map
-> reset runtime state
-> updateVisiblePages
-> rebuildChapterTracking
-> setupObserver
-> observeAllImages
-> setupScrollPreloadListener
```

---

### RESET

полная очистка runtime состояния:

* revoke всех object URL
* pageUrls.clear()
* loadingSet.clear()
* loadingCount = 0
* visibleUnloadedCount = 0
* cancelLoaderDebounce()
* fetchingNext = false
* fetchingPrev = false
* focusPageId = null
* observedPageIds.clear()
* teardown scroll preload listener
* scrollTop = 0

---

### TOKENS

```txt
loadToken++
navToken++
```

---

### FLAGS RESET

```txt
isNavigating = false
isPrepending = false
isRestoringScroll = false
```

---

### UPDATE TYPES

* open -> полный reset
* merge -> расширение буфера
* navigation -> переход к странице
* mode switch -> rebuild observer + anchor restore
* zoom/gap -> preserve scroll + rerender window

---

## 3] VIRTUAL WINDOW

```txt
WINDOW = 60
```

---

* в DOM максимум ~120 страниц
* visiblePages = slice вокруг центра
* окно двигается вместе со scroll

---

### WINDOW UPDATE

```txt
start = centerIndex - WINDOW
end = centerIndex + WINDOW
```

---

### JUMP DETECTION

```txt
JUMP_THRESHOLD = 50
```

---

если прыжок слишком большой:

```txt
revoke all urls
-> clear pageUrls
-> replace visiblePages
```

---

### BUFFER SHIFT

```txt
BUFFER = 15
```

---

если пользователь близко к краю visiblePages:

```txt
preserveScroll()
-> updateVisiblePages()
```

---

## 4] INTERSECTION OBSERVER

### ROOT

```txt
root = readerContainer
```

---

### ROOT MARGIN

```txt
iOS -> 1500px
others -> 2500px
```

---

### THRESHOLD

```txt
0
```

---

### PRIORITY SORTING

observer:

```txt
entries
-> intersecting only
-> sort by distance to viewport center
-> closest first
```

---

### VIEWPORT CENTER

если есть focusPageId:

```txt
center = focus element center
```

иначе:

```txt
center = viewport center
```

---

### LIMITS

```txt
MAX_LOAD = 12
candidates = MAX_LOAD * 2
```

---

* максимум 12 загрузок одновременно
* максимум 24 элемента анализируется observer

---

### OBSERVER BEHAVIOR

observer не пересоздаётся при merge

```txt
observeNewImages()
-> attach only new DOM nodes
```

---

старые intersection callbacks не теряются

---

### OBSERVER BLOCK CONDITIONS

observer ничего не делает если:

```txt
isNavigating = true
isPrepending = true
isRestoringScroll = true
```

---

## 5] LOADING PIPELINE

### CONDITIONS

```txt
!loadingSet.has(id)
loadingCount < MAX_LOAD
```

---

### PIPELINE

```txt
loadingSet.add(id)
-> loadingCount++
-> ensurePageLoaded(page)
-> getOrCreateUrl(page)
-> loadImage(img, url)
-> cleanupFarImages(id)
```

---

### ensurePageLoaded

если page.src отсутствует:

```txt
pagesRepo.get(page.id)
-> hydrate page
```

---

### getOrCreateUrl

```txt
string src -> direct return

Blob
-> create object URL
-> cache in pageUrls
```

---

### loadImage

```txt
img.src = url
-> wait load/error
-> timeout 10s
```

---

### FINISH

```txt
loadingSet.delete(id)
-> loadingCount--
```

---

### PROTECTION

```txt
loadToken mismatch -> abort
destroyed = true -> abort
```

---

## 6] LOADER

### visibleUnloadedCount

увеличивается только если image реально в viewport

---

### START

```txt
visible image start load -> ++
```

---

### FINISH

```txt
finish -> --
```

---

### SHOW

```txt
visibleUnloadedCount > 0
-> scheduleLoader()
```

---

### DEBOUNCE

```txt
LOADER_DELAY_MS = 300
```

---

### CONTROL

```txt
open -> showLoaderNow()
navigation -> showLoaderNow()
all visible loaded -> hideLoader()
```

---

background preload loader не показывает

---

## 7] MEMORY CLEANUP

### CLEANUP RADIUS

```txt
iOS -> 20
others -> 50
```

---

### LOGIC

берётся currentIndex

---

всё вне диапазона:

```txt
[currentIndex - radius, currentIndex + radius]
```

---

удаляется:

```txt
revoke object URL
-> delete from pageUrls
-> loadingSet.delete(id)
```

---

### BLOCK CONDITION

cleanup не работает при:

```txt
isRestoringScroll = true
```

---

## 8] SCROLL PRELOAD

### LISTENER

```txt
readerContainer.scroll
```

---

### THROTTLE

```txt
requestAnimationFrame
```

---

### RANGE

```txt
iOS -> 1500px
others -> 2500px
```

---

### CONDITIONS

```txt
image not loaded
!loadingSet.has(id)
loadingCount < MAX_LOAD
```

---

### PIPELINE

тот же pipeline что и observer

---

### PURPOSE

scroll preload:

* дополняет observer
* особенно важен для upward preload
* уменьшает задержки при быстром scroll вверх

---

## 9] CHAPTER LOADING

### TRIGGER

```txt
CHAPTER_TRIGGER = 20
```

---

считается относительно полного P

---

### NEXT CHAPTER

```txt
globalIndex >= total - CHAPTER_TRIGGER
-> getNextChapter()
-> getMetaByChapter()
-> mergePages(next)
```

---

### PREV CHAPTER

```txt
globalIndex <= CHAPTER_TRIGGER
-> getPrevChapter()
-> getMetaByChapter()
-> mergePages(prev)
```

---

### PROTECTION

```txt
fetchingNext
fetchingPrev
loadedChapterIds
```

---

одна глава не грузится дважды

---

## 10] CHAPTER TRACKING

### STRUCTURE

```txt
chapterId -> { first, last }
```

---

### OPEN

```txt
rebuildChapterTracking()
```

---

### MERGE

```txt
mergeChapterTracking()
```

---

### ACTIVE CHAPTER

```txt
currentPageId
-> pageIndex
-> range lookup
-> reader.setChapterId()
```

---

## 11] NAVIGATION

### FLOW

```txt
navToken++
-> focusPageId = pageId
-> showLoaderNow()
-> waitForImages()
-> resolvePageIndexForNavigation()
-> updateVisiblePages()
-> preload target area
-> forced reflow
-> waitForTarget()
-> scrollTo()
-> update state
```

---

### NAVIGATION PRELOAD

```txt
before = MAX_LOAD * 2
after = MAX_LOAD
```

---

### PRELOAD LOGIC

```txt
Promise.all(load pages around target)
```

---

### FORCED REFLOW

```txt
void document.body.offsetHeight
```

---

### STATE UPDATE

```txt
reader.setCurrentPage()
reader.setCurrentPageBookmark()
updateActiveChapter()
```

---

### PROTECTION

```txt
navToken mismatch -> abort
```

---

новая navigation убивает старую

---

## 12] NAVIGATION OUTSIDE BUFFER

если page отсутствует в pageIndexMap:

```txt
pagesRepo.get(pageId)
-> resolve chapter
-> getMetaByChapter()
-> mergePages()
```

---

### DIRECTION DETECTION

```txt
target.order < current.order
-> prev
else
-> next
```

---

### DOM WAIT

после merge:

```txt
wait requestAnimationFrame
-> retry lookup
```

---

## 13] SCROLL PRESERVATION

### preserveScroll(anchorId)

используется при:

* merge prepend
* virtual window shift
* zoom change
* gap change

---

### FLOW

```txt
capture anchor viewport top
-> callback()
-> queueMicrotask
-> recalc anchor top
-> apply scroll compensation
```

---

### COMPENSATION

```txt
shift = newTop - oldTop
container.scrollTop += shift
```

---

### PURPOSE

* no jumping
* stable viewport
* stable prepend behavior

---

### BLOCK CONDITIONS

preserveScroll bypass:

```txt
mode = page
isNavigating = true
isRestoringScroll = true
```

---

## 14] VIEWPORT ANCHOR

### getViewportAnchorPageId()

поиск страницы ближайшей к центру viewport

---

### FLOW

```txt
calculate viewport center
-> iterate imgRefs
-> minimal distance wins
```

---

### USAGE

используется при:

* merge
* mode switch
* zoom change
* gap change

---

## 15] MODE SWITCH

### FLOW

```txt
navToken++
-> isNavigating = true
-> resolve anchor
-> updateVisiblePages()
-> setupObserver()
-> observeAllImages()
-> scrollToPageImmediately()
-> loadVisibleRange()
```

---

### EXTRA

```txt
focusPageId = anchorId
```

---

observer использует focusPageId для приоритетной загрузки

---

## 16] ZOOM / GAP REFLOW

### FLOW

```txt
zoom/gap changed
-> resolve anchor
-> preserveScroll()
-> updateVisiblePages()
```

---

### PURPOSE

layout меняется без viewport jump

---

## 17] STATE FLAGS

### isNavigating

navigation владеет scroll/state

---

### isPrepending

идёт prepend merge

---

### isRestoringScroll

идёт scroll compensation

---

### freezeBookmarkUpdates

```txt
isPrepending
|| isNavigating
|| isRestoringScroll
```

---

блокирует observer updates

---

## 18] TOKENS

### navToken

новая navigation инвалидирует старую

---

### loadToken

новый open/reset инвалидирует старые async load

---

### PURPOSE

защита от:

* race conditions
* stale async continuation
* delayed observer callbacks
* async merge conflicts
