# Manga Offline Viewer

Простое веб-приложение для просмотра MHTML-файлов

## Основные функции

- 📂 Загрузка и просмотр MHTML-файлов
- 🖼️ Создание галерей изображений
- 📌 Управление вкладками (добавление/удаление)
- 🏠 Главная страница с превью вкладок
- ⚙️ Настройки отображения галереи:
  - Анимация прокрутки
  - Расстояние между изображениями
  - Декоративные эффекты (анимация сакуры)

## Использование

1. **Добавление MHTML-файла**:
   - Нажмите "+" в панели вкладок
   - Введите название и выберите файл
   - Нажмите "Сохранить"

![hippo](https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExdnhwMWRheXUwZWhkNjhwN2x2MzMzNXN0czh3NzBzMTczMTBqN3lnZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/fcxxhZGqX8kJezP3rN/giphy.gif)

2. **Создание галереи изображений**:
   - Нажмите кнопку добавления изображений
   - Перетащите изображения или ZIP-архив в область загрузки
   - Введите название галереи
   - Нажмите "Создать"

![hippo](https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExdm1lY2tkazk2NTM4aWF3MnM0M2szeXpmcTMzZ2F0MWx6bWdlbzZteSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/YxUcEHyY1GtbnEf8cN/giphy.gif)
![hippo](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZ2d5b3I1bTRqMzdreXJ6OGNoOTUxeTR0cGh1cmV3MmYxM3F2cmE0eiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/JqhInw9LRpcJZnvY0Y/giphy.gif)
![hippo](https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNnVzZG91OThjMDRrcTMxYWI3N3B0dmpwdTEzbWpiZGQ1ZmdqdWRvYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GI4VUHN3zMFu8k3Fzb/giphy.gif)

3. **Управление вкладками**:
   - Просмотр: клик по вкладке
   - Удаление: клик по × на вкладке
   - Возврат на главную: кнопка "Домой"
   
![hippo](https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExYjBhemJzODkxYmJwejZlNjNzYmoyNWhjY20ydDRnMnZkbXNuc2QxYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/B7UsVvmirunqu9HSgU/giphy.gif)

## Технические особенности

- Хранение данных в IndexedDB и localStorage
- Поддержка drag-and-drop для загрузки файлов
- Адаптивный интерфейс
- Кеширование изображений для быстрого доступа

## Системные требования

- Современный браузер с поддержкой:
  - IndexedDB
  - File API
  - Drag and Drop API