import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { gestureReducer, type GestureState, type GestureEvent } from '../../src/state/gesture_fsm.js';

const gestureEventArb: fc.Arbitrary<GestureEvent> = fc.oneof(
  fc.record({
    type: fc.constant('PEN_DOWN' as const),
    x: fc.double({ min: -10000, max: 10000, noNaN: true }),
    y: fc.double({ min: -10000, max: 10000, noNaN: true }),
    pressure: fc.double({ min: 0.05, max: 1.0, noNaN: true }),
  }),
  fc.constant({ type: 'PEN_UP' as const }),
  fc.constant({ type: 'PEN_CANCEL' as const }),
  fc.record({
    type: fc.constant('TOUCH_START' as const),
    touches: fc.array(
      fc.record({
        id: fc.integer({ min: 1, max: 10 }),
        x: fc.double({ min: 0, max: 4000, noNaN: true }),
        y: fc.double({ min: 0, max: 4000, noNaN: true }),
      }),
      { minLength: 1, maxLength: 5 }
    ),
  }),
  fc.constant({ type: 'TOUCH_MOVE_BEYOND_SLOP' as const }),
  fc.constant({ type: 'TOUCH_HOLD_TIMEOUT' as const }),
  fc.constant({ type: 'VOICE_DETECTED' as const }),
  fc.record({
    type: fc.constant('TOUCH_END' as const),
    remainingTouches: fc.integer({ min: 0, max: 4 }),
  }),
  fc.constant({ type: 'TOUCH_CANCEL' as const })
);

