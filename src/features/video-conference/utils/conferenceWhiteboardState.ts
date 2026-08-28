import type {
  ConferenceWhiteboardElement,
  ConferenceWhiteboardOperation,
  ConferenceWhiteboardPage,
  ConferenceWhiteboardSnapshot,
} from '../types/conference.types';

export function applyConferenceWhiteboardOperation(
  snapshot: ConferenceWhiteboardSnapshot,
  operation: ConferenceWhiteboardOperation,
): ConferenceWhiteboardSnapshot {
  if (operation.action === 'lock' || operation.action === 'unlock') {
    return {
      ...snapshot,
      boardLocked: Boolean(operation.boardLocked),
      boardRevision: Math.max(
        snapshot.boardRevision,
        Number(operation.boardRevision || 0),
      ),
    };
  }

  if (operation.action === 'add_page' && operation.pageId) {
    if (snapshot.pages.some((page) => page.id === operation.pageId)) {
      return snapshot;
    }

    const page: ConferenceWhiteboardPage = {
      id: operation.pageId,
      title: operation.title || 'صفحه',
      position: Number(operation.position || snapshot.pages.length),
      revision: 1,
      snapshot: { elements: [] },
      updatedAt: operation.timestamp,
    };

    return {
      ...snapshot,
      boardRevision: Math.max(
        snapshot.boardRevision,
        Number(operation.boardRevision || 0),
      ),
      pages: [...snapshot.pages, page].sort(
        (a, b) => a.position - b.position,
      ),
    };
  }

  if (operation.action === 'delete_page' && operation.pageId) {
    return {
      ...snapshot,
      boardRevision: Math.max(
        snapshot.boardRevision,
        Number(operation.boardRevision || 0),
      ),
      pages: snapshot.pages
        .filter((page) => page.id !== operation.pageId)
        .map((page, index) => ({ ...page, position: index })),
    };
  }

  if (!operation.pageId) return snapshot;

  return {
    ...snapshot,
    pages: snapshot.pages.map((page) => {
      if (page.id !== operation.pageId) return page;

      if (operation.action === 'rename_page') {
        return {
          ...page,
          title: operation.title || page.title,
          revision: Math.max(page.revision, Number(operation.revision || 0)),
          updatedAt: operation.timestamp,
        };
      }

      if (operation.action === 'clear_page') {
        return {
          ...page,
          revision: Math.max(page.revision, Number(operation.revision || 0)),
          snapshot: { elements: [] },
          updatedAt: operation.timestamp,
        };
      }

      if (operation.action === 'delete_element' && operation.elementId) {
        return {
          ...page,
          revision: Math.max(page.revision, Number(operation.revision || 0)),
          snapshot: {
            elements: page.snapshot.elements.filter(
              (element) => element.id !== operation.elementId,
            ),
          },
          updatedAt: operation.timestamp,
        };
      }

      if (operation.action === 'upsert_element' && operation.element) {
        const existingIndex = page.snapshot.elements.findIndex(
          (element) => element.id === operation.element?.id,
        );
        const elements = [...page.snapshot.elements];
        if (existingIndex >= 0) elements[existingIndex] = operation.element;
        else elements.push(operation.element);

        return {
          ...page,
          revision: Math.max(page.revision, Number(operation.revision || 0)),
          snapshot: { elements },
          updatedAt: operation.timestamp,
        };
      }

      return page;
    }),
  };
}

export function findConferenceWhiteboardElement(
  snapshot: ConferenceWhiteboardSnapshot,
  pageId: string,
  elementId: string,
): ConferenceWhiteboardElement | null {
  return snapshot.pages
    .find((page) => page.id === pageId)
    ?.snapshot.elements.find((element) => element.id === elementId)
    || null;
}

export function conferenceWhiteboardAssetPaths(
  snapshot: ConferenceWhiteboardSnapshot,
): string[] {
  const paths = new Set<string>();
  for (const page of snapshot.pages) {
    for (const element of page.snapshot.elements) {
      if (element.type === 'image' && element.assetPath) {
        paths.add(element.assetPath);
      }
    }
  }
  return [...paths];
}
