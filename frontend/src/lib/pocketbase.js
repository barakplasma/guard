import PocketBase from 'pocketbase';

// Single PocketBase client for the whole app. Auth is persisted by the SDK's
// default localStorage auth store, so guards stay logged in across visits.
//
// In the production build, pb_public/ is served directly by PocketBase, so the
// bundle's own origin (localhost, a forwarded port, or a hotspot IP) is always
// correct. In `npm run dev`, Vite serves the frontend on its own port, so
// VITE_PB_URL (see .env.development) points at a separately-running `pocketbase serve`.
const baseUrl = import.meta.env.VITE_PB_URL || window.location.origin;

export const pb = new PocketBase(baseUrl);
