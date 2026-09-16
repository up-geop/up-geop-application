import { COMMITTEES_LIST } from './config.js';

const SUPABASE_URL = 'https://cwbrzxqmlzgedaisaour.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oZ1RQOpJ4BoIAq_vDAqHWw_lOnoqFo0';

const createClient = window.supabase?.createClient;
export const supabase = createClient ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const TRAITS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUM49iGYGFrwckeq-pSZv65dVWYi7yqE2DIYcpBfZKxFTqIc-1l-CXa6U1TvmGE3oqf8NhjWq29qeC/pub?gid=0&single=true&output=csv';
const TASKS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUM49iGYGFrwckeq-pSZv65dVWYi7yqE2DIYcpBfZKxFTqIc-1l-CXa6U1TvmGE3oqf8NhjWq29qeC/pub?gid=448373194&single=true&output=csv';

export async function getCurrentUserId() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

function parseCSV(text) {
  if (!text) return [];
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') { currentCell += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some(c => c.length > 0)) rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }
  if (currentCell || currentRow.length) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }
  if (rows.length <= 1) return [];

  const headers = rows[0].map(h => h.replace(/^["\uFEFF]|["\uFEFF]$/g, '').toLowerCase());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = row[idx] || ''; });
    obj._raw = row;
    return obj;
  });
}

export async function generateApplicantSignatories(userId) {
  if (!supabase || !userId) return;
  const { data: existing } = await supabase.from('signatories').select('id').eq('user_id', userId);
  if (existing && existing.length > 0) return;

  try {
    const [traitsRes, tasksRes] = await Promise.all([
      fetch(TRAITS_CSV_URL).then(r => r.text()),
      fetch(TASKS_CSV_URL).then(r => r.text())
    ]);

    const traits = parseCSV(traitsRes);
    const tasks = parseCSV(tasksRes);

    const allTasks = tasks
      .map(t => (t['task description'] || t['task_description'] || t._raw?.[0] || '').trim())
      .filter(v => v.length > 0 && !v.toLowerCase().includes('task description'));

    const shuffledTasks = [...allTasks].sort(() => 0.5 - Math.random());
    const applicantPool = shuffledTasks.slice(0, Math.min(25, shuffledTasks.length));

    const defaultTraits = [
      ['owns an iPad or mechanical pencil for notes', 'has taken a GE class in AS / Palma Hall'],
      ['wearing a green shirt or carries a canvas tote bag', 'loves taking photos during org events'],
      ['commutes to campus using jeepneys or LRT', 'has been in UP GEOP for over 2 years'],
      ['brought a reusable water tumbler today', 'loves studying in CS Library or Main Lib'],
      ['has a favorite cafe near Katipunan', 'frequently tambays at the org room'],
      ['loves collecting stickers or enamel pins', 'has attended a GEOP night or party']
    ];

    const records = [];
    COMMITTEES_LIST.forEach((comm, idx) => {
      const commTraits = traits
        .filter(t => (t['committee'] || t._raw?.[0] || '').toLowerCase().trim() === comm.name.toLowerCase())
        .map(t => (t['trait description'] || t['trait_description'] || t._raw?.[1] || '').trim())
        .filter(v => v.length > 0);

      const trait1 = commTraits[0] || defaultTraits[idx % defaultTraits.length][0];
      const trait2 = commTraits[1] || defaultTraits[idx % defaultTraits.length][1];

      records.push({
        user_id: userId,
        committee_name: comm.name,
        type: 'MEMBER_1',
        role: 'MEMBER_1',
        task: `Find a member who ${trait1}`,
        trait_description: `Find a member who ${trait1}`,
        task_pool: applicantPool,
        completed: false
      });

      records.push({
        user_id: userId,
        committee_name: comm.name,
        type: 'MEMBER_2',
        role: 'MEMBER_2',
        task: `Find another member who ${trait2}`,
        trait_description: `Find another member who ${trait2}`,
        task_pool: applicantPool,
        completed: false
      });

      records.push({
        user_id: userId,
        committee_name: comm.name,
        type: 'VP',
        role: 'VP',
        task: `Official Endorsement by ${comm.vp}`,
        trait_description: `Official Endorsement by ${comm.vp}`,
        task_pool: applicantPool,
        completed: false
      });
    });

    await supabase.from('signatories').insert(records);
  } catch (err) {
    console.error('Error generating signatories:', err);
  }
}

