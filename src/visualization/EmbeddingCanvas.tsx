import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  ShaderMaterial,
  TOUCH,
  Vector3,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CameraState, SelectionTool, VisualSettings } from '@/stores/viewStore';
import {
  normalizeCoords,
  pointInPolygon,
  projectToScreen,
  type NormalizedPositions,
} from './common/geometry';
import { pointsFragmentShader, pointsVertexShader } from './shaders/points';
import { Axes2D } from './two-dimensional/Axes2D';
import { SelectionOverlay } from './controls/SelectionOverlay';

export interface EmbeddingCanvasApi {
  /** Renders the current view at `scale` × the on-screen resolution and returns a PNG canvas. */
  capture: (scale: number) => HTMLCanvasElement | null;
  getCamera: () => CameraState | null;
  setCamera: (state: CameraState) => void;
  fit: () => void;
  reset: () => void;
  /** Returns the data-space viewport for 2D views (used by exports). */
  viewport2D: () => { xmin: number; xmax: number; ymin: number; ymax: number } | null;
}

export interface EmbeddingCanvasProps {
  coords: Float32Array;
  dims: 2 | 3;
  /** Dataset row for each coordinate row (null = identity). */
  rowIndices: Uint32Array | null;
  /** Per dataset row RGB. */
  colors: Float32Array;
  /** Per dataset row marker shape index (−1 or any value is clamped). */
  shapes: Int32Array | null;
  /** Per dataset row: 1 = hidden. */
  hidden: Uint8Array | null;
  selection: number[];
  focus: number | null;
  hover: number | null;
  visuals: VisualSettings;
  tool: SelectionTool;
  background: string;
  axisTitles: [string, string, string];
  interactive?: boolean;
  ariaLabel: string;
  onHover?: (row: number | null) => void;
  onPick?: (row: number | null, modifiers: { shift: boolean; alt: boolean; meta: boolean }) => void;
  onSelectRegion?: (rows: number[], mode: 'replace' | 'add' | 'subtract') => void;
  fitRequest?: number;
  resetRequest?: number;
  labelFor?: (row: number) => string;
  compact?: boolean;
}

interface Engine {
  camera: Camera | null;
  gl: WebGLRenderer | null;
  scene: Scene | null;
  controls: OrbitControlsImpl | null;
  invalidate: () => void;
  size: { width: number; height: number };
  screen: Float32Array | null;
  screenValid: boolean;
}

const DEFAULT_3D_DIRECTION = new Vector3(1.1, 0.75, 1.5).normalize();
const FOV = 42;

function makeMaterial(perspective: boolean, outline: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: pointsVertexShader,
    fragmentShader: pointsFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: perspective,
    uniforms: {
      uSize: { value: 5 },
      uPixelRatio: { value: 1 },
      uDimOthers: { value: 0 },
      uPerspective: { value: perspective ? 1 : 0 },
      uSizeBoost: { value: 1 },
      uOpacity: { value: 0.9 },
      uShapes: { value: 0 },
      uOutline: { value: outline ? 1 : 0 },
    },
  });
}

/** Builds the per-coordinate-row attribute arrays from per-dataset-row inputs. */
function buildAttributes(
  count: number,
  rowIndices: Uint32Array | null,
  colors: Float32Array,
  shapes: Int32Array | null,
  hidden: Uint8Array | null,
  selected: Set<number>,
) {
  const color = new Float32Array(count * 3);
  const state = new Float32Array(count);
  const shape = new Float32Array(count);
  for (let r = 0; r < count; r++) {
    const row = rowIndices ? rowIndices[r]! : r;
    color[r * 3] = colors[row * 3]!;
    color[r * 3 + 1] = colors[row * 3 + 1]!;
    color[r * 3 + 2] = colors[row * 3 + 2]!;
    const isHidden = hidden !== null && hidden[row] === 1;
    state[r] = isHidden ? -1 : selected.has(row) ? 1 : 0;
    shape[r] = shapes ? Math.max(0, shapes[row]!) : 0;
  }
  return { color, state, shape };
}

