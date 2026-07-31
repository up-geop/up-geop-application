// ==========================================
// SUPABASE CLIENT & DIRECT DATABASE API
// ==========================================

const SUPABASE_URL = 'https://cwbrzxqmlzgedaisaour.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_oZ1RQOpJ4BoIAq_vDAqHWw_lOnoqFo0';

const createClient = window.supabase?.createClient || window.supabaseClient?.createClient;
export const supabase = createClient ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Replace these two URLs with your published Google Sheet CSV URLs
const TRAITS_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUM49iGYGFrwckeq-pSZv65dVWYi7yqE2DIYcpBfZKxFTqIc-1l-CXa6U1TvmGE3oqf8NhjWq29qeC/pub?gid=0&single=true&output=csv';
const TASKS_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUM49iGYGFrwckeq-pSZv65dVWYi7yqE2DIYcpBfZKxFTqIc-1l-CXa6U1TvmGE3oqf8NhjWq29qeC/pub?gid=448373194&single=true&output=csv';

async function getCurrentUserId() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

export const COMMITTEES_LIST = [
  { name: 'Academics', vp: 'VP for Academic Affairs' },
  { name: 'Publicity', vp: 'VP for Publicity Affairs' },
  { name: 'RAComm', vp: 'Recruitment & Applications Committee Head' },
  { name: 'Internal', vp: 'VP for Internal Affairs' },
  { name: 'External', vp: 'VP for External Affairs' },
  { name: 'Finance', vp: 'VP for Finance Affairs' }
];

// CSV Parser Helper
function parseCSV(csvText) {
  if (!csvText) return [];
  const lines = csvText.trim().split('\n');
  if (lines.length <= 1) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  return lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
    const cleanValues = values.map(v => v.trim().replace(/^"|"$/g, ''));
    let obj = {};
    headers.forEach((header, i) => {
      obj[header] = cleanValues[i] || '';
    });
    return obj;
  });
}

// Fetch Google Sheets Pools
async function fetchSheetPools() {
  try {
    const [traitsRes, tasksRes] = await Promise.all([
      fetch(TRAITS_SHEET_CSV_URL).then(r => r.text()),
      fetch(TASKS_SHEET_CSV_URL).then(r => r.text())
    ]);

    return {
      traits: parseCSV(traitsRes),
      tasks: parseCSV(tasksRes)
    };
  } catch (err) {
    console.error('Error fetching Google Sheets CSV pools:', err);
    return { traits: [], tasks: [] };
  }
}

// Generate Applicant Signatory Matrix (18 Items)
export async function generateApplicantSignatories(userId) {
  if (!supabase || !userId) return;

  const { data: existing, error: checkErr } = await supabase
    .from('signatories')
    .select('id')
    .eq('user_id', userId);

  if (checkErr) {
    console.error('Error checking existing signatories:', checkErr.message);
  }

  if (existing && existing.length > 0) return; // Already generated

  const pools = await fetchSheetPools();
  const allTasks = pools.tasks.map(t => t.task_description).filter(Boolean);

  // Randomly pick 25 unique tasks for this applicant's personal choice pool
  const shuffledTasks = [...allTasks].sort(() => 0.5 - Math.random());
  const applicant25Pool = shuffledTasks.slice(0, Math.min(25, shuffledTasks.length));

  const newSignatories = [];

  COMMITTEES_LIST.forEach(comm => {
    const commTraits = pools.traits
      .filter(t => t.committee_name?.trim().toLowerCase() === comm.name.toLowerCase())
      .map(t => t.trait_description)
      .filter(Boolean);

    const shuffledTraits = [...commTraits].sort(() => 0.5 - Math.random());
    const trait1 = shuffledTraits[0] || 'owns a GEOP jacket or lanyard';
    const trait2 = shuffledTraits[1] || 'has been in UP GEOP for over 2 years';

    // Member Task 1
    newSignatories.push({
      user_id: userId,
      committee_name: comm.name,
      type: 'MEMBER_1',
      role: 'MEMBER_1',
      task: `Find a member who ${trait1}`,
      trait_description: `Find a member who ${trait1}`,
      questions_required: 'Ask: Name, Nickname, Favorite spot in UP, Least liked major sub',
      task_pool: applicant25Pool,
      selected_task: null,
      signed_by: null,
      completed: false
    });

    // Member Task 2
    newSignatories.push({
      user_id: userId,
      committee_name: comm.name,
      type: 'MEMBER_2',
      role: 'MEMBER_2',
      task: `Find another member who ${trait2}`,
      trait_description: `Find another member who ${trait2}`,
      questions_required: 'Ask: Name, Nickname, Favorite spot in UP, Least liked major sub',
      task_pool: applicant25Pool,
      selected_task: null,
      signed_by: null,
      completed: false
    });

    // VP Verification
    newSignatories.push({
      user_id: userId,
      committee_name: comm.name,
      type: 'VP',
      role: 'VP',
      task: `Official Endorsement by ${comm.vp}`,
      trait_description: `Official Endorsement by ${comm.vp}`,
      questions_required: 'Ask: Nickname, Favorite spot in UP, Least liked major sub',
      task_pool: applicant25Pool,
      selected_task: null,
      signed_by: null,
      completed: false
    });
  });

  const { error: insertErr } = await supabase.from('signatories').insert(newSignatories);
  if (insertErr) {
    console.error('Supabase Signatories Insert Error Details:', insertErr);
  }
}

