# Manga Offline Viewer
This repository contains two versions of the MangaOfflineViewer project:

- **vanilla-ver** branch — the original Vanilla JS (ESM) version of the application.  
- **Angular PWA version** — currently in progress. This version is being migrated from the vanilla implementation.

Simple web application for viewing MHTML files

## Key Features

- 📂 Load and view MHTML files
- 🖼️ Create image galleries
- 📌 Tab management (add/remove)
- 🏠 Homepage with tab previews
- ⚙️ Gallery display settings:
  - Scroll animation
  - Image spacing
  - Decorative effects (sakura animation)

## Usage

1. **Adding MHTML files**:
   - Click "+" in the tab bar
   - Enter a name and select file
   - Click "Save"

![hippo](https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExdnhwMWRheXUwZWhkNjhwN2x2MzMzNXN0czh3NzBzMTczMTBqN3lnZyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/fcxxhZGqX8kJezP3rN/giphy.gif)

2. **Creating image galleries**:
   - Click the add images button
   - Drag and drop images or ZIP archive into upload area
   - Enter gallery name
   - Click "Create"

![hippo](https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExdm1lY2tkazk2NTM4aWF3MnM0M2szeXpmcTMzZ2F0MWx6bWdlbzZteSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/YxUcEHyY1GtbnEf8cN/giphy.gif)
![hippo](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZ2d5b3I1bTRqMzdreXJ6OGNoOTUxeTR0cGh1cmV3MmYxM3F2cmE0eiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/JqhInw9LRpcJZnvY0Y/giphy.gif)
![hippo](https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNnVzZG91OThjMDRrcTMxYWI3N3B0dmpwdTEzbWpiZGQ1ZmdqdWRvYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GI4VUHN3zMFu8k3Fzb/giphy.gif)

3. **Managing tabs**:
   - View: Click on tab
   - Delete: Click × on tab
   - Return home: "Home" button
   
![hippo](https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExYjBhemJzODkxYmJwejZlNjNzYmoyNWhjY20ydDRnMnZkbXNuc2QxYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/B7UsVvmirunqu9HSgU/giphy.gif)

## Technical Features

- Data storage in IndexedDB and localStorage
- Drag-and-drop file upload support
- Responsive interface
- Image caching for fast access

## System Requirements

- Modern browser with support for:
  - IndexedDB
  - File API
  - Drag and Drop API
