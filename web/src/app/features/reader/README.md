# Reader Image Loading Flow (ReaderComponent + ReaderService)

---

## 1] DEFINITIONS

**P = {p₁, p₂, ..., pₙ}**

* полный буфер страниц
* растёт при merge (next / prev главы)
* не обрезается вообще

---

**pᵢ.src = ∅**

* есть страница, но картинки нет
* просто мета, "заглушка"

---

**I: id => index**

* мапа
* чтобы не бегать по массиву как дебил

---

**V ⊆ P - visiblePages**

* только то, что реально в DOM (~120 страниц)
* остальное не существует для браузера
* "отрезание" происходит здесь, не в P

---

## 2] INITIALIZATION (OPEN / ПРИ ОТКРЫТИИ)

**P <= pagesMeta**

* загружается только мета
* быстро, без картинок

---

**I(p.id) = index**

* сразу строится map

---

**c = currentPage**

* точка старта

---

**V = окно вокруг c**

* не грузится всё подряд
* только кусок вокруг текущей страницы

---

### RESET (clean open)

полная зачистка:

* pageUrls (все object URL удаляются)
* loadingSet / loadingCount
* visibleUnloadedCount
* loader debounce
* focusPageId
* fetchingNext / fetchingPrev
* observedPageIds
* scroll preload listener

---

токены:

* loadToken++
* navToken++

---

пересборка:

* rebuildChapterTracking

---

### UPDATE TYPES

* open = полный reset
* merge = обновление без сброса scroll
* navigation = переход к странице

---

## 3] WINDOW (visiblePages)

```id="win01"
WINDOW = 60
```

---

* в DOM примерно 120 страниц
* остальное не рендерится
* окно двигается вместе с пользователем

---

## 4] INTERSECTION OBSERVER

root = readerContainer

---

### rootMargin

```id="obs01"
iOS: 1500px
остальные: 2500px
```

---

* грузится заранее
* пользователь ещё не дошёл, а уже готово

---

### threshold

```id="obs02"
0
```

---

### логика

* берутся intersecting элементы
* сортируются по расстоянию до центра viewport
* ближе к центру = приоритет

---

### ограничение

```id="obs03"
MAX_LOAD = 12
кандидаты = 2 * MAX_LOAD
```

---

* максимум 12 реально грузится
* максимум 24 рассматривается

---

### поведение

* observer не пересоздаётся при merge
* observeNewImages добавляет только новые элементы
* старые наблюдения не теряются

---

## 5] LOADING (ленивая загрузка)

### условие

* не в loadingSet
* loadingCount < MAX_LOAD

---

### pipeline

1. loadingSet.add(id)
2. loadingCount++
3. ensurePageLoaded (если нет src)
4. getOrCreateUrl
5. img.src = url
6. loadImage
7. cleanupFarImages

---

### visibleUnloadedCount

* увеличивается только если картинка реально в viewport
* берётся состояние на момент старта загрузки

---

### завершение

* loadingSet.delete(id)
* loadingCount--
* visibleUnloadedCount--

---

### защита

* loadToken (старые загрузки отваливаются)
* destroyed (компонент умер — всё стоп)

---

## 6] MEMORY CLEANUP

берётся текущая страница k

```id="mem01"
iOS: 20
остальные: 50
```

---

* всё вне диапазона удаляется
* object URL ревокается
* cache чистится

---

## 7] WINDOW SHIFT

```id="shift01"
BUFFER = 15
```

---

если пользователь близко к краю окна:

* пересчитывается visiblePages
* сохраняется scroll

---

## 7.1] PRESERVE SCROLL

```id="scroll01"
prevDelta = scrollTop - offsetTop

queueMicrotask:
  scrollTop = newOffsetTop + prevDelta
```

---

* выполняется до render
* никакого дергания

---

## 8] PARALLELISM

```id="par01"
loadingCount <= MAX_LOAD
```

---

* жёсткий лимит
* больше нельзя

---

## 9] CHAPTER LOADING

```id="chap01"
CHAPTER_TRIGGER = 20
```

---

* считается относительно всего P (не visiblePages)

---

### условия

* близко к концу буфера — грузится next
* близко к началу — грузится prev

---

### pipeline

* getNextChapter / getPrevChapter
* getMetaByChapter
* mergePages

---

### защита

* loadedChapterIds
* fetchingNext / fetchingPrev

---

* уже загруженные главы повторно не грузятся

---

## 10] CHAPTER TRACKING

```id="chap02"
chapterId => { first, last }
```

---

### обновление

* rebuildChapterTracking при open
* mergeChapterTracking при merge

---

### updateActiveChapter

* определяется по текущей странице
* обновляется reader.chapterId

---

## 11] NAVIGATION

handleNavigation(pageId)

---

### шаги

1. navToken++
2. showLoaderNow()
3. waitForImages()
4. resolvePageIndexForNavigation
5. updateVisiblePages
6. preload соседних страниц
7. waitForTarget
8. scroll
9. обновление state

---

### preload

```id="nav01"
before = MAX_LOAD * 2
after = MAX_LOAD
```

---

### доп

* isNavigating блокирует observer
* forced reflow:

```id="nav02"
void document.body.offsetHeight
```

---

## 12] TOKEN SYSTEM

### navToken

* новая навигация убивает старую

---

### loadToken

* reset убивает старые загрузки

---

* защита от гонок

---

## 13] SCROLL PRELOAD

scroll listener на контейнере

---

### логика

* throttle через requestAnimationFrame
* проход по imgRefs
* проверка расстояния до viewport

```id="sp01"
iOS: 1500px
остальные: 2500px
```

---

### условия

* не загружено
* не в loadingSet
* есть слот

---

### pipeline

* тот же, что у observer

---

* работает параллельно observer
* не заменяет его

---

## 14] LOADER

### visibleUnloadedCount

```id="ld01"
start load (в viewport) => ++
finish => --
```

---

### показ

если > 0:

* scheduleLoader()

---

### debounce

```id="ld02"
300ms
```

---

### управление

* open => showLoaderNow()
* navigation => showLoaderNow()
* всё загрузилось => hideLoader()

---

* фоновые загрузки loader не трогают

---

## 15] VIEWPORT CENTER

* считается центр контейнера
* элементы сортируются по расстоянию до него

---

### focusPageId

используется при:

* navigation
* mode switch

---

* влияет на приоритет загрузки

---

## 16] MODE SWITCH

при смене режима:

* navToken++
* определяется anchor page
* updateVisiblePages
* setupObserver
* observeAllImages
* scrollToPageImmediately
* loadVisibleRange

---