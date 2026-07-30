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
// 1. COMMITTEES & SIGNATORIES MATRIX (18 Total)
// ------------------------------------------

export const COMMITTEES_LIST = [
  { name: 'Academics', vp: 'VP for Academic Affairs' },
  { name: 'Publicity', vp: 'VP for Publicity Affairs' },
  { name: 'RAComm', vp: 'Recruitment & Applications Committee Head' },
  { name: 'Internal', vp: 'VP for Internal Affairs' },
  { name: 'External', vp: 'VP for External Affairs' },
  { name: 'Finance', vp: 'VP for Finance Affairs' }
];

const MEMBER_TRAITS = [
  "owns an Adidas or Nike shoe",
  "has dyed hair or wears glasses",
  "brought a reusable water jug today",
  "is wearing a green or black shirt",
  "commutes more than 1 hour to campus",
  "has taken a GE class with you",
  "is left-handed or wears a wristwatch",
  "listens to OPM or K-Pop"
];

const INTERACTION_TASKS = [
  "Take a photo using a funny camera filter",
  "Swap bags for 1 minute and take a fit check photo",
  "Do a synchronized high-five or funny pose together",
  "Play a quick game of Rock-Paper-Scissors (Best of 3)",
  "Get a song or coffee recommendation from them",
  "Record a 5-second video saying 'GEOP Go!'"
];

export async function generateApplicantSignatories(userId) {
  if (!supabase || !userId) return;

  const { data: existing } = await supabase
    .from('signatories')
    .select('id')
    .eq('user_id', userId);

  if (existing && existing.length > 0) return; // Already generated

  const newSignatories = [];

  COMMITTEES_LIST.forEach(comm => {
    // Random Trait & Task for Member 1
    const trait1 = MEMBER_TRAITS[Math.floor(Math.random() * MEMBER_TRAITS.length)];
    const task1 = INTERACTION_TASKS[Math.floor(Math.random() * INTERACTION_TASKS.length)];
    newSignatories.push({
      user_id: userId,
      committee_name: comm.name,
      type: 'MEMBER_1',
      trait_description: `Find a member who ${trait1}`,
      task_description: task1,
      completed: false
    });

    // Random Trait & Task for Member 2
    const trait2 = MEMBER_TRAITS[Math.floor(Math.random() * MEMBER_TRAITS.length)];
    const task2 = INTERACTION_TASKS[Math.floor(Math.random() * INTERACTION_TASKS.length)];
    newSignatories.push({
      user_id: userId,
      committee_name: comm.name,
      type: 'MEMBER_2',
      trait_description: `Find another member who ${trait2}`,
      task_description: task2,
      completed: false
    });

    // VP Signatory (Locked until Member 1 & 2 are complete)
    newSignatories.push({
      user_id: userId,
      committee_name: comm.name,
      type: 'VP',
      trait_description: `Official Verification by ${comm.vp}`,
      task_description: `Locked until both ${comm.name} member signatories are completed!`,
      completed: false
    });
  });

  await supabase.from('signatories').insert(newSignatories);
}

// ------------------------------------------
// 2. MEMBER & RACOMM PERMISSIONS API
// ------------------------------------------

export async function checkIfResidentMember(email) {
  if (!supabase || !email) return false;
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  
  return !!data;
}

export async function checkIfRAComm(email) {
  if (!supabase || !email) return false;
  const { data } = await supabase
    .from('members')
    .select('racomm')
    .eq('email', email)
    .maybeSingle();
  
  return data?.racomm === true;
}

export async function getGlobalSettings() {
  if (!supabase) return { dailyCapEnabled: true, multiplier: 1.0 };
  const { data } = await supabase.from('global_settings').select('*');
  
  const capRow = data?.find(r => r.key === 'daily_cap_enabled');
  const multRow = data?.find(r => r.key === 'hourly_multiplier');

  return {
    dailyCapEnabled: capRow ? capRow.value === 'true' : true,
    multiplier: multRow ? parseFloat(multRow.value) : 1.0
  };
}

export async function updateGlobalSettings(key, value) {
  if (!supabase) return false;
  const { error } = await supabase
    .from('global_settings')
    .upsert({ key, value: String(value) });

  if (error) {
    console.error('Error updating setting:', error.message);
    return false;
  }
  return true;
}

// ------------------------------------------
// 3. TAMBAY SESSION VALIDATION API
// ------------------------------------------

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

export async function validateApplicantTambay(applicantId, memberEmail) {
  if (!supabase || !applicantId || !memberEmail) {
    return { success: false, message: 'Invalid validation request.' };
  }

  const isMember = await checkIfResidentMember(memberEmail);
  if (!isMember) {
    return { 
      success: false, 
      message: `Access Denied: ${memberEmail} is not listed as an active member.` 
    };
  }

  const activeSession = await getActiveTambaySession(applicantId);
  const settings = await getGlobalSettings();

  if (!activeSession) {
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
    const timeIn = new Date(activeSession.time_in);
    const timeOut = new Date();
    const diffMs = timeOut - timeIn;
    
    let rawHours = Math.max(0.1, parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2)));
    let calculatedHours = rawHours * settings.multiplier;

    if (settings.dailyCapEnabled) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const { data: todayLogs } = await supabase
        .from('tambay_logs')
        .select('hours')
        .eq('user_id', applicantId)
        .gte('created_at', startOfDay.toISOString());

      const hoursLoggedToday = (todayLogs || []).reduce((sum, item) => sum + Number(item.hours), 0);
      const remainingAllowed = Math.max(0, 3.0 - hoursLoggedToday);

      if (remainingAllowed <= 0) {
        return {
          success: false,
          message: `Daily Cap Reached: Applicant has already logged ${hoursLoggedToday} hrs today (Max 3.0 hrs/day).`
        };
      }

      calculatedHours = Math.min(calculatedHours, remainingAllowed);
    }

    const { error: sessionErr } = await supabase
      .from('tambay_sessions')
      .update({
        time_out: timeOut.toISOString(),
        hours_logged: calculatedHours,
        scanned_by_out: memberEmail,
        status: 'COMPLETED'
      })
      .eq('id', activeSession.id);

    if (sessionErr) return { success: false, message: sessionErr.message };

    await supabase.from('tambay_logs').insert([{
      hours: calculatedHours,
      user_id: applicantId
    }]);

    const bonusStr = settings.multiplier > 1.0 ? ` (${settings.multiplier}x Bonus Active!)` : '';
    return { 
      success: true, 
      action: 'TIME_OUT', 
      hours: calculatedHours, 
      message: `Applicant Timed OUT! Logged ${calculatedHours.toFixed(2)} hours.${bonusStr}` 
    };
  }
}

// ------------------------------------------
// 4. USER PROFILE & BUDDY GROUP API
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
// 5. SIGNATORIES & TAMBAY LOGS API
// ------------------------------------------

export async function getSignatories() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];

  await generateApplicantSignatories(userId);

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
// 6. EVENTS API
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
    .select('*')
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

  await supabase.from('tambay_logs').insert([{
    hours: 2.0,
    user_id: userId
  }]);

  alert('✅ Event Attendance Verified! +2.0 hours credited to your Tambay Log.');
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

export async function getApplicantAnalytics() {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('*');

  if (error) return [];
  return data || [];
}
