// ==========================================
// SUPABASE CLIENT & DIRECT DATABASE API
// ==========================================

const SUPABASE_URL = 'https://cwbrzxqmlzgedaisaour.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_oZ1RQOpJ4BoIAq_vDAqHWw_lOnoqFo0';

const createClient = window.supabase?.createClient || window.supabaseClient?.createClient;

if (!createClient) {
  console.error('Supabase SDK failed to load. Check your script tag in index.html!');
}

export const supabase = createClient ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

async function getCurrentUserId() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

export function getStoredData() {
  return {
    userRole: localStorage.getItem('userRole') || 'applicant'
  };
}

// ------------------------------------------
// 1. MEMBER & TAMBAY VALIDATION API
// ------------------------------------------

// Check if email belongs to an authorized resident member
export async function checkIfResidentMember(email) {
  if (!supabase || !email) return false;
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  return !!data;
}

// Get active tambay session for an applicant
export async function getActiveTambaySession(applicantId) {
  const targetId = applicantId || await getCurrentUserId();
  if (!supabase || !targetId) return null;

  const { data } = await supabase
    .from('tambay_sessions')
    .select('*')
    .eq('applicant_id', targetId)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  return data;
}

// Auto-validation when a member scans the URL
export async function validateApplicantTambay(applicantId, memberEmail) {
  if (!supabase || !applicantId || !memberEmail) {
    return { success: false, message: 'Invalid validation request.' };
  }

  const isMember = await checkIfResidentMember(memberEmail);
  if (!isMember) {
    return { 
      success: false, 
      message: `Access Denied: ${memberEmail} is not listed as a resident member.` 
    };
  }

  const activeSession = await getActiveTambaySession(applicantId);

  if (!activeSession) {
    // TIME IN
    const { error } = await supabase
      .from('tambay_sessions')
      .insert([{
        applicant_id: applicantId,
        time_in: new Date().toISOString(),
        scanned_by_in: memberEmail,
        status: 'ACTIVE'
      }]);

    if (error) return { success: false, message: error.message };
    return { success: true, action: 'TIME_IN', message: 'Applicant Timed IN successfully!' };
  } else {
    // TIME OUT
    const timeIn = new Date(activeSession.time_in);
    const timeOut = new Date();
    const diffMs = timeOut - timeIn;
    const hoursLogged = Math.max(0.1, parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2)));

    const { error: sessionErr } = await supabase
      .from('tambay_sessions')
      .update({
        time_out: timeOut.toISOString(),
        hours_logged: hoursLogged,
        scanned_by_out: memberEmail,
        status: 'COMPLETED'
      })
      .eq('id', activeSession.id);

    if (sessionErr) return { success: false, message: sessionErr.message };

    // Insert logged hours into main tambay_logs
    await supabase.from('tambay_logs').insert([{
      hours: hoursLogged,
      user_id: applicantId
    }]);

    return { 
      success: true, 
      action: 'TIME_OUT', 
      hours: hoursLogged, 
      message: `Applicant Timed OUT! Logged ${hoursLogged} hours.` 
    };
  }
}

// ------------------------------------------
// 2. USER PROFILE & BUDDY GROUP API
// ------------------------------------------
export async function getUserProfile() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching user profile:", error.message);
    return null;
  }
  return data;
}

export async function getBuddyGroupMembers(groupName) {
  if (!groupName || !supabase) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, nickname')
    .eq('buddy_group_name', groupName);

  if (error) {
    console.error("Error fetching group buddies:", error.message);
    return [];
  }
  return data || [];
}

export async function spendCurrency(cost, itemDescription) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;

  const profile = await getUserProfile();
  if (!profile || profile.currency < cost) {
    alert(`Insufficient GEOP Tokens! You need 🪙 ${cost} tokens for ${itemDescription}.`);
    return false;
  }

  const newBalance = profile.currency - cost;

  const { error } = await supabase
    .from('profiles')
    .update({ currency: newBalance })
    .eq('id', userId);

  if (error) {
    console.error("Error deducting tokens:", error.message);
    return false;
  }

  alert(`Success! Redeemed: ${itemDescription}. Remaining Tokens: 🪙 ${newBalance}`);
  return true;
}

// ------------------------------------------
// 3. SIGNATORIES API
// ------------------------------------------
export async function getSignatories() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];

  const { data, error } = await supabase
    .from('signatories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching signatories:', error.message);
    return [];
  }
  return data || [];
}

export async function toggleSignatoryTask(taskId, currentStatus) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;

  const { error } = await supabase
    .from('signatories')
    .update({ completed: !currentStatus })
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) {
    console.error('Error toggling signatory status:', error.message);
    return false;
  }
  return true;
}

export async function addSignatoryRequirement(role, task) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;

  const { error } = await supabase
    .from('signatories')
    .insert([{ role, task, completed: false, user_id: userId }]);

  if (error) {
    console.error('Error adding signatory task:', error.message);
    return false;
  }
  return true;
}

// ------------------------------------------
// 4. TAMBAY HOURS TOTAL API
// ------------------------------------------
export async function getTambayHours() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return 0;

  const { data, error } = await supabase
    .from('tambay_logs')
    .select('hours')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching tambay hours:', error.message);
    return 0;
  }

  return (data || []).reduce((sum, item) => sum + Number(item.hours), 0);
}

export async function resetTambayHours() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;

  const { error } = await supabase
    .from('tambay_logs')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Error resetting tambay hours:', error.message);
    return false;
  }
  return true;
}

// ------------------------------------------
// 5. EVENTS API
// ------------------------------------------
export async function getEvents() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching events:', error.message);
    return [];
  }
  return data || [];
}

export async function checkInToEvent(eventId, passcodeEntered) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;

  const { data: eventData, error: fetchErr } = await supabase
    .from('events')
    .select('passkey')
    .eq('id', eventId)
    .single();

  if (fetchErr || !eventData) {
    alert('Event not found.');
    return false;
  }

  if (eventData.passkey.trim() !== passcodeEntered.trim()) {
    alert('Incorrect passcode. Please double-check with committee admins.');
    return false;
  }

  const { error: updateErr } = await supabase
    .from('events')
    .update({ attended: true })
    .eq('id', eventId)
    .eq('user_id', userId);

  if (updateErr) {
    console.error('Error checking in to event:', updateErr.message);
    return false;
  }

  return true;
}

export async function createEvent(name, passkey) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;

  const { error } = await supabase
    .from('events')
    .insert([{ name, passkey, attended: false, user_id: userId }]);

  if (error) {
    console.error('Error creating event:', error.message);
    return false;
  }
  return true;
}