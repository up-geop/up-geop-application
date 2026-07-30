import { 
  getSignatories as fetchSignatories, 
  toggleSignatoryTask as updateSignatoryTask 
} from './storage.js';

// Retrieve signatories list
export async function getSignatories() {
  return await fetchSignatories();
}

// Toggle signatory completion status
export async function toggleSignatoryTask(taskId, currentStatus) {
  return await updateSignatoryTask(taskId, currentStatus);
}