function SceneContents({
  props,
  normalized,
  engine,
  onViewChange,
}: {
  props: EmbeddingCanvasProps;
  normalized: NormalizedPositions;
  engine: MutableRefObject<Engine>;
  onViewChange: () => void;
}) {
  const { camera, gl, scene, invalidate, size } = useThree();
  const perspective = props.dims === 3;
  const count = normalized.positions.length / 3;
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  engine.current.camera = camera;
  engine.current.gl = gl;
  engine.current.scene = scene;
  engine.current.invalidate = invalidate;
  engine.current.size = size;
  engine.current.controls = controlsRef.current;

  const selectedSet = useMemo(() => new Set(props.selection), [props.selection]);

  // Main point cloud.
  const main = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(normalized.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aState', new BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aShape', new BufferAttribute(new Float32Array(count), 1));
    geometry.computeBoundingSphere();
    return { geometry, material: makeMaterial(perspective, false) };
  }, [normalized, count, perspective]);

  useEffect(
    () => () => {
      main.geometry.dispose();
      main.material.dispose();
    },
    [main],
  );

  useEffect(() => {
    const { color, state, shape } = buildAttributes(
      count,
      props.rowIndices,
      props.colors,
      props.shapes,
      props.hidden,
      selectedSet,
    );
    (main.geometry.getAttribute('color') as BufferAttribute).copyArray(color).needsUpdate = true;
    (main.geometry.getAttribute('aState') as BufferAttribute).copyArray(state).needsUpdate = true;
    (main.geometry.getAttribute('aShape') as BufferAttribute).copyArray(shape).needsUpdate = true;
    invalidate();
  }, [main, count, props.rowIndices, props.colors, props.shapes, props.hidden, selectedSet, invalidate]);

  // Overlay: selected points drawn again on top with an outline; focus/hover marker on top of that.
  const coordRowOf = useMemo(() => {
    const map = new Map<number, number>();
    for (let r = 0; r < count; r++) map.set(props.rowIndices ? props.rowIndices[r]! : r, r);
    return map;
  }, [props.rowIndices, count]);

  const overlay = useMemo(() => {
    const rows: number[] = [];
    for (const row of props.selection) {
      const r = coordRowOf.get(row);
      if (r !== undefined && !(props.hidden && props.hidden[row] === 1)) rows.push(r);
    }
    const geometry = new BufferGeometry();
    const pos = new Float32Array(rows.length * 3);
    const col = new Float32Array(rows.length * 3);
    const st = new Float32Array(rows.length).fill(1);
    const sh = new Float32Array(rows.length);
    rows.forEach((r, i) => {
      pos.set(normalized.positions.subarray(r * 3, r * 3 + 3), i * 3);
      const row = props.rowIndices ? props.rowIndices[r]! : r;
      col.set(props.colors.subarray(row * 3, row * 3 + 3), i * 3);
      sh[i] = props.shapes ? Math.max(0, props.shapes[row]!) : 0;
    });
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aState', new BufferAttribute(st, 1));
    geometry.setAttribute('aShape', new BufferAttribute(sh, 1));
    return { geometry, material: makeMaterial(perspective, true) };
  }, [
    props.selection,
    props.hidden,
    props.rowIndices,
    props.colors,
    props.shapes,
    coordRowOf,
    normalized,
    perspective,
  ]);

  useEffect(
    () => () => {
      overlay.geometry.dispose();
      overlay.material.dispose();
    },
    [overlay],
  );

  const markerRows = useMemo(() => {
    const out: number[] = [];
    for (const row of [props.focus, props.hover]) {
      if (row === null) continue;
      const r = coordRowOf.get(row);
      if (r !== undefined && !out.includes(r)) out.push(r);
    }
    return out;
  }, [props.focus, props.hover, coordRowOf]);

  const marker = useMemo(() => {
    const geometry = new BufferGeometry();
    const pos = new Float32Array(markerRows.length * 3);
    const col = new Float32Array(markerRows.length * 3);
    markerRows.forEach((r, i) => {
      pos.set(normalized.positions.subarray(r * 3, r * 3 + 3), i * 3);
      const row = props.rowIndices ? props.rowIndices[r]! : r;
      col.set(props.colors.subarray(row * 3, row * 3 + 3), i * 3);
    });
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aState', new BufferAttribute(new Float32Array(markerRows.length).fill(2), 1));
    geometry.setAttribute('aShape', new BufferAttribute(new Float32Array(markerRows.length), 1));
    const material = makeMaterial(perspective, true);
    material.depthTest = false;
    return { geometry, material };
  }, [markerRows, normalized, props.rowIndices, props.colors, perspective]);

  useEffect(
    () => () => {
      marker.geometry.dispose();
      marker.material.dispose();
    },
    [marker],
  );

  // Uniforms shared by all layers.
  useEffect(() => {
    const pixelRatio = gl.getPixelRatio();
    const dim = props.visuals.dimUnselected && props.selection.length > 0 ? 1 : 0;
    for (const m of [main.material, overlay.material, marker.material]) {
      m.uniforms.uSize!.value = props.visuals.pointSize;
      m.uniforms.uPixelRatio!.value = pixelRatio;
      m.uniforms.uOpacity!.value = m === main.material ? props.visuals.opacity : 1;
      m.uniforms.uShapes!.value = props.visuals.shapeEncoding ? 1 : 0;
    }
    main.material.uniforms.uDimOthers!.value = dim;
    main.material.depthWrite = perspective && props.visuals.opacity >= 0.99 && dim === 0;
    invalidate();
  }, [main, overlay, marker, gl, props.visuals, props.selection.length, perspective, invalidate]);

  const handleChange = useCallback(() => {
    engine.current.screenValid = false;
    onViewChange();
  }, [engine, onViewChange]);

  // Canvas resizes change the screen mapping (and the 2D axes).
  useEffect(() => {
    handleChange();
  }, [size.width, size.height, handleChange]);

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableRotate={perspective}
        enableDamping={perspective}
        dampingFactor={0.14}
        screenSpacePanning
        zoomToCursor={!perspective}
        zoomSpeed={perspective ? 0.9 : 1.2}
        rotateSpeed={0.7}
        enabled={props.interactive !== false && props.tool === 'navigate'}
        mouseButtons={
          perspective
            ? { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
            : { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
        }
        touches={
          perspective ? { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN } : { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }
        }
        onChange={handleChange}
      />
      <points geometry={main.geometry} material={main.material} frustumCulled={false} />
      {overlay.geometry.getAttribute('position').count > 0 && (
        <points
          geometry={overlay.geometry}
          material={overlay.material}
          frustumCulled={false}
          renderOrder={1}
        />
      )}
      {markerRows.length > 0 && (
        <points geometry={marker.geometry} material={marker.material} frustumCulled={false} renderOrder={2} />
      )}
      {perspective && (props.visuals.showGrid || props.visuals.showAxes) && (
        <Guides3D
          extent={normalized.extent}
          showGrid={props.visuals.showGrid}
          showAxes={props.visuals.showAxes}
        />
      )}
    </>
  );
}