export async function selectTaskForSignatory(taskId, selectedTask) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase
    .from('signatories')
    .update({ selected_task: selectedTask })
    .eq('id', taskId);

  return !error;
}

export async function toggleSignatoryTask(taskId, currentStatus) {
  if (!supabase || !taskId) return false;

  const { error } = await supabase
    .from('signatories')
    .update({ completed: !currentStatus })
    .eq('id', taskId);

  if (error) {
    console.error('Error toggling signatory status:', error.message);
    return false;
  }
  return true;
}

export async function verifySignatoryByMember(taskId, memberEmail) {
  if (!supabase || !taskId || !memberEmail) return false;

  const { error } = await supabase
    .from('signatories')
    .update({ 
      completed: true, 
      signed_by: memberEmail, 
      signed_at: new Date().toISOString() 
    })
    .eq('id', taskId);

  return !error;
}

// User Profile & Member Checks
export async function checkIfResidentMember(email) {
  if (!supabase || !email) return false;
  const { data } = await supabase.from('members').select('id').ilike('email', email.trim()).maybeSingle();
  return !!data;
}

export async function checkIfRAComm(email) {
  if (!supabase || !email) return false;
  const { data } = await supabase.from('members').select('racomm').ilike('email', email.trim()).maybeSingle();
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
  const { error } = await supabase.from('global_settings').upsert({ key, value: String(value) });
  return !error;
}

export async function generateApplicantShortCode() {
  const userId = await getCurrentUserId();
  if (!supabase || !userId) return null;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let shortCode = '';
  for (let i = 0; i < 6; i++) shortCode += chars.charAt(Math.floor(Math.random() * chars.length));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('profiles').update({ temp_code: shortCode, code_expires_at: expiresAt }).eq('id', userId);
  return shortCode;
}

export async function getApplicantIdByShortCode(code) {
  if (!supabase || !code) return null;
  const { data } = await supabase.from('profiles').select('id, code_expires_at').eq('temp_code', code.trim().toUpperCase()).maybeSingle();
  if (!data || new Date(data.code_expires_at) < new Date()) return null;
  return data.id;
}

export async function getActiveTambaySession(applicantId) {
  const targetId = applicantId || await getCurrentUserId();
  if (!supabase || !targetId) return null;
  const { data } = await supabase.from('tambay_sessions').select('*').eq('applicant_id', targetId).eq('status', 'ACTIVE').maybeSingle();
  return data;
}

export async function validateApplicantTambay(applicantId, memberEmail) {
  if (!supabase || !applicantId || !memberEmail) return { success: false, message: 'Invalid request.' };
  const isMember = await checkIfResidentMember(memberEmail);
  if (!isMember) return { success: false, message: 'Access Denied: Not an active member.' };

  const activeSession = await getActiveTambaySession(applicantId);
  const settings = await getGlobalSettings();

  if (!activeSession) {
    const { error } = await supabase.from('tambay_sessions').insert([{
      applicant_id: applicantId,
      time_in: new Date().toISOString(),
      scanned_by_in: memberEmail,
      status: 'ACTIVE'
    }]);
    if (error) return { success: false, message: error.message };
    return { success: true, message: 'Applicant Timed IN successfully!' };
  } else {
    const timeIn = new Date(activeSession.time_in);
    const timeOut = new Date();
    const rawHours = Math.max(0.1, parseFloat(((timeOut - timeIn) / (1000 * 60 * 60)).toFixed(2)));
    const calculatedHours = rawHours * settings.multiplier;

    await supabase.from('tambay_sessions').update({
      time_out: timeOut.toISOString(),
      hours_logged: calculatedHours,
      scanned_by_out: memberEmail,
      status: 'COMPLETED'
    }).eq('id', activeSession.id);

    await supabase.from('tambay_logs').insert([{ hours: calculatedHours, user_id: applicantId }]);
    return { success: true, message: `Applicant Timed OUT! Logged ${calculatedHours.toFixed(2)} hours.` };
  }
}

