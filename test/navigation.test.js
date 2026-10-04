import { describe, it, expect } from 'vitest';
import { bubbleControls, roomAtPlan, focusCamera } from '../src/navigation.js';

const room = (id, floorId, polygon) => ({ room: { id, polygon }, floorId });
describe('room navigation', () => {
  it('picks the correct floor and the room inside an enclosing outdoor zone', () => {
    const list = [room('garden', 'g', [[-5,-5],[10,-5],[10,10],[-5,10]]),
      room('lounge', 'g', [[0,0],[4,0],[4,3],[0,3]]), room('bedroom', 'f', [[0,0],[4,0],[4,3],[0,3]])];
    expect(roomAtPlan(list, [2,2], 'g').room.id).toBe('lounge');
    expect(roomAtPlan(list, [2,2], 'f').room.id).toBe('bedroom');
    expect(roomAtPlan(list, [7,7], 'g').room.id).toBe('garden');
    expect(roomAtPlan(list, [20,20], 'g')).toBeNull();
    expect(roomAtPlan(list, [NaN,2], 'g')).toBeNull();
  });
  it('preserves camera angle/distance and translates north to negative world z', () => {
    const camera = { position: [10,12,15], target: [1,2,3] };
    expect(focusCamera(camera, { x: 4, y: 7, elevation: 3 })).toEqual({ position: [13,13,5], target: [4,3,-7] });
    expect(camera).toEqual({ position: [10,12,15], target: [1,2,3] });
    expect(focusCamera(camera, { x: NaN, y: 7 })).toBeNull();
  });
  it('orders selected bubbles without unknown or duplicate controls', () => {
    expect(bubbleControls({ bubble_bar_controls: ['edit','mode','bad','edit','minimap'] })).toEqual(['edit','mode','minimap']);
    expect(bubbleControls({ bubble_bar_controls: [] })).toEqual([]);
    expect(bubbleControls()).toContain('reset');
  });
});
