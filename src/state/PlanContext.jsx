import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { decodePlan, encodePlan, PARAM } from '../lib/urlState.js';
import { emptyPlan, makeId, planSchema, prunePins } from '../lib/planSchema.js';
import {
  applyClearPin, applyClearPinsForMission, applyMissionAssignees, applySwap,
  clearStalePins, freezeElapsedBeforeEdit, pruneStalePins,
} from '../lib/pins.js';
import { addUniqueEmployees } from '../lib/employees.js';

const PlanContext = createContext(null);

export const usePlan = () => useContext(PlanContext);


/**
 * The plan document lives in the URL and nowhere else - no localStorage, no
 * server. Every edit re-encodes into the hash's query string with `replace` so
 * typing a name doesn't push dozens of history entries.
 */
export function PlanProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState(null);

  // Keeps the fallback document stable across renders: without this, a bad link
  // would mint a fresh `emptyPlan()` (and a fresh `Date.now()`) on every render.
  const fallback = useRef(null);
  const lastBlob = useRef(null);
  const lastDoc = useRef(null);

  const { doc, decodeFailed } = useMemo(() => {
    const blob = new URLSearchParams(location.search).get(PARAM);
    const blank = () => {
      if (!fallback.current) fallback.current = emptyPlan();
      lastBlob.current = null;
      lastDoc.current = fallback.current;
      return fallback.current;
    };

    if (!blob) return { doc: blank(), decodeFailed: false };
    // Decoding is the expensive part of every keystroke; skip it when the blob
    // is the one we just wrote.
    if (blob === lastBlob.current && lastDoc.current) {
      return { doc: lastDoc.current, decodeFailed: false };
    }

    const result = decodePlan(blob);
    if (!result.ok) return { doc: blank(), decodeFailed: true };

    lastBlob.current = blob;
    lastDoc.current = result.plan;
    return { doc: result.plan, decodeFailed: false };
  }, [location.search]);

  // Every mutation passes through here, which is what makes freezing the past
  // work regardless of which page the edit was made on - see freezeElapsedBeforeEdit.
  const setDoc = useCallback((next) => {
    const previous = lastDoc.current ?? doc;
    const frozen = freezeElapsedBeforeEdit(previous, next);
    const parsed = planSchema.parse(prunePins(pruneStalePins(previous, frozen)));
    const encoded = encodePlan(parsed);
    lastBlob.current = encoded;
    lastDoc.current = parsed;
    const params = new URLSearchParams(location.search);
    params.set(PARAM, encoded);
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true });
  }, [doc, location.pathname, location.search, navigate]);

  // Two controls may emit before navigation has rendered the first edit.
  // Compose against the immediately cached document, not that render's closure.
  const update = useCallback((fn) => setDoc(fn(lastDoc.current ?? doc)), [doc, setDoc]);

  /* --- document mutators ------------------------------------------------ */

  const api = useMemo(() => ({
    setField: (key, value) => update((d) => ({ ...d, [key]: value })),

    /**
     * Both adders funnel through `addUniqueEmployees`, so a name that is
     * already on the list is refused whichever box it was typed into. They
     * report what was `skipped` back to the caller instead of swallowing it:
     * a paste that quietly lands short is worse than the duplicate it avoided.
     * An add that turns out to be entirely duplicates leaves the document
     * untouched rather than re-encoding an identical plan.
     */
    addEmployee: (name) => {
      const result = addUniqueEmployees(doc.employees, [name]);
      if (result.added.length > 0) update((d) => ({ ...d, employees: result.employees }));
      return result;
    },

    addEmployees: (names) => {
      const result = addUniqueEmployees(doc.employees, names);
      if (result.added.length > 0) update((d) => ({ ...d, employees: result.employees }));
      return result;
    },

    updateEmployee: (id, patch) => update((d) => ({
      ...d,
      employees: d.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

    removeEmployee: (id) => update((d) => ({
      ...d,
      employees: d.employees.filter((e) => e.id !== id),
      pins: d.pins.filter((p) => p.employeeId !== id),
    })),

    addMission: () => update((d) => ({
      ...d,
      missions: [...d.missions, {
        id: makeId('m', d.missions.map((m) => m.id)),
        name: '',
        type: 'local',
        start: null,
        end: null,
        count: 1,
        // Null, not 1: "same as the daytime count" tracks the field beside it
        // as the planner edits it, instead of quietly pinning nights to one.
        nightCount: null,
      }],
    })),

    updateMission: (id, patch) => update((d) => ({
      ...d,
      missions: d.missions.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

    removeMission: (id) => update((d) => ({
      ...d,
      missions: d.missions.filter((m) => m.id !== id),
      pins: d.pins.filter((p) => p.missionId !== id),
    })),

    /** Whole-mission assignment: the Missions page person-picker. */
    setMissionAssignees: (missionId, employeeIds) => update(
      (d) => applyMissionAssignees(d, missionId, employeeIds),
    ),

    /**
     * Swap who covers one specific shift, and clear the pin behind a shift.
     * Both live in `lib/pins.js` - see there for why coverage, not an exact
     * range match, is what these have to key on.
     */
    pinShift: (missionId, employeeId, start, end, replacingEmployeeId) => update(
      (d) => applySwap(d, { missionId, employeeId, start, end, replacingEmployeeId }),
    ),

    clearPin: (missionId, employeeId, start, end) => update(
      (d) => applyClearPin(d, { missionId, employeeId, start, end }),
    ),

    clearAllPins: () => update((d) => ({ ...d, pins: [] })),

    /**
     * Drop assignments left behind outside the plan period. Offered as a
     * button rather than done silently: it deletes real history, and the
     * automatic prune in `setDoc` deliberately declines the cases this covers.
     */
    clearStalePins: () => update(clearStalePins),

    /**
     * Remove the specific pin a `pin-conflict`/`pin-overflow`/`pin-unavailable`
     * warning reported as dropped, so the warning stops recurring on every
     * render instead of only being explainable. `start`/`end` are omitted for
     * the one warning shape that can't name an exact range (a pin clamped to
     * nothing by the mission's own window); that case clears every pin the
     * person holds on that mission, since there is nothing more specific to
     * key on.
     */
    clearPinByWarning: (warning) => update((d) => (
      warning.start != null && warning.end != null
        ? applyClearPin(d, {
          missionId: warning.missionId,
          employeeId: warning.employeeId,
          start: warning.start,
          end: warning.end,
        })
        : applyClearPinsForMission(d, { missionId: warning.missionId, employeeId: warning.employeeId })
    )),
  }), [doc, update]);

  const value = useMemo(
    () => ({ doc, setDoc, update, notice, setNotice, decodeFailed, ...api }),
    [doc, setDoc, update, notice, decodeFailed, api],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}
