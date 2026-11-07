import { getTambayHours as fetchHours, resetTambayHours as clearHours } from './storage.js';

// Retrieve total tambay hours
export async function getTambayHours() {
  return await fetchHours();
}

// Reset tambay hours
export async function resetTambayHours() {
  return await clearHours();
}

// Helper wrapper for manual logging (if called anywhere)
export async function logTambayHours(hours) {
  const msg = "Tambayan hours are logged in person at the tambayan! Show your Wayfarer QR pass to any resident member kasama.";
  if (typeof window !== 'undefined' && window.showToast) {
    window.showToast(msg);
  } else {
    alert(msg);
  }
  return false;
}