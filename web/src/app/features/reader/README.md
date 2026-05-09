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
-> rebuild pageIndexMap
-> reset runtime state
-> updateVisiblePages()
-> rebuildChapterTracking()
-> showLoaderNow()
-> loadToken++
-> navToken++
-> setupObserver()
-> observeAllImages()
-> setupScrollPreloadListener()
-> tryLoadAdjacentChapters()
```

---

### RESET

полная очистка runtime состояния:

```txt
revoke all object URLs
-> pageUrls.clear()
-> loadingSet.clear()
-> loadingCount = 0
-> visibleUnloadedCount = 0
-> cancelLoaderDebounce()
-> focusPageId = null
-> fetchingNext = false
-> fetchingPrev = false
-> isPrepending = false
-> isRestoringScroll = false
-> isNavigating = false
-> observedPageIds.clear()
-> teardownScrollPreloadListener()
-> hideLoader()
-> scrollTop = 0
```

---

### TOKENS

```txt
loadToken++
navToken++
```

---

### UPDATE TYPES

```txt
open
merge
navigation
mode switch
zoom/gap change
```

---

## 3] MERGE FLOW

### PURPOSE

merge расширяет полный буфер P

---

### TYPES

```txt
mergePages(next)
mergePages(prev)
```

---

### FLOW

```txt
merge pages
-> mergeChapterTracking()
-> resolve anchorId
-> detect prepend
-> preserveScroll()
-> updateVisiblePages()
-> observeNewImages()
-> loadVisibleRange()
```

---

### PREPEND DETECTION

```txt
firstNewIndex < firstVisibleIndex
-> isPrepending = true
```

---

### PREPEND FIX

в page mode preserveScroll не компенсирует scroll

---

поэтому:

```txt
scrollToPageImmediately(anchorId)
```

---

### POST PREPEND PRELOAD

после prepend:

```txt
loadVisibleRange(8000 / 12000)
```

---

### PURPOSE

прогревает страницы вставленные выше viewport

---

## 4] VIRTUAL WINDOW

### WINDOW

```txt
WINDOW = 60
```

---

### STRUCTURE

```txt
visiblePages = pages.slice(start, end)
```

---

### LIMIT

в DOM максимум ~120 страниц

---

### WINDOW UPDATE

```txt
start = centerIndex - WINDOW
end = centerIndex + WINDOW
```

---

### EDGE FIX

если окно выходит за границы массива:

```txt
clamp start/end
```

---

### JUMP DETECTION

```txt
JUMP_THRESHOLD = 50
```

---

если jump слишком большой:

```txt
revoke all urls
-> pageUrls.clear()
-> replace visiblePages
```

---

### BUFFER SHIFT

```txt
BUFFER = 15
```

---

если пользователь близко к краю окна:

```txt
preserveScroll()
-> updateVisiblePages()
```

---

## 5] INTERSECTION OBSERVER

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

```txt
entries
-> intersecting only
-> sort by distance to center
-> closest first
```

---

### CENTER LOGIC

если есть focusPageId:

```txt
center = focused image center
```

---

иначе:

```txt
center = viewport center
```

---

### LIMITS

```txt
MAX_LOAD = 12
visible candidates = 24
```

---

### OBSERVER FLOW

```txt
intersection
-> update reading position
-> maybe update virtual window
-> tryLoadAdjacentChapters()
-> lazy image loading
```

---

### OBSERVER REUSE

observer не пересоздаётся при merge

---

используется:

```txt
observeNewImages()
```

---

подключаются только новые DOM nodes

---

### OBSERVER BLOCK CONDITIONS

observer полностью блокируется при:

```txt
isNavigating = true
isPrepending = true
isRestoringScroll = true
```

---

### BOOKMARK UPDATE RULE

в scroll mode:

```txt
observer updates currentPage
```

---

в page mode:

```txt
observer updates bookmark only
```

---

navigation state не мутируется observer

---

## 6] LOADING PIPELINE

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
-> ensurePageLoaded()
-> getOrCreateUrl()
-> loadImage()
-> cleanupFarImages()
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

## 7] LOADER

### visibleUnloadedCount

увеличивается только если image реально виден

---

### START

```txt
visible image starts loading
-> visibleUnloadedCount++
```

---

### FINISH

```txt
load finished
-> visibleUnloadedCount--
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

### IMPORTANT

background preload loader не показывает

---

## 8] MEMORY CLEANUP

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

очищается:

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

## 9] SCROLL PRELOAD

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

### PURPOSE

scroll preload:

* дополняет observer
* особенно важен для upward preload
* уменьшает задержки при быстром scroll вверх

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

### BLOCK CONDITIONS

```txt
isNavigating = true
isPrepending = true
isRestoringScroll = true
```

---

## 10] CHAPTER LOADING

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

## 11] CHAPTER TRACKING

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
-> pageIndex lookup
-> chapter range lookup
-> reader.setChapterId()
```

---

## 12] NAVIGATION

### FLOW

```txt
navToken++
-> focusPageId = pageId
-> showLoaderNow()
-> waitForImages()
-> resolvePageIndexForNavigation()
-> isNavigating = true
-> updateVisiblePages()
-> preload target area
-> forced reflow
-> waitForTarget()
-> scrollTo()
-> update state
-> hideLoader()
```

---

### TARGET PRELOAD

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

новая navigation инвалидирует старую

---

## 13] NAVIGATION OUTSIDE BUFFER

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

## 14] SCROLL PRESERVATION

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
-> requestAnimationFrame
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

## 15] VIEWPORT ANCHOR

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

## 16] MODE SWITCH

### FLOW

```txt
navToken++
-> isNavigating = true
-> focusPageId = anchorId
-> resolve anchor
-> updateVisiblePages()
-> setupObserver()
-> observeAllImages()
-> scrollToPageImmediately()
-> loadVisibleRange()
-> isNavigating = false
```

---

### PURPOSE

mode switch сохраняет anchor и viewport position

---

### EXTRA

observer использует focusPageId для priority sorting

---

## 17] ZOOM / GAP REFLOW

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

## 18] STATE FLAGS

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

блокирует observer state updates

---

## 19] TOKENS

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