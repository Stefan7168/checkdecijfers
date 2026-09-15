// ADR 049: the WebGL scene for the 3D municipality demo. Pure three.js, no
// React. Renders ON DEMAND: a requestAnimationFrame loop runs only while a
// height tween or OrbitControls damping is active, or something changed —
// an idle page costs nothing. Everything created here is disposed by
// `dispose()`. The ONLY numbers this scene shows are the FakeDataset's.
import { DirectionalLight, Group, HemisphereLight, Mesh, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ColumnMesh } from './columns.ts';
import { growthSince, populationIn, YEAR_START, type FakeDataset, type FakeMunicipalityRecord, type MunicipalityType } from './fake-data.ts';
import { growthColor, heightFor, MIN_HEIGHT, SCENE_COLORS, type Theme } from './scales.ts';

export interface SceneOptions {
  theme: Theme;
  reducedMotion: boolean;
}
export interface SceneHandle {
  setYear(year: number, animate: boolean): void;
  setTheme(theme: Theme): void;
  setFilter(type: MunicipalityType | 'all'): void;
  setHighlight(code: string | null): void;
  pick(clientX: number, clientY: number): string | null;
  resetView(): void;
  resize(): void;
  dispose(): void;
}

export const CAMERA_HOME = new Vector3(0, 230, 260);
export const HEIGHT_TWEEN_MS = 350;

