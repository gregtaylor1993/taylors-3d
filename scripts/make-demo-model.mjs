// Builds demo/house.glb from the demo layout, tagged with fp userData (see docs/model-builder-guide.md):
// one wrapper group "house" carrying the model's views (fp.views), storey levels (level0 / level1)
// with a tagged room group per room, furniture on the "furniture" layer, a thin ceiling slab per
// storey on the "ceiling" layer (inside the storey above), an exterior level with the outdoor zones,
// a roof level, one tagged lamp object and a window pane on the glass layer. Run: node scripts/make-demo-model.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DEMO_LAYOUT } from '../demo/layout.js';
import { wallSegments } from '../src/layout.js';

// GLTFExporter reads blobs with FileReader, which Node lacks
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((r) => { this.result = r; this.onloadend && this.onloadend(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = `data:${blob.type};base64,` + Buffer.from(r).toString('base64');
      this.onloadend && this.onloadend();
    });
  }
};

const floors = { ground: { elevation: 0, height: 2.7 }, first: { elevation: 3, height: 2.6 } };
const floorOf = (r) => r.floor_id || (['r-kids', 'r-landing', 'r-office', 'r-master', 'r-bath2'].includes(r.id) ? 'first' : 'ground');
const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
const slabMat = mat(0xd9cfc1), wallMat = mat(0xf2efe9), woodMat = mat(0x9b7653), fabricMat = mat(0x6f86a6), roofMat = mat(0x7a4b3a);

const scene = new THREE.Scene();
// the exporter writes the scene's children as top nodes: one wrapper keeps the views on a single root
const house = new THREE.Group();
house.name = 'house';
house.userData.fp = {
  views: [
    { id: 'exterior', label: 'Exterior', show: ['all'] },
    { id: 'ground', label: 'Ground floor', show: ['level:level0', 'role:exterior'], hide: ['role:roof'] },
    { id: 'first', label: 'First floor', show: ['level:level0', 'level:level1', 'role:exterior'], hide: ['role:roof'] },
  ],
};
scene.add(house);
for (const [id, f] of Object.entries(floors)) {
  const g = new THREE.Group();
  g.name = id === 'ground' ? 'level0' : 'level1'; // ids deliberately differ from HA floor ids
  g.userData.fp = { kind: 'level', id: g.name, role: 'storey', order: id === 'ground' ? 0 : 1, elevation: f.elevation, height: f.height };
  const rooms = DEMO_LAYOUT.rooms.filter((r) => floorOf(r) === id);
  for (const r of rooms.filter((x) => !x.outdoor)) {
    const shape = new THREE.Shape(r.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false }), slabMat);
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = f.elevation - 0.2;
    slab.name = 'slab:' + r.area_id;
    const rg = new THREE.Group();
    rg.name = r.area_id;
    rg.userData.fp = { kind: 'room', id: r.area_id, outline: r.polygon, doors: r.doors || [], suggest: { area: r.area_id } };
    rg.add(slab);
    g.add(rg);
  }
  for (const w of wallSegments(rooms)) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const wall = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy) + 0.15, f.height, 0.15), wallMat);
    wall.position.set((w.a[0] + w.b[0]) / 2, f.elevation + f.height / 2, -(w.a[1] + w.b[1]) / 2);
    wall.rotation.y = Math.atan2(dy, dx);
    g.add(wall);
  }
  house.add(g);
}
const furniture = [
  ['sofa', 'ground', fabricMat, [1.2, 3.0], [2.2, 0.9, 0.45]],
  ['coffee_table', 'ground', woodMat, [2.6, 1.6], [1.2, 0.7, 0.45]],
  ['kitchen_table', 'ground', woodMat, [10.5, 2.5], [1.6, 0.9, 0.75]],
  ['bed', 'ground', fabricMat, [2.5, 7.5], [1.8, 2.0, 0.5]],
  ['master_bed', 'first', fabricMat, [2.5, 7.0], [1.6, 2.0, 0.5]],
  ['desk', 'first', woodMat, [10.5, 1.0], [1.6, 0.8, 0.75]],
];
// each piece is a named group on the furniture layer, so a click in 3D picks the piece
for (const [name, fid, m, [x, y], [w, d, h]] of furniture) {
  const piece = new THREE.Group();
  piece.name = name;
  piece.userData.fp = { layer: 'furniture' };
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  box.name = name + '_body';
  box.position.set(x, floors[fid].elevation + h / 2, -y);
  piece.add(box);
  house.getObjectByName(fid === 'ground' ? 'level0' : 'level1').add(piece);
}
// a window pane on the south facade (glass layer: casts no sun shadow, does not hide markers)
const pane = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.02),
  new THREE.MeshStandardMaterial({ color: 0xaaccee, roughness: 0.1, transparent: true, opacity: 0.35, name: 'glass' }));
pane.name = 'window_pane_living';
pane.userData.fp = { layer: 'glass' };
pane.position.set(1.3, 1.5, 0.09);
house.getObjectByName('level0').add(pane);
// ceilings: a thin slab under the next storey up, kept in that storey so it hides with it
const ceiling = (name, top, parent) => {
  const c = new THREE.Mesh(new THREE.BoxGeometry(12, 0.04, 9), mat(0xf7f5f0));
  c.name = name;
  c.position.set(6, top - 0.02, -4.5);
  c.userData.fp = { layer: 'ceiling' };
  parent.add(c);
};
// exterior level: the outdoor rooms as zones (one slab each)
const ext = new THREE.Group();
ext.name = 'exterior';
ext.userData.fp = { kind: 'level', id: 'exterior', role: 'exterior' };
for (const z of DEMO_LAYOUT.rooms.filter((x) => x.outdoor)) {
  const shape = new THREE.Shape(z.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false }), mat(0x9bb58a));
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = -0.1;
  slab.name = 'slab:' + z.area_id;
  const zg = new THREE.Group();
  zg.name = z.area_id;
  zg.userData.fp = { kind: 'zone', id: z.area_id, outline: z.polygon, doors: z.doors || [], suggest: { area: z.area_id } };
  zg.add(slab);
  ext.add(zg);
}
const lampGroup = new THREE.Group();
lampGroup.name = 'terrace_lamp_1';
lampGroup.userData.fp = { kind: 'object', id: 'terrace_lamp_1', type: 'light', suggest: { domain: 'light', area: 'terrace' } };
const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8), mat(0x333333));
lamp.position.set(4.5, 0.6, 2.5);
lampGroup.add(lamp);
ext.add(lampGroup);
house.add(ext);
const roof = new THREE.Group();
roof.name = 'roof';
roof.userData.fp = { kind: 'level', id: 'roof', role: 'roof' };
const r = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 7.8, 2.6, 4, 1), roofMat);
r.rotation.y = Math.PI / 4;
r.scale.set(1, 1, 0.75);
r.position.set(6, 5.6 + 1.3, -4.5);
roof.add(r);
house.add(roof);
ceiling('ceiling_ground', floors.ground.elevation + floors.ground.height, house.getObjectByName('level1'));
ceiling('ceiling_first', floors.first.elevation + floors.first.height, roof);

const glb = await new Promise((res, rej) => new GLTFExporter().parse(scene, res, rej, { binary: true }));
fs.writeFileSync(new URL('../demo/house.glb', import.meta.url), Buffer.from(glb));
console.log('demo/house.glb', glb.byteLength, 'bytes');