describe('Gesture FSM (Headless Verification)', () => {
  let state: GestureState;

  beforeEach(() => {
    state = 'IDLE';
  });

  function dispatch(event: GestureEvent): GestureState {
    state = gestureReducer(state, event);
    return state;
  }

  describe('Pen Input Isolation', () => {
    it('enters PEN_DRAWING directly on PEN_DOWN and returns to IDLE on PEN_UP', () => {
      expect(dispatch({ type: 'PEN_DOWN', x: 100, y: 150, pressure: 0.5 })).toBe('PEN_DRAWING');
      expect(dispatch({ type: 'PEN_UP' })).toBe('IDLE');
    });

    it('returns to IDLE on PEN_CANCEL during PEN_DRAWING', () => {
      expect(dispatch({ type: 'PEN_DOWN', x: 100, y: 150, pressure: 0.5 })).toBe('PEN_DRAWING');
      expect(dispatch({ type: 'PEN_CANCEL' })).toBe('IDLE');
    });
  });

  describe('Touch-Slop Disambiguation & Palm Rejection Recovery', () => {
    it('enters TOUCH_1_PENDING on single touch down', () => {
      expect(dispatch({ type: 'TOUCH_START', touches: [{ id: 1, x: 200, y: 200 }] })).toBe('TOUCH_1_PENDING');
    });

    it('transitions to TOUCH_PANNING only after moving beyond 8px slop', () => {
      dispatch({ type: 'TOUCH_START', touches: [{ id: 1, x: 200, y: 200 }] });
      expect(state).toBe('TOUCH_1_PENDING');

      expect(dispatch({ type: 'TOUCH_MOVE_BEYOND_SLOP' })).toBe('TOUCH_PANNING');
      expect(dispatch({ type: 'TOUCH_END', remainingTouches: 0 })).toBe('IDLE');
    });

    it('transitions to TOUCH_HOLD_MODIFIER when stationary for 220ms', () => {
      dispatch({ type: 'TOUCH_START', touches: [{ id: 1, x: 200, y: 200 }] });
      expect(state).toBe('TOUCH_1_PENDING');

      expect(dispatch({ type: 'TOUCH_HOLD_TIMEOUT' })).toBe('TOUCH_HOLD_MODIFIER');
    });

    it('recovers to IDLE when OS palm rejection fires TOUCH_CANCEL during TOUCH_1_PENDING', () => {
      dispatch({ type: 'TOUCH_START', touches: [{ id: 1, x: 200, y: 200 }] });
      expect(state).toBe('TOUCH_1_PENDING');

      expect(dispatch({ type: 'TOUCH_CANCEL' })).toBe('IDLE');
      expect(dispatch({ type: 'PEN_DOWN', x: 205, y: 205, pressure: 0.6 })).toBe('PEN_DRAWING');
    });
  });

  describe('Bimanual Multi-Touch & Lasso Gestures', () => {
    it('activates instant pen lasso while finger is held stationary in TOUCH_1_PENDING', () => {
      dispatch({ type: 'TOUCH_START', touches: [{ id: 1, x: 100, y: 100 }] });
      expect(state).toBe('TOUCH_1_PENDING');

      expect(dispatch({ type: 'PEN_DOWN', x: 300, y: 300, pressure: 0.9 })).toBe('TOUCH_HOLD_PEN_LASSOING');
      expect(dispatch({ type: 'PEN_UP' })).toBe('TOUCH_HOLD_MODIFIER');
      expect(dispatch({ type: 'TOUCH_END', remainingTouches: 0 })).toBe('IDLE');
    });

    it('activates instant pen lasso while finger is held in TOUCH_HOLD_MODIFIER', () => {
      dispatch({ type: 'TOUCH_START', touches: [{ id: 1, x: 100, y: 100 }] });
      dispatch({ type: 'TOUCH_HOLD_TIMEOUT' });
      expect(state).toBe('TOUCH_HOLD_MODIFIER');

      expect(dispatch({ type: 'PEN_DOWN', x: 350, y: 350, pressure: 0.7 })).toBe('TOUCH_HOLD_PEN_LASSOING');
      expect(dispatch({ type: 'PEN_UP' })).toBe('TOUCH_HOLD_MODIFIER');
    });

    it('transitions to TOUCH_HOLD_VOICE_PROMPTING on voice detected during hold', () => {
      dispatch({ type: 'TOUCH_START', touches: [{ id: 1, x: 100, y: 100 }] });
      dispatch({ type: 'TOUCH_HOLD_TIMEOUT' });
      expect(state).toBe('TOUCH_HOLD_MODIFIER');

      expect(dispatch({ type: 'VOICE_DETECTED' })).toBe('TOUCH_HOLD_VOICE_PROMPTING');
      expect(dispatch({ type: 'TOUCH_END', remainingTouches: 0 })).toBe('IDLE');
    });

    it('immediately transitions to TOUCH_PINCH_ZOOMING on 2+ fingers', () => {
      expect(
        dispatch({
          type: 'TOUCH_START',
          touches: [
            { id: 1, x: 100, y: 100 },
            { id: 2, x: 200, y: 200 },
          ],
        })
      ).toBe('TOUCH_PINCH_ZOOMING');

      expect(dispatch({ type: 'TOUCH_END', remainingTouches: 0 })).toBe('IDLE');
    });
  });

  describe('Property-Based Fuzzing Invariants (fast-check)', () => {
    it('never deadlocks: releasing pen and all touches always returns FSM to IDLE from any reachable state', () => {
      fc.assert(
        fc.property(fc.array(gestureEventArb, { minLength: 1, maxLength: 50 }), (events) => {
          let current: GestureState = 'IDLE';
          for (const ev of events) {
            current = gestureReducer(current, ev);
          }
          current = gestureReducer(current, { type: 'PEN_UP' });
          current = gestureReducer(current, { type: 'TOUCH_END', remainingTouches: 0 });
          expect(current).toBe('IDLE');
        }),
        { numRuns: 250 }
      );
    });

    it('cancellation safety: PEN_CANCEL followed by TOUCH_CANCEL always resets FSM to IDLE', () => {
      fc.assert(
        fc.property(fc.array(gestureEventArb, { minLength: 1, maxLength: 50 }), (events) => {
          let current: GestureState = 'IDLE';
          for (const ev of events) {
            current = gestureReducer(current, ev);
          }
          current = gestureReducer(current, { type: 'PEN_CANCEL' });
          current = gestureReducer(current, { type: 'TOUCH_CANCEL' });
          expect(current).toBe('IDLE');
        }),
        { numRuns: 250 }
      );
    });

    it('palm rejection during active PEN_DRAWING: stray touch events never interrupt PEN_DRAWING', () => {
      const strayTouchArb = fc.oneof(
        fc.record({
          type: fc.constant('TOUCH_START' as const),
          touches: fc.array(
            fc.record({ id: fc.integer({ min: 1, max: 5 }), x: fc.double(), y: fc.double() }),
            { minLength: 1, maxLength: 4 }
          ),
        }),
        fc.constant({ type: 'TOUCH_MOVE_BEYOND_SLOP' as const }),
        fc.constant({ type: 'TOUCH_HOLD_TIMEOUT' as const }),
        fc.record({
          type: fc.constant('TOUCH_END' as const),
          remainingTouches: fc.integer({ min: 0, max: 4 }),
        }),
        fc.constant({ type: 'TOUCH_CANCEL' as const })
      );

      fc.assert(
        fc.property(fc.array(strayTouchArb, { minLength: 1, maxLength: 30 }), (touchEvents) => {
          let current: GestureState = gestureReducer('IDLE', {
            type: 'PEN_DOWN',
            x: 100,
            y: 100,
            pressure: 0.5,
          });
          expect(current).toBe('PEN_DRAWING');

          for (const ev of touchEvents) {
            current = gestureReducer(current, ev);
            expect(current).toBe('PEN_DRAWING');
          }

          current = gestureReducer(current, { type: 'PEN_UP' });
          expect(current).toBe('IDLE');
        }),
        { numRuns: 200 }
      );
    });
  });
});
