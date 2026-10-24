import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest globals are disabled, so Testing Library cannot register its automatic cleanup.
afterEach(() => cleanup());
