import { 
  getEvents as fetchEventsFromDB, 
  checkInToEvent as verifyAndCheckInEvent 
} from './storage.js';

export async function getEvents() {
  return await fetchEventsFromDB();
}

export async function checkInToEvent(eventId, passcode) {
  if (!passcode || !passcode.trim()) {
    alert('Please enter a passcode.');
    return false;
  }
  return await verifyAndCheckInEvent(eventId, passcode);
}