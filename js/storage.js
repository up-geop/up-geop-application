// ==========================================
// SUPABASE CLIENT & DIRECT DATABASE API
// ==========================================

const SUPABASE_URL = 'https://cwbrzxqmlzgedaisaour.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_oZ1RQOpJ4BoIAq_vDAqHWw_lOnoqFo0';

const createClient = window.supabase?.createClient || window.supabaseClient?.createClient;
export const supabase = createClient ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Direct Published Google Sheet CSV URLs
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

function parseCSV(csvText) {
  if (!csvText) return [];

  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  if (rows.length <= 1) return [];

  const headers = rows[0].map(h => h.replace(/^["\uFEFF]|["\uFEFF]$/g, '').toLowerCase());

  return rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx] || '';
    });
    obj._raw = row;
    return obj;
  });
}

async function fetchSheetPools() {
  try {
    const [traitsRes, tasksRes] = await Promise.all([
      fetch(TRAITS_SHEET_CSV_URL).then(r => r.text()),
      fetch(TASKS_SHEET_CSV_URL).then(r => r.text())
    ]);

    const traits = parseCSV(traitsRes);
    const tasks = parseCSV(tasksRes);

    return { traits, tasks };
  } catch (err) {
    console.error('Error fetching Google Sheets CSV pools:', err);
    return { traits: [], tasks: [] };
  }
}