export async function getSignatories() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];
  await generateApplicantSignatories(userId);
  const { data } = await supabase.from('signatories').select('*').eq('user_id', userId).order('created_at', { ascending: true });
  return data || [];
}

export async function selectTaskForSignatory(taskId, selectedTask) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase.from('signatories').update({ selected_task: selectedTask }).eq('id', taskId);
  return !error;
}

export async function updateSignatoryAnswer(sigId, field, value) {
  if (!supabase || !sigId || !field) return false;
  const { error } = await supabase.from('signatories').update({ [field]: value }).eq('id', sigId);
  return !error;
}

export async function generateApplicantShortCode(sigId = null, type = 'TAMBAY') {
  const userId = await getCurrentUserId();
  if (!supabase || !userId) return null;

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('profiles').update({
    temp_code: code,
    code_expires_at: expiresAt,
    code_type: type,
    pending_sig_id: sigId
  }).eq('id', userId);

  return code;
}

export async function verifyUniversalCode(code, verifierEmail) {
  if (!supabase || !code || !verifierEmail) return { success: false, message: 'Invalid params' };
  const { data, error } = await supabase.rpc('verify_applicant_code', {
    p_code: code.trim().toUpperCase(),
    p_verifier_email: verifierEmail.trim()
  });
  if (error) return { success: false, message: error.message };
  return data;
}

export async function getTambayHours() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return 0;
  const { data } = await supabase.from('tambay_logs').select('hours').eq('user_id', userId);
  return (data || []).reduce((sum, item) => sum + Number(item.hours), 0);
}

export async function getActiveTambaySession(applicantId = null) {
  const targetId = applicantId || await getCurrentUserId();
  if (!supabase || !targetId) return null;
  const { data } = await supabase.from('tambay_sessions').select('*').eq('applicant_id', targetId).eq('status', 'ACTIVE').maybeSingle();
  return data;
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
  const cap = data?.find(r => r.key === 'daily_cap_enabled');
  const mult = data?.find(r => r.key === 'hourly_multiplier');
  return {
    dailyCapEnabled: cap ? cap.value === 'true' : true,
    multiplier: mult ? parseFloat(mult.value) : 1.0
  };
}

export async function updateGlobalSettings(key, value) {
  if (!supabase) return false;
  const { error } = await supabase.from('global_settings').upsert({ key, value: String(value) });
  return !error;
}

