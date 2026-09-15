// ADR 049, reworked v2 (D1′/D2′, session 104): the WebGL scene for the 3D
// municipality demo. Pure three.js, no React. Renders ON DEMAND: a
// requestAnimationFrame loop runs only while a height tween or OrbitControls
// damping is active, or something changed — an idle page costs nothing.
// Everything created here is disposed by `dispose()`. The ONLY numbers this
// scene shows are the FakeDataset's.
//
// v2: the old single flat grey `plate` is gone. Every municipality now gets
// its OWN floor tile (the choropleth terrain, D1′) directly under its own
// inset population column, both fed the identical growthColor() value via
// scales.ts's applyGrowthColor() — they can never visually disagree.
import { DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ColumnMesh, FloorMesh } from './columns.ts';
import { growthSince, populationIn, YEAR_START, type FakeDataset, type FakeMunicipalityRecord, type MunicipalityType } from './fake-data.ts';
import { applyGrowthColor, GROWTH_MID_HEX, heightFor, MIN_HEIGHT, type Theme } from './scales.ts';

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

interface Entry {
  floor: FloorMesh;
  column: ColumnMesh;
  record: FakeMunicipalityRecord;
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

export function createScene(canvas: HTMLCanvasElement, columns: ColumnMesh[], floors: FloorMesh[], dataset: FakeDataset, opts: SceneOptions): SceneHandle | null {
  if (!hasWebGl(canvas)) return null;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 1, 2000);
  camera.position.copy(CAMERA_HOME);

  // D2′: a soft sky/ground hemisphere (ground tuned toward the floor's own
  // neutral midpoint, the same colour growthColor() uses at zero growth —
  // not a new literal) plus TWO directional lights — the original "sun" and
  // a softer fill from roughly the opposite side, so the map doesn't read as
  // lit from one single toy-like direction. Still MeshLambertMaterial, still
  // no shadow maps (a real-time shadow pass over ~342×2 meshes is a
  // perf/complexity jump this plan does not sign up for).
  const hemi = new HemisphereLight(0xffffff, GROWTH_MID_HEX[opts.theme], 1.0);
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(120, 220, 160);
  const fill = new DirectionalLight(0xffffff, 0.5);
  fill.position.set(-140, 200, -140);
  scene.add(hemi, sun, fill);

  // Columns/floor are extruded along +z; rotate the whole map so z becomes "up".
  const map = new Group();
  map.rotation.x = -Math.PI / 2;
  scene.add(map);

  const byCode = new Map<string, Entry>();
  const recordByCode = new Map(dataset.records.map((r) => [r.code, r]));
  const floorByCode = new Map(floors.map((f) => [f.code, f]));
  for (const column of columns) {
    const record = recordByCode.get(column.code);
    const floor = floorByCode.get(column.code);
    if (!record || !floor) continue; // a boundary without a matching record/floor is simply not drawn — never a made-up number
    byCode.set(column.code, { floor, column, record });
    map.add(floor.mesh, column.mesh);
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

  // D1′: growthColor() is computed exactly ONCE per municipality/year and
  // applied to BOTH the floor tile and the column via scales.ts's
  // applyGrowthColor() — they read as one continuous colour by construction,
  // never two separate calls that could drift apart.
  const applyColours = (): void => {
    for (const { floor, column, record } of byCode.values()) {
      const dim = filter !== 'all' && record.type !== filter;
      applyGrowthColor([floor.mesh.material, column.mesh.material], growthSince(record, year), theme);
      for (const material of [floor.mesh.material, column.mesh.material]) {
        material.transparent = dim;
        material.opacity = dim ? 0.15 : 1;
        material.needsUpdate = true;
      }
    }
  };

  const setEntryEmissive = (entry: Entry | undefined, on: boolean): void => {
    if (!entry) return;
    for (const mesh of [entry.floor.mesh, entry.column.mesh]) {
      mesh.material.emissive.set(on ? '#ffffff' : '#000000');
      mesh.material.emissiveIntensity = on ? 0.35 : 0;
      mesh.material.needsUpdate = true;
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
  // v2: raycast against BOTH the column and its floor tile — the floor now
  // covers the full footprint (D1′), so hovering the visible seam/terrain
  // around an inset column still picks the right municipality, not nothing.
  const allMeshes = [...byCode.values()].flatMap((v) => [v.column.mesh, v.floor.mesh]);
  // Code-review fix (2026-09-15, carried forward): pick() must only raycast
  // against meshes matching the active type filter — otherwise a dimmed
  // (opacity 0.15), filtered-out municipality stayed clickable/hoverable.
  // Rebuilt only on setFilter, not per pick() call (pointer-move is a hot path).
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
      hemi.groundColor.set(GROWTH_MID_HEX[t]);
      hemi.intensity = t === 'dark' ? 0.7 : 1.0;
      applyColours();
      invalidate();
    },
    setFilter(f) {
      filter = f;
      pickableMeshes = f === 'all' ? allMeshes : [...byCode.values()].filter((v) => v.record.type === f).flatMap((v) => [v.column.mesh, v.floor.mesh]);
      applyColours();
      invalidate();
    },
    setHighlight(code) {
      // Only touch the previous and new highlighted municipality's emissive
      // properties — a full applyColours() recompute on every hover-target
      // change would re-run growthColor() for every one of ~342 municipalities
      // on every pointer-move frame.
      if (code === highlighted) return;
      setEntryEmissive(highlighted !== null ? byCode.get(highlighted) : undefined, false);
      highlighted = code;
      setEntryEmissive(code !== null ? byCode.get(code) : undefined, true);
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
      for (const { floor, column } of byCode.values()) {
        column.mesh.geometry.dispose();
        column.mesh.material.dispose();
        floor.mesh.geometry.dispose();
        floor.mesh.material.dispose();
      }
      renderer.dispose();
    },
  };

  handle.resize();
  handle.setYear(YEAR_START, false);
  return handle;
}
