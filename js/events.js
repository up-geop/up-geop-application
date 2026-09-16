import { supabase, getCurrentUserId } from './storage.js';
import { OFFICIAL_EVENTS_LIST } from './config.js';

export async function getEvents(targetUserId = null) {
  const uid = targetUserId || await getCurrentUserId();

  let dbEvents = [];
  if (supabase) {
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending: true });
    if (data && data.length > 0) {
      dbEvents = data;
    }
  }

  // Fallback to OFFICIAL_EVENTS_LIST if table is empty
  const baseList = dbEvents.length > 0 ? dbEvents : OFFICIAL_EVENTS_LIST.map((e, idx) => ({
    id: `static-${idx}`,
    name: e.name,
    weight_percent: e.weightPercent
  }));

  let attendedIds = new Set();
  if (supabase && uid) {
    const { data: attendance } = await supabase
      .from('event_attendees')
      .select('event_id')
      .eq('user_id', uid);
    if (attendance) {
      attendedIds = new Set(attendance.map(a => a.event_id));
    }
  }

  return baseList.map(evt => ({
    ...evt,
    attended: attendedIds.has(evt.id)
  }));
}

export async function adminToggleEventAttendance(applicantId, eventId, attended, officerEmail) {
  if (!supabase || !applicantId || !eventId) return false;

  if (attended) {
    const { error } = await supabase
      .from('event_attendees')
      .insert([{
        user_id: applicantId,
        event_id: eventId,
        marked_by: officerEmail
      }]);
    return !error;
  } else {
    const { error } = await supabase
      .from('event_attendees')
      .delete()
      .eq('user_id', applicantId)
      .eq('event_id', eventId);
    return !error;
  }
}

export function generateGoogleCalendarUrl(eventName) {
  const title = encodeURIComponent(`UP GEOP: ${eventName}`);
  const details = encodeURIComponent(`Official UP GEOP Applicants Event: ${eventName}`);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}`;
}
