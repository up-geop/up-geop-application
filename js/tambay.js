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
  alert("Tambay hours must be logged by presenting your QR code to a resident member!");
  return false;
}