import type { EmbeddingCanvasApi } from './EmbeddingCanvas';

/**
 * The explorer's main canvas registers its imperative API here so that dialogs (export, camera
 * bookmarks) can reach it without prop drilling. Only one explorer canvas exists at a time.
 */
export const mainCanvas: { current: EmbeddingCanvasApi | null } = { current: null };
