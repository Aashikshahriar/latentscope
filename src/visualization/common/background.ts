import type { BackgroundMode } from '@/stores/viewStore';

export function backgroundCss(mode: BackgroundMode, custom: string): string {
  switch (mode) {
    case 'black':
      return '#000000';
    case 'white':
      return '#FFFFFF';
    case 'custom':
      return custom;
    default:
      return 'radial-gradient(ellipse at 50% 40%, #121a2b 0%, #0a0e17 70%)';
  }
}

/** Solid colour equivalent of the background (for exports). */
export function backgroundSolid(mode: BackgroundMode, custom: string): string {
  return mode === 'black' ? '#000000' : mode === 'white' ? '#FFFFFF' : mode === 'custom' ? custom : '#0B0F19';
}