/** y coordinate of the 3D floor grid (just below the lowest point). */
function floorOf(extent: [number, number, number]): number {
  return -Math.max(extent[1], 0.05) - 0.08;
}

function Guides3D({
  extent,
  showGrid,
  showAxes,
}: {
  extent: [number, number, number];
  showGrid: boolean;
  showAxes: boolean;
}) {
  const floor = floorOf(extent);
  const axes = useMemo(() => {
    const geometry = new BufferGeometry();
    const len = 1.15;
    geometry.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          -len,
          floor,
          0,
          len,
          floor,
          0,
          0,
          floor,
          0,
          0,
          floor + 2 * len,
          0,
          0,
          floor,
          -len,
          0,
          floor,
          len,
        ]),
        3,
      ),
    );
    geometry.setAttribute(
      'color',
      new BufferAttribute(
        new Float32Array([
          0.49, 0.55, 1, 0.49, 0.55, 1, 0.22, 0.85, 0.77, 0.22, 0.85, 0.77, 0.75, 0.52, 0.99, 0.75, 0.52,
          0.99,
        ]),
        3,
      ),
    );
    return geometry;
  }, [floor]);
  useEffect(() => () => axes.dispose(), [axes]);
  return (
    <group>
      {showGrid && <gridHelper args={[2.4, 12, '#34425b', '#1f283a']} position={[0, floor, 0]} />}
      {showAxes && (
        <lineSegments geometry={axes}>
          <lineBasicMaterial vertexColors transparent opacity={0.8} />
        </lineSegments>
      )}
    </group>
  );
}

