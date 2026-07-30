import { 
  addSignatoryRequirement, 
  createEvent 
} from './storage.js';

export function switchRole(role) {
  localStorage.setItem('userRole', role);
}

export async function handleAddSignatoryRequirement(role, task) {
  if (!role || !role.trim() || !task || !task.trim()) {
    alert('Please provide both a role and task description.');
    return false;
  }
  return await addSignatoryRequirement(role.trim(), task.trim());
}

export async function handleCreateEvent(name, passkey) {
  if (!name || !name.trim() || !passkey || !passkey.trim()) {
    alert('Please provide both an event name and passkey.');
    return false;
  }
  return await createEvent(name.trim(), passkey.trim());
}