export async function generateApplicantSignatories(userId) {
  if (!supabase || !userId) return;

  const { data: existing } = await supabase
    .from('signatories')
    .select('id')
    .eq('user_id', userId);

  if (existing && existing.length > 0) return;

  const pools = await fetchSheetPools();

  const allTasks = pools.tasks
    .map(t => {
      const text = t['task description'] || t['task_description'] || t._raw?.[0] || '';
      return text.trim();
    })
    .filter(val => {
      return val.length > 0 && 
             !val.toLowerCase().includes('task description') && 
             isNaN(Number(val));
    });

  const shuffledTasks = [...allTasks].sort(() => 0.5 - Math.random());
  const applicant25Pool = shuffledTasks.slice(0, Math.min(25, shuffledTasks.length));

  const newSignatories = [];

  COMMITTEES_LIST.forEach((comm, commIdx) => {
    const commTraits = pools.traits
      .filter(t => {
        const committeeVal = t['committee'] || t._raw?.[0] || '';
        return committeeVal.toLowerCase().trim() === comm.name.toLowerCase();
      })
      .map(t => {
        const traitVal = t['trait description'] || t['trait_description'] || t._raw?.[1] || '';
        return traitVal.trim();
      })
      .filter(val => val.length > 0 && !val.toLowerCase().includes('trait description'));

    const shuffledTraits = [...commTraits].sort(() => 0.5 - Math.random());

    const defaultTraits = [
      ['owns an iPad or mechanical pencil for notes', 'has taken a GE class in AS / Palma Hall'],
      ['wearing a green shirt or carries a canvas tote bag', 'loves taking photos during org events'],
      ['commutes to campus using jeepneys or LRT', 'has been in UP GEOP for over 2 years'],
      ['brought a reusable water tumbler today', 'loves studying in CS Library or Main Lib'],
      ['has a favorite cafe near Katipunan', 'frequently tambays at the org room'],
      ['loves collecting stickers or enamel pins', 'has attended a GEOP night or party']
    ];

    const trait1 = shuffledTraits[0] || defaultTraits[commIdx % defaultTraits.length][0];
    const trait2 = shuffledTraits[1] || defaultTraits[commIdx % defaultTraits.length][1];

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

  await supabase.from('signatories').insert(newSignatories);
}

export async function selectTaskForSignatory(taskId, selectedTask) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase
    .from('signatories')
    .update({ selected_task: selectedTask })
    .eq('id', taskId);

  return !error;
}

// Universal Shortcode Generator (Handles both Tambay and Signatories)
export async function generateApplicantShortCode(sigId = null, type = 'TAMBAY') {
  const userId = await getCurrentUserId();
  if (!supabase || !userId) return null;

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let shortCode = '';
  for (let i = 0; i < 6; i++) shortCode += chars.charAt(Math.floor(Math.random() * chars.length));
  
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabase.from('profiles').update({ 
    temp_code: shortCode, 
    code_expires_at: expiresAt,
    code_type: type,
    pending_sig_id: sigId 
  }).eq('id', userId);

  return shortCode;
}

// Counts how many signatory tasks this person has personally verified/signed
export async function getMemberSignatureCount(email) {
  if (!supabase || !email) return 0;
  const { count } = await supabase
    .from('signatories')
    .select('id', { count: 'exact', head: true })
    .ilike('signed_by', email.trim())
    .eq('completed', true);
  return count || 0;
}

// Resident members may only personally sign this many signatory tasks total.
// (Tambay hour verification is NOT subject to this cap.) RAComm officers are exempt.
export const MEMBER_SIGNATORY_LIMIT = 4;

// Universal All-in-One Code & QR Verification for Members
export async function verifyUniversalCode(code, verifierEmail) {
  if (!supabase || !code || !verifierEmail) {
    return { success: false, message: 'Invalid verification parameters.' };
  }

  const isMember = await checkIfResidentMember(verifierEmail);
  const isRAComm = await checkIfRAComm(verifierEmail);

  if (!isMember && !isRAComm) {
    return { success: false, message: 'Access Denied: Only active members or officers can verify.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('temp_code', code.trim().toUpperCase())
    .maybeSingle();

  if (!profile || new Date(profile.code_expires_at) < new Date()) {
    return { success: false, message: 'Invalid or expired verification code.' };
  }

  // 1. Process Signatory Request
  if (profile.code_type === 'SIGNATORY' && profile.pending_sig_id) {
    // Plain resident members (not RAComm officers) can only sign up to
    // MEMBER_SIGNATORY_LIMIT tasks total, so applicants are pushed to meet
    // different members instead of relying on the same one every time.
    if (isMember && !isRAComm) {
      const signedCount = await getMemberSignatureCount(verifierEmail);
      if (signedCount >= MEMBER_SIGNATORY_LIMIT) {
        return {
          success: false,
          message: `You've already signed ${MEMBER_SIGNATORY_LIMIT} signatory tasks — that's your limit. Ask a RAComm officer to verify this one instead.`
        };
      }
    }

    const { error } = await supabase
      .from('signatories')
      .update({
        completed: true,
        signed_by: verifierEmail,
        signed_at: new Date().toISOString()
      })
      .eq('id', profile.pending_sig_id);

    if (error) return { success: false, message: error.message };

    await supabase.from('profiles').update({ temp_code: null }).eq('id', profile.id);

    return { 
      success: true, 
      message: `Verified and signed Signatory Task for ${profile.nickname || 'Applicant'}!` 
    };
  } 
  
  // 2. Process Tambay Request
  const res = await validateApplicantTambay(profile.id, verifierEmail);
  await supabase.from('profiles').update({ temp_code: null }).eq('id', profile.id);
  return res;
}

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

// ==========================================
// ANNOUNCEMENTS & WHEN2MEET EXPORTS
// ==========================================

export async function getAnnouncements() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  return error ? [] : data;
}

export async function createAnnouncement(title, content, authorEmail, authorAvatar = null) {
  if (!supabase || !title || !content) return false;
  const { error } = await supabase.from('announcements').insert([{
    title,
    content,
    author_email: authorEmail,
    author_avatar: authorAvatar
  }]);
  return !error;
}

export async function deleteAnnouncement(announcementId) {
  if (!supabase || !announcementId) return false;
  const { error } = await supabase.from('announcements').delete().eq('id', announcementId);
  return !error;
}

export async function getAvailabilitySlots() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('availability_slots')
    .select('*');
  return error ? [] : data;
}

export async function toggleUserAvailabilitySlot(userId, userName, slotKey, isAvailable) {
  if (!supabase) return false;

  if (isAvailable) {
    await supabase
      .from('availability_slots')
      .delete()
      .eq('user_id', userId)
      .eq('time_slot', slotKey);
  } else {
    await supabase
      .from('availability_slots')
      .insert({ user_id: userId, user_name: userName, time_slot: slotKey });
  }
  return true;
}
