import { supabase, getCurrentUserId } from './storage.js';

export async function getEvents() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function checkInToEvent(eventId, passcodeEntered) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase || !passcodeEntered) return false;

  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .single();

  if (!data || data.passkey.trim() !== passcodeEntered.trim()) return false;

  await supabase
    .from('events')
    .update({ attended: true })
    .eq('id', eventId)
    .eq('user_id', userId);

  await supabase
    .from('tambay_logs')
    .insert([{ hours: 2.0, user_id: userId }]);

  return true;
}

export async function createEvent(name, passkey) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase || !name || !passkey) return false;

  const { error } = await supabase
    .from('events')
    .insert([{ name, passkey, attended: false, user_id: userId }]);

  return !error;
}

export function generateGoogleCalendarUrl(eventName) {
  const title = encodeURIComponent(`UP GEOP: ${eventName}`);
  const details = encodeURIComponent('UP GEOP Official Event Attendance');
  const location = encodeURIComponent('UP Diliman');

  const now = new Date();
  const start = new Date(now.setHours(17, 0, 0, 0)).toISOString().replace(/-|:|\.\d\d\d/g, '');
  const end = new Date(now.setHours(19, 0, 0, 0)).toISOString().replace(/-|:|\.\d\d\d/g, '');

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${start}/${end}`;
}
