/**
 * NoteFlow Gesture State Machine
 * Implements touch-slop (8px) disambiguation, hold timer (220ms),
 * and OS palm-rejection cancellation recovery (PEN_CANCEL / TOUCH_CANCEL)
 * to separate 1-finger pan from stationary hold modifier + pen lasso / voice.
 * Specification: docs/SPEC.md §5.3
 */

export const TOUCH_SLOP_PX = 8;
export const HOLD_TIMEOUT_MS = 220;

export function isBeyondTouchSlop(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) > TOUCH_SLOP_PX;
}

export type GestureState =
  | 'IDLE'
  | 'PEN_DRAWING'
  | 'TOUCH_1_PENDING'          // Disambiguates stationary hold vs. pan (8px slop)
  | 'TOUCH_PANNING'
  | 'TOUCH_PINCH_ZOOMING'
  | 'TOUCH_HOLD_MODIFIER'      // Finger held stationary >=220ms; ready for Pen or Voice
  | 'TOUCH_HOLD_PEN_LASSOING'
  | 'TOUCH_HOLD_VOICE_PROMPTING';

export type GestureEvent =
  | { type: 'PEN_DOWN'; x: number; y: number; pressure: number }
  | { type: 'PEN_UP' }
  | { type: 'PEN_CANCEL' }
  | { type: 'TOUCH_START'; touches: Array<{ id: number; x: number; y: number }> }
  | { type: 'TOUCH_MOVE_BEYOND_SLOP' } // Fired when finger moves > 8px from TOUCH_START
  | { type: 'TOUCH_HOLD_TIMEOUT' }     // Fired after 220ms if finger stayed <= 8px
  | { type: 'VOICE_DETECTED' }
  | { type: 'TOUCH_END'; remainingTouches: number }
  | { type: 'TOUCH_CANCEL' };

export function gestureReducer(state: GestureState, event: GestureEvent): GestureState {
  switch (state) {
    case 'IDLE':
      if (event.type === 'PEN_DOWN') return 'PEN_DRAWING';
      if (event.type === 'TOUCH_START' && event.touches.length === 1) return 'TOUCH_1_PENDING';
      if (event.type === 'TOUCH_START' && event.touches.length >= 2) return 'TOUCH_PINCH_ZOOMING';
      return state;

    case 'TOUCH_1_PENDING':
      if (event.type === 'PEN_DOWN') return 'TOUCH_HOLD_PEN_LASSOING';
      if (event.type === 'TOUCH_MOVE_BEYOND_SLOP') return 'TOUCH_PANNING';
      if (event.type === 'TOUCH_HOLD_TIMEOUT') return 'TOUCH_HOLD_MODIFIER';
      if (event.type === 'TOUCH_START' && event.touches.length >= 2) return 'TOUCH_PINCH_ZOOMING';
      if (event.type === 'TOUCH_CANCEL' || (event.type === 'TOUCH_END' && event.remainingTouches === 0)) {
        return 'IDLE';
      }
      return state;

    case 'TOUCH_PANNING':
      if (event.type === 'TOUCH_START' && event.touches.length >= 2) return 'TOUCH_PINCH_ZOOMING';
      if (event.type === 'TOUCH_CANCEL' || (event.type === 'TOUCH_END' && event.remainingTouches === 0)) {
        return 'IDLE';
      }
      return state;

    case 'TOUCH_HOLD_MODIFIER':
      if (event.type === 'PEN_DOWN') return 'TOUCH_HOLD_PEN_LASSOING';
      if (event.type === 'VOICE_DETECTED') return 'TOUCH_HOLD_VOICE_PROMPTING';
      if (event.type === 'TOUCH_CANCEL' || (event.type === 'TOUCH_END' && event.remainingTouches === 0)) {
        return 'IDLE';
      }
      return state;

    case 'TOUCH_HOLD_PEN_LASSOING':
      if (event.type === 'PEN_UP' || event.type === 'PEN_CANCEL') return 'TOUCH_HOLD_MODIFIER';
      if (event.type === 'TOUCH_CANCEL' || (event.type === 'TOUCH_END' && event.remainingTouches === 0)) {
        return 'IDLE';
      }
      return state;

    case 'PEN_DRAWING':
      if (event.type === 'PEN_UP' || event.type === 'PEN_CANCEL') return 'IDLE';
      return state;

    default:
      if (event.type === 'TOUCH_CANCEL' || (event.type === 'TOUCH_END' && event.remainingTouches === 0)) {
        return 'IDLE';
      }
      return state;
  }
}
