import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry, CanvasTexture, type Points } from 'three';
import { useReducedMotion, usePageVisible } from '@/hooks/useMediaQuery';
import { createGaussian, createRng } from '@/utils/rng';
import { hexToRgb } from '@/visualization/common/palettes';

const COLORS = ['#7C8CFF', '#38D9C5', '#C084FC', '#F59E0B', '#F472B6', '#60A5FA'];

/** Decorative point cloud: six clusters lying on a gently curved manifold, generated with a fixed seed. */
function buildGeometry(count: number): BufferGeometry {
  const rng = createRng(2024);
  const gauss = createGaussian(rng);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const centers = COLORS.map((_, i) => {
    const t = (i / COLORS.length) * Math.PI * 2;
    return [Math.cos(t) * 1.35, Math.sin(t * 2) * 0.35, Math.sin(t) * 1.35];
  });
  for (let i = 0; i < count; i++) {
    const c = i % COLORS.length;
    const spread = 0.22 + 0.12 * ((c * 7) % 3);
    const [cx, cy, cz] = centers[c]!;
    positions[i * 3] = cx! + gauss() * spread;
    positions[i * 3 + 1] = cy! + gauss() * spread * 0.8;
    positions[i * 3 + 2] = cz! + gauss() * spread;
    const [r, g, b] = hexToRgb(COLORS[c]!);
    colors.set([r, g, b], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function discTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

function Cloud({ animate }: { animate: boolean }) {
  const ref = useRef<Points>(null);
  const geometry = useMemo(() => buildGeometry(3600), []);
  const texture = useMemo(() => discTexture(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
    },
    [geometry, texture],
  );
  useFrame((state, delta) => {
    if (!ref.current || !animate) return;
    ref.current.rotation.y += delta * 0.08;
    const t = state.clock.elapsedTime;
    state.camera.position.y = 1.1 + Math.sin(t * 0.15) * 0.25;
    state.camera.lookAt(0, 0, 0);
  });
  return (
    <points ref={ref} geometry={geometry} rotation={[0.25, 0.6, 0]}>
      <pointsMaterial
        size={0.055}
        map={texture}
        vertexColors
        transparent
        alphaTest={0.02}
        depthWrite={false}
        sizeAttenuation
        opacity={0.92}
      />
    </points>
  );
}

export function HeroCloud() {
  const reduced = useReducedMotion();
  const pageVisible = usePageVisible();
  const container = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    if (!container.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true), {
      threshold: 0.05,
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const animate = !reduced && pageVisible && onScreen;
  return (
    <div ref={container} className="absolute inset-0" aria-hidden>
      <Canvas
        frameloop={animate ? 'always' : 'demand'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.1, 4.2], fov: 45 }}
        gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
      >
        <fog attach="fog" args={['#080b12', 3.2, 7.5]} />
        <Cloud animate={animate} />
      </Canvas>
    </div>
  );
}
