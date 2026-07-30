import { 
  getSignatories as fetchSignatoriesFromDB, 
  toggleSignatoryTask as updateSignatoryInDB, 
  addSignatoryRequirement 
} from './storage.js';

export async function getSignatories() {
  return await fetchSignatoriesFromDB();
}

export async function toggleSignatoryTask(taskId, currentStatus) {
  return await updateSignatoryInDB(taskId, currentStatus);
}

export async function addSignatoryTask(role, taskDescription) {
  if (!role || !role.trim() || !taskDescription || !taskDescription.trim()) return false;
  return await addSignatoryRequirement(role.trim(), taskDescription.trim());
}