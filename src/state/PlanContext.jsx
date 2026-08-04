import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { decodePlan, encodePlan, PARAM } from '../lib/urlState.js';
import { emptyPlan, makeId, planSchema, prunePins } from '../lib/planSchema.js';

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

  const setDoc = useCallback((next) => {
    const parsed = planSchema.parse(prunePins(next));
    const encoded = encodePlan(parsed);
    lastBlob.current = encoded;
    lastDoc.current = parsed;
    const params = new URLSearchParams(location.search);
    params.set(PARAM, encoded);
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const update = useCallback((fn) => setDoc(fn(doc)), [doc, setDoc]);

  /* --- document mutators ------------------------------------------------ */

  const api = useMemo(() => ({
    setField: (key, value) => update((d) => ({ ...d, [key]: value })),

    addEmployee: (name) => update((d) => ({
      ...d,
      employees: [...d.employees, {
        id: makeId('e', d.employees.map((e) => e.id)),
        name,
        start: null,
        end: null,
      }],
    })),

    addEmployees: (names) => update((d) => {
      const employees = [...d.employees];
      for (const name of names) {
        employees.push({
          id: makeId('e', employees.map((e) => e.id)),
          name,
          start: null,
          end: null,
        });
      }
      return { ...d, employees };
    }),

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
    setMissionAssignees: (missionId, employeeIds) => update((d) => ({
      ...d,
      pins: [
        // Drop this mission's whole-window pins, keep its per-shift ones.
        ...d.pins.filter((p) => !(p.missionId === missionId && p.start == null && p.end == null)),
        ...employeeIds.map((employeeId) => ({ missionId, employeeId, start: null, end: null })),
      ],
    })),

    /**
     * Swap who covers one specific shift. Recorded as a pin over that exact
     * range, replacing any pin already covering it for the same mission, so
     * repeated swaps on one row don't pile up.
     */
    pinShift: (missionId, employeeId, start, end) => update((d) => ({
      ...d,
      pins: [
        ...d.pins.filter((p) => !(p.missionId === missionId && p.start === start && p.end === end)),
        { missionId, employeeId, start, end },
      ],
    })),

    /**
     * Clear the pin behind a displayed shift. The row only knows its concrete
     * range, but the pin may be a whole-mission one (null range) - so match any
     * pin for this person+mission that covers the row, not just an exact range
     * match, or the clear button silently does nothing on remote missions.
     */
    clearPin: (missionId, employeeId, start, end) => update((d) => {
      const mission = d.missions.find((m) => m.id === missionId);
      const covers = (p) => {
        const ps = p.start ?? mission?.start ?? d.start;
        const pe = p.end ?? mission?.end ?? d.end;
        return ps <= start && pe >= end;
      };
      return {
        ...d,
        pins: d.pins.filter(
          (p) => !(p.missionId === missionId && p.employeeId === employeeId && covers(p)),
        ),
      };
    }),

    clearAllPins: () => update((d) => ({ ...d, pins: [] })),
  }), [update]);

  const value = useMemo(
    () => ({ doc, setDoc, update, notice, setNotice, decodeFailed, ...api }),
    [doc, setDoc, update, notice, decodeFailed, api],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}
