import { supabase, getCurrentUserId } from './storage.js';
import { OFFICIAL_EVENTS_LIST } from './config.js';

export async function getEvents(targetUserId = null) {
  const uid = targetUserId || await getCurrentUserId();

  const [eventsRes, attendanceRes, datesRes] = await Promise.all([
    supabase ? supabase.from('events').select('*').order('created_at', { ascending: true }) : { data: [] },
    (supabase && uid) ? supabase.from('event_attendees').select('event_id').eq('user_id', uid) : { data: [] },
    supabase ? supabase.from('global_settings').select('key, value').ilike('key', 'event_date_%') : { data: [] }
  ]);

  const dbEvents = (eventsRes.data && eventsRes.data.length > 0) ? eventsRes.data : [];

  // Fallback to OFFICIAL_EVENTS_LIST if table is empty
  const baseList = dbEvents.length > 0 ? dbEvents : OFFICIAL_EVENTS_LIST.map((e, idx) => ({
    id: `static-${idx}`,
    name: e.name,
    weight_percent: e.weightPercent
  }));

  const attendedIds = new Set((attendanceRes.data || []).map(a => a.event_id));
  const dateMap = new Map((datesRes.data || []).map(d => [d.key, d.value]));

  return baseList.map(evt => ({
    ...evt,
    attended: attendedIds.has(evt.id),
    scheduledDate: dateMap.get(`event_date_${evt.id}`) || evt.event_date || null
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

export function generateGoogleCalendarUrl(eventName, scheduledDateIso = null) {
  const title = encodeURIComponent(`UP GEOP: ${eventName}`);
  const details = encodeURIComponent(`Official UP GEOP Applicants Event: ${eventName}`);
  let datesParam = '';

  if (scheduledDateIso) {
    const start = new Date(scheduledDateIso);
    if (!isNaN(start.getTime())) {
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // Default 2-hour duration
      const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      datesParam = `&dates=${fmt(start)}/${fmt(end)}`;
    }
  }

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}${datesParam}`;
}