export async function getSignatories() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];
  await generateApplicantSignatories(userId);
  const { data, error } = await supabase.from('signatories').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  if (error) console.error('Error fetching signatories:', error.message);
  return data || [];
}

export async function getTambayHours() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return 0;
  const { data } = await supabase.from('tambay_logs').select('hours').eq('user_id', userId);
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

export async function getEvents() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];
  const { data } = await supabase.from('events').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  return data || [];
}

export async function checkInToEvent(eventId, passcodeEntered) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;
  const { data: eventData } = await supabase.from('events').select('*').eq('id', eventId).single();
  if (!eventData || eventData.passkey.trim() !== passcodeEntered.trim()) return false;
  await supabase.from('events').update({ attended: true }).eq('id', eventId).eq('user_id', userId);
  await supabase.from('tambay_logs').insert([{ hours: 2.0, user_id: userId }]);
  return true;
}

export async function createEvent(name, passkey) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;
  const { error } = await supabase.from('events').insert([{ name, passkey, attended: false, user_id: userId }]);
  return !error;
}

export async function getAllApplicantsProgress() {
  if (!supabase) return [];
  const { data: profiles } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
  const { data: allSigs } = await supabase.from('signatories').select('*');
  const { data: allTambay } = await supabase.from('tambay_logs').select('*');
  const { data: activeSessions } = await supabase.from('tambay_sessions').select('*').eq('status', 'ACTIVE');

  return (profiles || []).map(profile => {
    const userSigs = (allSigs || []).filter(s => s.user_id === profile.id);
    const completedSigs = userSigs.filter(s => s.completed).length;
    const userTambay = (allTambay || []).filter(t => t.user_id === profile.id);
    const totalTambayHours = userTambay.reduce((sum, item) => sum + Number(item.hours), 0);

    const sigRatio = completedSigs / (userSigs.length || 18);
    const tambayRatio = Math.min(totalTambayHours / 15, 1);
    const overallPercent = Math.round((sigRatio * 0.50 + tambayRatio * 0.35) * 100);
    const isTimedIn = (activeSessions || []).some(s => s.applicant_id === profile.id);

    return {
      id: profile.id,
      fullName: profile.full_name || 'N/A',
      nickname: profile.nickname || 'N/A',
      buddyGroup: profile.buddy_group_name || 'Unassigned',
      completedSigs,
      totalSigs: userSigs.length || 18,
      tambayHours: totalTambayHours.toFixed(1),
      overallPercent,
      isTimedIn
    };
  });
}

export async function getApplicantFullDetails(applicantId) {
  if (!supabase || !applicantId) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', applicantId).single();
  const { data: signatories } = await supabase.from('signatories').select('*').eq('user_id', applicantId).order('created_at', { ascending: true });
  const { data: tambayLogs } = await supabase.from('tambay_logs').select('*').eq('user_id', applicantId).order('created_at', { ascending: false });
  return { profile, signatories, tambayLogs };
}

export async function deleteApplicantProfile(applicantId) {
  if (!supabase || !applicantId) return false;
  await supabase.from('signatories').delete().eq('user_id', applicantId);
  await supabase.from('tambay_logs').delete().eq('user_id', applicantId);
  await supabase.from('tambay_sessions').delete().eq('applicant_id', applicantId);
  await supabase.from('events').delete().eq('user_id', applicantId);
  const { error } = await supabase.from('profiles').delete().eq('id', applicantId);
  return !error;
}

export async function adminAdjustTambayHours(applicantId, hoursAmount) {
  if (!supabase || !applicantId) return false;
  const { error } = await supabase.from('tambay_logs').insert([{ user_id: applicantId, hours: hoursAmount }]);
  return !error;
}

export async function adminAdjustTokens(applicantId, newBalance) {
  if (!supabase || !applicantId) return false;
  const { error } = await supabase.from('profiles').update({ currency: newBalance }).eq('id', applicantId);
  return !error;
}

export async function adminToggleApplicantSignatory(taskId, currentStatus) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase.from('signatories').update({ completed: !currentStatus }).eq('id', taskId);
  return !error;
}

export async function spendCurrency(cost, itemDescription) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;

  const { data: profile } = await supabase.from('profiles').select('currency').eq('id', userId).single();
  if (!profile || profile.currency < cost) {
    alert(`Insufficient tokens! Required: ${cost}`);
    return false;
  }

  const { error } = await supabase.from('profiles').update({ currency: profile.currency - cost }).eq('id', userId);
  return !error;
}

export async function getBuddyGroupMembers(groupName) {
  if (!groupName || !supabase) return [];
  const { data } = await supabase.from('profiles').select('full_name, nickname').eq('buddy_group_name', groupName);
  return data || [];
}