export function hasWebGl(canvas: HTMLCanvasElement): boolean {
  try {
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function createScene(canvas: HTMLCanvasElement, columns: ColumnMesh[], dataset: FakeDataset, opts: SceneOptions): SceneHandle | null {
  if (!hasWebGl(canvas)) return null;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 1, 2000);
  camera.position.copy(CAMERA_HOME);

  const hemi = new HemisphereLight(0xffffff, 0x444444, 1.0);
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(120, 220, 160);
  scene.add(hemi, sun);

  // Columns are extruded along +z; rotate the whole map so z becomes "up".
  const map = new Group();
  map.rotation.x = -Math.PI / 2;
  scene.add(map);
  const plate = new Mesh(new PlaneGeometry(420, 420), new MeshLambertMaterial({ color: SCENE_COLORS[opts.theme].plate }));
  plate.position.z = -0.05;
  map.add(plate);

  const byCode = new Map<string, { column: ColumnMesh; record: FakeMunicipalityRecord }>();
  const recordByCode = new Map(dataset.records.map((r) => [r.code, r]));
  for (const column of columns) {
    const record = recordByCode.get(column.code);
    if (!record) continue; // a boundary without a record is simply not drawn — never a made-up number
    byCode.set(column.code, { column, record });
    map.add(column.mesh);
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !opts.reducedMotion;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // never below the plate
  controls.minDistance = 80;
  controls.maxDistance = 700;
  controls.target.set(0, 0, 0);

  let theme = opts.theme;
  const reduced = opts.reducedMotion;
  let year = YEAR_START;
  let filter: MunicipalityType | 'all' = 'all';
  let highlighted: string | null = null;

  const targets = new Map<string, number>();
  const tweenFrom = new Map<string, number>();
  let tweenStart = 0;
  let tweening = false;
  let frame: number | null = null;
  let dirty = true;

  const applyColours = (): void => {
    for (const [code, { column, record }] of byCode) {
      const dim = filter !== 'all' && record.type !== filter;
      const m = column.mesh.material;
      m.color.set(growthColor(growthSince(record, year), theme));
      m.transparent = dim;
      m.opacity = dim ? 0.15 : 1;
      m.emissive.set(code === highlighted ? '#ffffff' : '#000000');
      m.emissiveIntensity = code === highlighted ? 0.35 : 0;
      m.needsUpdate = true;
    }
  };

  const tick = (now: number): void => {
    frame = null;
    let keepGoing = false;
    if (tweening) {
      const t = Math.min(1, (now - tweenStart) / HEIGHT_TWEEN_MS);
      const eased = 1 - (1 - t) ** 3;
      for (const [code, { column }] of byCode) {
        const from = tweenFrom.get(code) ?? MIN_HEIGHT;
        const to = targets.get(code) ?? MIN_HEIGHT;
        column.mesh.scale.z = from + (to - from) * eased;
      }
      tweening = t < 1;
      keepGoing = tweening;
      dirty = true;
    }
    if (controls.enableDamping && controls.update()) {
      dirty = true;
      keepGoing = true;
    }
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
    if (keepGoing) frame = requestAnimationFrame(tick);
  };
  const invalidate = (): void => {
    dirty = true;
    if (frame === null) frame = requestAnimationFrame(tick);
  };
  controls.addEventListener('change', invalidate);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const allMeshes = [...byCode.values()].map((v) => v.column.mesh);
  // Code-review fix (2026-09-15): pick() must only raycast against columns
  // matching the active type filter — otherwise a dimmed (opacity 0.15),
  // filtered-out column stayed clickable/hoverable, letting the UI show or
  // pin details for a municipality the filter visually excluded. Rebuilt
  // only on setFilter, not per pick() call (pointer-move is a hot path).
  let pickableMeshes = allMeshes;

  const handle: SceneHandle = {
    setYear(y, animate) {
      year = y;
      for (const [code, { column, record }] of byCode) {
        tweenFrom.set(code, column.mesh.scale.z);
        targets.set(code, heightFor(populationIn(record, y), dataset.maxPopulation));
      }
      applyColours();
      if (animate && !reduced) {
        tweenStart = performance.now();
        tweening = true;
      } else {
        for (const [code, { column }] of byCode) column.mesh.scale.z = targets.get(code) ?? MIN_HEIGHT;
        tweening = false;
      }
      invalidate();
    },
    setTheme(t) {
      theme = t;
      plate.material.color.set(SCENE_COLORS[t].plate);
      hemi.intensity = t === 'dark' ? 0.7 : 1.0;
      applyColours();
      invalidate();
    },
    setFilter(f) {
      filter = f;
      pickableMeshes = f === 'all' ? allMeshes : [...byCode.values()].filter((v) => v.record.type === f).map((v) => v.column.mesh);
      applyColours();
      invalidate();
    },
    setHighlight(code) {
      // Code-review fix (2026-09-15): only touch the previous and new
      // highlighted mesh's emissive properties — this used to call
      // applyColours() (a full colour recompute for every one of ~342
      // meshes) on every hover-target change, and `hover` includes x/y
      // coordinates that change on every pointer-move frame, so a mouse
      // sweep across the map re-ran the full recompute on every frame.
      if (code === highlighted) return;
      const prev = highlighted;
      highlighted = code;
      if (prev !== null) {
        const entry = byCode.get(prev);
        if (entry) {
          entry.column.mesh.material.emissive.set('#000000');
          entry.column.mesh.material.emissiveIntensity = 0;
          entry.column.mesh.material.needsUpdate = true;
        }
      }
      if (code !== null) {
        const entry = byCode.get(code);
        if (entry) {
          entry.column.mesh.material.emissive.set('#ffffff');
          entry.column.mesh.material.emissiveIntensity = 0.35;
          entry.column.mesh.material.needsUpdate = true;
        }
      }
      invalidate();
    },
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickableMeshes, false)[0];
      const data = hit?.object.userData as { code?: string } | undefined;
      return data?.code ?? null;
    },
    resetView() {
      camera.position.copy(CAMERA_HOME);
      controls.target.set(0, 0, 0);
      controls.update();
      invalidate();
    },
    resize() {
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      for (const { column } of byCode.values()) {
        column.mesh.geometry.dispose();
        column.mesh.material.dispose();
      }
      plate.geometry.dispose();
      plate.material.dispose();
      renderer.dispose();
    },
  };

  handle.resize();
  handle.setYear(YEAR_START, false);
  return handle;
}
