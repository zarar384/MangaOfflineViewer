// пагинация превью на главной

import { state } from './state.js';

export function renderPaginationControls(totalTabs, currentPage, perPage, onPageChange) {
    const oldPagination = document.querySelector('.pagination-controls');
    if (oldPagination) oldPagination.remove();

    const homePageElement = state.dom.homePage;
    if (!homePageElement || homePageElement.style.display !== 'grid') {
        return;
    }

    const totalPages = Math.ceil(totalTabs / perPage);
    const pagination = document.createElement('div');
    pagination.className = 'pagination-controls';

    const prevButton = document.createElement('button');
    prevButton.className = 'pagination-button prev';
    prevButton.innerHTML = '<i class="icon-arrow-left"></i>';
    prevButton.disabled = currentPage === 1;
    prevButton.addEventListener('click', () => {
        if (currentPage > 1) onPageChange(currentPage - 1, perPage);
    });
    pagination.appendChild(prevButton);

    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    if (startPage > 1) {
        const firstPageButton = document.createElement('button');
        firstPageButton.className = 'pagination-button';
        firstPageButton.textContent = '1';
        firstPageButton.addEventListener('click', () => onPageChange(1, perPage));
        pagination.appendChild(firstPageButton);

        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'pagination-ellipsis';
            ellipsis.textContent = '...';
            pagination.appendChild(ellipsis);
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        const pageButton = document.createElement('button');
        pageButton.className = `pagination-button ${i === currentPage ? 'active' : ''}`;
        pageButton.textContent = i;
        pageButton.addEventListener('click', () => onPageChange(i, perPage));
        pagination.appendChild(pageButton);
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'pagination-ellipsis';
            ellipsis.textContent = '...';
            pagination.appendChild(ellipsis);
        }

        const lastPageButton = document.createElement('button');
        lastPageButton.className = 'pagination-button';
        lastPageButton.textContent = totalPages;
        lastPageButton.addEventListener('click', () => onPageChange(totalPages, perPage));
        pagination.appendChild(lastPageButton);
    }

    const nextButton = document.createElement('button');
    nextButton.className = 'pagination-button next';
    nextButton.innerHTML = '<i class="icon-arrow-right"></i>';
    nextButton.disabled = currentPage === totalPages;
    nextButton.addEventListener('click', () => {
        if (currentPage < totalPages) onPageChange(currentPage + 1, perPage);
    });
    pagination.appendChild(nextButton);

    const perPageContainer = document.createElement('div');
    perPageContainer.className = 'pagination-perpage';

    const perPageLabel = document.createElement('span');
    perPageLabel.className = 'pagination-label';
    perPageContainer.appendChild(perPageLabel);

    const perPageSelect = document.createElement('select');
    perPageSelect.className = 'pagination-select';
    [10, 20, 30, 50].forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === perPage;
        perPageSelect.appendChild(option);
    });

    perPageSelect.addEventListener('change', (e) => {
        const newPerPage = parseInt(e.target.value);
        onPageChange(1, newPerPage); // при смене perPage идём на первую страницу
    });

    perPageContainer.appendChild(perPageSelect);
    pagination.appendChild(perPageContainer);

    homePageElement.parentNode.insertBefore(pagination, homePageElement.nextSibling);
}