export async function getAllApplicantsProgress() {
  if (!supabase) return [];
  const { data: profiles } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
  const { data: allSigs } = await supabase.from('signatories').select('*');
  const { data: allTambay } = await supabase.from('tambay_logs').select('*');
  const { data: activeSessions } = await supabase.from('tambay_sessions').select('*').eq('status', 'ACTIVE');

  return (profiles || []).map(p => {
    const userSigs = (allSigs || []).filter(s => s.user_id === p.id);
    const completedSigs = userSigs.filter(s => s.completed).length;
    const userTambay = (allTambay || []).filter(t => t.user_id === p.id);
    const tambayHours = userTambay.reduce((sum, item) => sum + Number(item.hours), 0);

    const sigRatio = completedSigs / (userSigs.length || 18);
    const tambayRatio = Math.min(tambayHours / 10, 1);
    const overallPercent = Math.round((sigRatio * 0.40 + tambayRatio * 0.30) * 100);

    return {
      id: p.id,
      fullName: p.full_name || 'N/A',
      nickname: p.nickname || 'N/A',
      buddyGroup: p.buddy_group_name || 'Unassigned',
      completedSigs,
      totalSigs: userSigs.length || 18,
      tambayHours: tambayHours.toFixed(1),
      overallPercent,
      isTimedIn: (activeSessions || []).some(s => s.applicant_id === p.id)
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

export async function adminAdjustTambayHours(applicantId, hours) {
  if (!supabase || !applicantId) return false;
  const { error } = await supabase.from('tambay_logs').insert([{ user_id: applicantId, hours }]);
  return !error;
}

export async function adminAdjustTokens(applicantId, currency) {
  if (!supabase || !applicantId) return false;
  const { error } = await supabase.from('profiles').update({ currency }).eq('id', applicantId);
  return !error;
}

export async function adminToggleApplicantSignatory(taskId, status) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase.from('signatories').update({ completed: status }).eq('id', taskId);
  return !error;
}

export async function spendCurrency(cost) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return false;
  const { data: p } = await supabase.from('profiles').select('currency').eq('id', userId).single();
  if (!p || p.currency < cost) return false;
  const { error } = await supabase.from('profiles').update({ currency: p.currency - cost }).eq('id', userId);
  return !error;
}

export async function getBuddyGroupMembers(groupName) {
  if (!groupName || !supabase || groupName === 'Unassigned') return [];

  const { data: applicants } = await supabase
    .from('profiles')
    .select('full_name, nickname')
    .eq('buddy_group_name', groupName);

  const { data: members } = await supabase
    .from('members')
    .select('full_name')
    .eq('buddy_group_name', groupName);

  const formattedApplicants = (applicants || []).map(a => ({
    full_name: a.full_name || 'Applicant',
    nickname: a.nickname || '',
    role: 'Applicant'
  }));

  const formattedMembers = (members || []).map(m => ({
    full_name: m.full_name || 'Member',
    nickname: '',
    role: 'Member'
  }));

  return [...formattedMembers, ...formattedApplicants];
}

export async function getManagedBuddyGroups() {
  if (!supabase) return [];
  const { data } = await supabase
    .from('buddy_groups')
    .select('*')
    .order('name', { ascending: true });
  return data || [];
}

export async function createBuddyGroup(name, description = '') {
  if (!supabase || !name) return false;
  const { error } = await supabase
    .from('buddy_groups')
    .insert([{ name: name.trim(), description: description.trim() }]);
  return !error;
}

export async function deleteBuddyGroup(groupId) {
  if (!supabase || !groupId) return false;
  const { error } = await supabase
    .from('buddy_groups')
    .delete()
    .eq('id', groupId);
  return !error;
}

export async function assignApplicantBuddyGroup(applicantId, groupName) {
  if (!supabase || !applicantId || !groupName) return false;
  const { error } = await supabase
    .from('profiles')
    .update({ buddy_group_name: groupName })
    .eq('id', applicantId);
  return !error;
}

export async function getAllMembersList() {
  if (!supabase) return [];
  const { data } = await supabase
    .from('members')
    .select('id, email, full_name, racomm, buddy_group_name')
    .order('full_name', { ascending: true });
  return data || [];
}

export async function assignMemberBuddyGroup(memberId, groupName) {
  if (!supabase || !memberId || !groupName) return false;
  const { error } = await supabase
    .from('members')
    .update({ buddy_group_name: groupName })
    .eq('id', memberId);
  return !error;
}

export async function getAnnouncements() {
  if (!supabase) return [];
  const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  return data || [];
}

export async function createAnnouncement(title, content, author_email, author_avatar) {
  if (!supabase) return false;
  const { error } = await supabase.from('announcements').insert([{ title, content, author_email, author_avatar }]);
  return !error;
}

export async function deleteAnnouncement(id) {
  if (!supabase) return false;
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  return !error;
}

export async function getAvailabilitySlots() {
  if (!supabase) return [];
  const { data } = await supabase.from('availability_slots').select('*');
  return data || [];
}

export async function toggleUserAvailabilitySlot(userId, userName, slotKey, isAvailable) {
  if (!supabase) return false;
  if (isAvailable) {
    await supabase.from('availability_slots').delete().eq('user_id', userId).eq('time_slot', slotKey);
  } else {
    await supabase.from('availability_slots').insert([{ user_id: userId, user_name: userName, time_slot: slotKey }]);
  }
  return true;
}
