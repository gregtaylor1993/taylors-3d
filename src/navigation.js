// Room picking and camera focus in plan metres (x east, y north).
import { pointInPolygon, signedArea } from './placement.js';

export const BUBBLE_CONTROLS = ['mode', 'reset', 'section', 'daynight', 'minimap', 'edit'];

export function bubbleControls(config = {}) {
  return Array.isArray(config.bubble_bar_controls)
    ? [...new Set(config.bubble_bar_controls.filter((id) => BUBBLE_CONTROLS.includes(id)))] : [...BUBBLE_CONTROLS];
}

// Prefer the smallest room when an outdoor zone surrounds the house.
export function roomAtPlan(rooms, point, floorId) {
  if (!Array.isArray(point) || !point.every(Number.isFinite)) return null;
  return rooms.filter((r) => r.floorId === floorId && Array.isArray(r.room.polygon) && r.room.polygon.length >= 3
    && pointInPolygon(point, r.room.polygon))
    .sort((a, b) => Math.abs(signedArea(a.room.polygon)) - Math.abs(signedArea(b.room.polygon)))[0] || null;
}

// Pan to the chosen point while retaining the current distance and viewing angle.
export function focusCamera(camera, { x, y, elevation = 0 }) {
  if (!camera || !Array.isArray(camera.position) || !Array.isArray(camera.target)
    || camera.position.length !== 3 || camera.target.length !== 3
    || ![x, y, elevation, ...camera.position, ...camera.target].every(Number.isFinite)) return null;
  const target = [x, elevation, -y];
  return { target, position: camera.position.map((v, i) => v - camera.target[i] + target[i]) };
}