/** Fits the camera to the visible points. */
function fitCamera(
  engine: Engine,
  positions: Float32Array,
  visible: (r: number) => boolean,
  dims: 2 | 3,
  resetOrientation: boolean,
) {
  const { camera, controls, size } = engine;
  if (!camera || size.width === 0) return;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const count = positions.length / 3;
  let any = false;
  for (let r = 0; r < count; r++) {
    if (!visible(r)) continue;
    any = true;
    for (let k = 0; k < 3; k++) {
      const v = positions[r * 3 + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  if (!any) {
    min.fill(-1);
    max.fill(1);
  }
  const center = new Vector3((min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2);
  if (dims === 2 && camera instanceof OrthographicCamera) {
    const w = Math.max(max[0]! - min[0]!, 1e-3) * 1.12;
    const h = Math.max(max[1]! - min[1]!, 1e-3) * 1.12;
    camera.zoom = Math.min(size.width / w, size.height / h);
    camera.position.set(center.x, center.y, 10);
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    controls?.target.set(center.x, center.y, 0);
  } else if (camera instanceof PerspectiveCamera) {
    let radius = 0;
    for (let r = 0; r < count; r++) {
      if (any && !visible(r)) continue;
      const dx = positions[r * 3]! - center.x;
      const dy = positions[r * 3 + 1]! - center.y;
      const dz = positions[r * 3 + 2]! - center.z;
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    radius = Math.max(radius, 0.05);
    const fovRad = (camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(Math.min(fovRad, fovRad * camera.aspect) / 2)) * 1.05;
    const direction =
      resetOrientation || !controls
        ? DEFAULT_3D_DIRECTION.clone()
        : camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
    if (resetOrientation) camera.up.set(0, 1, 0);
    camera.near = Math.max(distance / 100, 0.001);
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
    controls?.target.copy(center);
  }
  controls?.update();
  engine.screenValid = false;
  engine.invalidate();
}

export const EmbeddingCanvas = forwardRef<EmbeddingCanvasApi, EmbeddingCanvasProps>(
  function EmbeddingCanvas(props, ref) {
    const { coords, dims } = props;
    const normalized = useMemo(() => normalizeCoords(coords, dims), [coords, dims]);
    const count = normalized.positions.length / 3;
    const engine = useRef<Engine>({
      camera: null,
      gl: null,
      scene: null,
      controls: null,
      invalidate: () => {},
      size: { width: 0, height: 0 },
      screen: null,
      screenValid: false,
    });
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewVersion, setViewVersion] = useState(0);
    const rafRef = useRef<number | null>(null);
    const onViewChange = useCallback(() => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setViewVersion((v) => v + 1);
      });
    }, []);
    useEffect(
      () => () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      },
      [],
    );

    const rowOf = useCallback(
      (r: number) => (props.rowIndices ? props.rowIndices[r]! : r),
      [props.rowIndices],
    );
    const visible = useCallback(
      (r: number) => !(props.hidden && props.hidden[rowOf(r)] === 1),
      [props.hidden, rowOf],
    );

    const ensureScreen = useCallback(() => {
      const e = engine.current;
      if (!e.camera || e.size.width === 0) return null;
      if (!e.screenValid || !e.screen) {
        e.screen = projectToScreen(
          normalized.positions,
          e.camera,
          e.size.width,
          e.size.height,
          e.screen ?? undefined,
        );
        e.screenValid = true;
      }
      return e.screen;
    }, [normalized]);

    useEffect(() => {
      engine.current.screenValid = false;
    }, [normalized]);

    const pick = useCallback(
      (x: number, y: number): number | null => {
        const screen = ensureScreen();
        if (!screen) return null;
        const radius = Math.max(6, props.visuals.pointSize * 0.75 + 3);
        let best = -1;
        let bestScore = Infinity;
        for (let r = 0; r < count; r++) {
          const z = screen[r * 3 + 2]!;
          if (z < -1 || z > 1 || !visible(r)) continue;
          const dx = screen[r * 3]! - x;
          const dy = screen[r * 3 + 1]! - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > radius * radius) continue;
          // Prefer closer-to-camera points among near-ties in 3D.
          const score = d2 + (dims === 3 ? z * 4 : 0);
          if (score < bestScore) {
            bestScore = score;
            best = r;
          }
        }
        return best >= 0 ? rowOf(best) : null;
      },
      [ensureScreen, count, visible, rowOf, props.visuals.pointSize, dims],
    );

    const selectPolygon = useCallback(
      (polygon: number[], mode: 'replace' | 'add' | 'subtract') => {
        const screen = ensureScreen();
        if (!screen) return;
        const xs = polygon.filter((_, i) => i % 2 === 0);
        const ys = polygon.filter((_, i) => i % 2 === 1);
        const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const rows: number[] = [];
        for (let r = 0; r < count; r++) {
          if (!visible(r)) continue;
          const z = screen[r * 3 + 2]!;
          if (z < -1 || z > 1) continue;
          const x = screen[r * 3]!;
          const y = screen[r * 3 + 1]!;
          if (x < minX || x > maxX || y < minY || y > maxY) continue;
          if (pointInPolygon(x, y, polygon)) rows.push(rowOf(r));
        }
        props.onSelectRegion?.(rows, mode);
      },
      [ensureScreen, count, visible, rowOf, props],
    );

    // Pointer interaction for the navigate tool: hover and click-to-inspect.
    const hoverRaf = useRef<number | null>(null);
    const downAt = useRef<{ x: number; y: number } | null>(null);
    const localPoint = (event: React.PointerEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const handlePointerMove = (event: React.PointerEvent) => {
      if (props.interactive === false || props.tool !== 'navigate' || !props.onHover) return;
      if (event.buttons !== 0) return;
      const p = localPoint(event);
      if (hoverRaf.current !== null) cancelAnimationFrame(hoverRaf.current);
      hoverRaf.current = requestAnimationFrame(() => {
        hoverRaf.current = null;
        const row = pick(p.x, p.y);
        if (row !== props.hover) props.onHover?.(row);
      });
    };
    const handlePointerDown = (event: React.PointerEvent) => {
      downAt.current = localPoint(event);
    };
    const handlePointerUp = (event: React.PointerEvent) => {
      if (props.interactive === false || props.tool !== 'navigate' || !downAt.current || event.button !== 0)
        return;
      const p = localPoint(event);
      const moved = Math.hypot(p.x - downAt.current.x, p.y - downAt.current.y);
      downAt.current = null;
      if (moved > 4) return;
      props.onPick?.(pick(p.x, p.y), {
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey || event.ctrlKey,
      });
    };

    // Fit when the projection changes and on request.
    const fitRef = useRef(() => fitCamera(engine.current, normalized.positions, visible, dims, false));
    fitRef.current = () => fitCamera(engine.current, normalized.positions, visible, dims, false);
    const resetRef = useRef(() => fitCamera(engine.current, normalized.positions, () => true, dims, true));
    resetRef.current = () => fitCamera(engine.current, normalized.positions, () => true, dims, true);

    const [ready, setReady] = useState(false);
    useEffect(() => {
      if (ready) resetRef.current();
      // Reset only when the coordinates object changes (a new projection), not on every render.
    }, [ready, normalized]);
    useEffect(() => {
      if (ready && props.fitRequest) fitRef.current();
    }, [ready, props.fitRequest]);
    useEffect(() => {
      if (ready && props.resetRequest) resetRef.current();
    }, [ready, props.resetRequest]);

    useImperativeHandle(
      ref,
      () => ({
        capture: (scale: number) => {
          const { gl, scene, camera } = engine.current;
          if (!gl || !scene || !camera) return null;
          const base = gl.getPixelRatio();
          const target = Math.min(base * scale, 8);
          gl.setPixelRatio(target);
          scene.traverse((obj) => {
            const mat = (obj as unknown as { material?: ShaderMaterial }).material;
            if (mat && 'uniforms' in mat && mat.uniforms?.uPixelRatio)
              mat.uniforms.uPixelRatio.value = target;
          });
          gl.render(scene, camera);
          const out = document.createElement('canvas');
          out.width = gl.domElement.width;
          out.height = gl.domElement.height;
          out.getContext('2d')!.drawImage(gl.domElement, 0, 0);
          gl.setPixelRatio(base);
          scene.traverse((obj) => {
            const mat = (obj as unknown as { material?: ShaderMaterial }).material;
            if (mat && 'uniforms' in mat && mat.uniforms?.uPixelRatio) mat.uniforms.uPixelRatio.value = base;
          });
          gl.render(scene, camera);
          engine.current.invalidate();
          return out;
        },
        getCamera: () => {
          const { camera, controls } = engine.current;
          if (!camera) return null;
          const c = camera as PerspectiveCamera | OrthographicCamera;
          return {
            position: c.position.toArray() as [number, number, number],
            target: (controls?.target.toArray() ?? [0, 0, 0]) as [number, number, number],
            zoom: c.zoom,
            up: c.up.toArray() as [number, number, number],
          };
        },
        setCamera: (state) => {
          const { camera, controls } = engine.current;
          if (!camera) return;
          const c = camera as PerspectiveCamera | OrthographicCamera;
          c.position.fromArray(state.position);
          c.up.fromArray(state.up);
          c.zoom = state.zoom;
          c.updateProjectionMatrix();
          controls?.target.fromArray(state.target);
          controls?.update();
          engine.current.screenValid = false;
          engine.current.invalidate();
          onViewChange();
        },
        fit: () => fitRef.current(),
        reset: () => resetRef.current(),
        viewport2D: () => {
          const { camera } = engine.current;
          if (dims !== 2 || !(camera instanceof OrthographicCamera)) return null;
          const toData = (v: number, k: 0 | 1) => v * normalized.scale + normalized.center[k];
          return {
            xmin: toData(camera.position.x + camera.left / camera.zoom, 0),
            xmax: toData(camera.position.x + camera.right / camera.zoom, 0),
            ymin: toData(camera.position.y + camera.bottom / camera.zoom, 1),
            ymax: toData(camera.position.y + camera.top / camera.zoom, 1),
          };
        },
      }),
      [dims, normalized, onViewChange],
    );

    const camera2D = engine.current.camera instanceof OrthographicCamera ? engine.current.camera : null;

    // Text labels (3D axis titles, selected-point labels) are DOM elements positioned by projecting
    // their anchor points with the current camera; they update whenever the view changes.
    const coordRowOf = useMemo(() => {
      const map = new Map<number, number>();
      for (let r = 0; r < count; r++) map.set(props.rowIndices ? props.rowIndices[r]! : r, r);
      return map;
    }, [props.rowIndices, count]);
    const { visuals, axisTitles, labelFor, selection, focus, hidden } = props;
    const overlayLabels = useMemo(() => {
      void viewVersion;
      const { camera, size } = engine.current;
      if (!camera || size.width === 0) return [];
      const anchors: { key: string; text: string; p: [number, number, number]; kind: 'axis' | 'point' }[] =
        [];
      if (dims === 3 && visuals.showAxes) {
        const floor = floorOf(normalized.extent);
        anchors.push({ key: 'ax', text: axisTitles[0], p: [1.25, floor, 0], kind: 'axis' });
        anchors.push({ key: 'ay', text: axisTitles[1], p: [0, floor + 2.4, 0], kind: 'axis' });
        anchors.push({ key: 'az', text: axisTitles[2], p: [0, floor, 1.25], kind: 'axis' });
      }
      if (visuals.showLabels && labelFor) {
        const rows = selection.slice(0, 40);
        if (focus !== null && !rows.includes(focus)) rows.push(focus);
        for (const row of rows) {
          const r = coordRowOf.get(row);
          if (r === undefined || (hidden && hidden[row] === 1)) continue;
          const p = normalized.positions;
          anchors.push({
            key: `p${row}`,
            text: labelFor(row),
            p: [p[r * 3]!, p[r * 3 + 1]!, p[r * 3 + 2]!],
            kind: 'point',
          });
        }
      }
      if (anchors.length === 0) return [];
      const screen = projectToScreen(
        Float32Array.from(anchors.flatMap((a) => a.p)),
        camera,
        size.width,
        size.height,
      );
      return anchors
        .map((a, i) => ({ ...a, x: screen[i * 3]!, y: screen[i * 3 + 1]!, z: screen[i * 3 + 2]! }))
        .filter(
          (a) =>
            a.z >= -1 &&
            a.z <= 1 &&
            a.x >= -50 &&
            a.y >= -20 &&
            a.x <= size.width + 50 &&
            a.y <= size.height + 20,
        );
    }, [
      viewVersion,
      dims,
      normalized,
      visuals.showAxes,
      visuals.showLabels,
      axisTitles,
      labelFor,
      selection,
      focus,
      hidden,
      coordRowOf,
    ]);
    return (
      <div
        ref={containerRef}
        className="relative h-full w-full overflow-hidden"
        style={{
          background: props.background,
          cursor:
            props.tool === 'navigate'
              ? props.hover !== null
                ? 'pointer'
                : dims === 3
                  ? 'grab'
                  : 'move'
              : 'crosshair',
        }}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => props.hover !== null && props.onHover?.(null)}
        role="img"
        aria-label={props.ariaLabel}
      >
        {dims === 2 && props.visuals.showGrid && camera2D && (
          <Axes2D
            camera={camera2D}
            normalized={normalized}
            size={engine.current.size}
            version={viewVersion}
            layer="grid"
            titles={props.axisTitles}
            compact={props.compact}
          />
        )}
        <Canvas
          key={dims}
          className="!absolute inset-0"
          frameloop="demand"
          dpr={[1, 2]}
          orthographic={dims === 2}
          camera={
            dims === 2
              ? { position: [0, 0, 10], zoom: 100, near: 0.01, far: 100 }
              : { position: [2, 1.5, 3], fov: FOV, near: 0.01, far: 100 }
          }
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          onCreated={(state) => {
            engine.current.camera = state.camera;
            engine.current.gl = state.gl;
            engine.current.size = state.size;
            state.gl.setClearColor(0x000000, 0);
            requestAnimationFrame(() => setReady(true));
          }}
          aria-hidden
        >
          <SceneContents props={props} normalized={normalized} engine={engine} onViewChange={onViewChange} />
        </Canvas>
        {dims === 2 && props.visuals.showAxes && camera2D && (
          <Axes2D
            camera={camera2D}
            normalized={normalized}
            size={engine.current.size}
            version={viewVersion}
            layer="axes"
            titles={props.axisTitles}
            compact={props.compact}
          />
        )}
        {overlayLabels.length > 0 && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {overlayLabels.map((l) =>
              l.kind === 'axis' ? (
                <span
                  key={l.key}
                  className="num absolute -translate-x-1/2 -translate-y-1/2 text-2xs whitespace-nowrap text-muted"
                  style={{ left: l.x, top: l.y }}
                >
                  {l.text}
                </span>
              ) : (
                <span
                  key={l.key}
                  className="num absolute ml-2 -translate-y-1/2 rounded bg-canvas/85 px-1 py-px text-2xs whitespace-nowrap text-fg ring-1 ring-line"
                  style={{ left: l.x, top: l.y }}
                >
                  {l.text}
                </span>
              ),
            )}
          </div>
        )}
        {props.interactive !== false && props.tool !== 'navigate' && (
          <SelectionOverlay tool={props.tool} onComplete={selectPolygon} />
        )}
      </div>
    );
  },
);
