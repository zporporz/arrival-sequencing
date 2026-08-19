import { supabaseAdminRequest } from './supabaseAdmin.js';

export const AMAN_GHOST_RETENTION_MS = 30 * 60 * 1000;
export const AMAN_RECONNECT_NOTICE_MS = 5 * 60 * 1000;

const TERMINAL_STATES = new Set([
  'landed',
  'on blocks',
  'on ground',
  'taxi',
  'taxiing',
  'parking',
]);

const AIRPORT_REFERENCE = {
  VTBD: { lat: 13.9126, lon: 100.6068 },
  VTBS: { lat: 13.681