const SUPABASE_URL = 'https://cwbrzxqmlzgedaisaour.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_oZ1RQOpJ4BoIAq_vDAqHWw_lOnoqFo0';

const createClient = window.supabase?.createClient || window.supabaseClient?.createClient;
export const supabase = createClient ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

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
      if (inQuotes && nextChar === '"') { currentCell += '"'; i++; } 
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentCell.trim()); currentCell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) rows.push(currentRow);
      currentRow = []; currentCell = '';
    } else { currentCell += char; }
  }
  if (currentCell.length > 0 || currentRow.length > 0) { currentRow.push(currentCell.trim()); rows.push(currentRow); }
  if (rows.length <= 1) return [];
  const headers = rows[0].map(h => h.replace(/^["\uFEFF]|["\uFEFF]$/g, '').toLowerCase());
  return rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((header, idx) => obj[header] = row[idx] || '');
    obj._raw = row; return obj;
  });
}

async function fetchSheetPools() {
  try {
    const [traitsRes, tasksRes] = await Promise.all([
      fetch(TRAITS_SHEET_CSV_URL).then(r => r.text()),
      fetch(TASKS_SHEET_CSV_URL).then(r => r.text())
    ]);
    return { traits: parseCSV(traitsRes), tasks: parseCSV(tasksRes) };
  } catch (err) { return { traits: [], tasks: [] }; }
}

export async function generateApplicantSignatories(userId) {
  if (!supabase || !userId) return;
  const { data: existing } = await supabase.from('signatories').select('id').eq('user_id', userId);
  if (existing && existing.length > 0) return;

  const pools = await fetchSheetPools();
  const allTasks = pools.tasks.map(t => (t['task description'] || t._raw?.[0] || '').trim()).filter(val => val.length > 0 && isNaN(Number(val)));
  const shuffledTasks = [...allTasks].sort(() => 0.5 - Math.random());
  const applicant25Pool = shuffledTasks.slice(0, Math.min(25, shuffledTasks.length));

  const newSignatories = [];
  COMMITTEES_LIST.forEach((comm) => {
    newSignatories.push({ user_id: userId, committee_name: comm.name, type: 'MEMBER_1', role: 'MEMBER_1', task: `Find a member from ${comm.name}`, trait_description: `Find a member from ${comm.name}`, questions_required: 'Ask details', task_pool: applicant25Pool, completed: false });
    newSignatories.push({ user_id: userId, committee_name: comm.name, type: 'MEMBER_2', role: 'MEMBER_2', task: `Find another member from ${comm.name}`, trait_description: `Find another member from ${comm.name}`, questions_required: 'Ask details', task_pool: applicant25Pool, completed: false });
    newSignatories.push({ user_id: userId, committee_name: comm.name, type: 'VP', role: 'VP', task: `Official Endorsement by ${comm.vp}`, trait_description: `Official Endorsement by ${comm.vp}`, questions_required: 'Ask details', task_pool: applicant25Pool, completed: false });
  });
  await supabase.from('signatories').insert(newSignatories);
}

export async function selectTaskForSignatory(taskId, selectedTask) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase.from('signatories').update({ selected_task: selectedTask }).eq('id', taskId);
  return !error;
}

export async function generateApplicantShortCode(sigId = null, type = 'TAMBAY') {
  const userId = await getCurrentUserId();
  if (!supabase || !userId) return null;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let shortCode = '';
  for (let i = 0; i < 6; i++) shortCode += chars.charAt(Math.floor(Math.random() * chars.length));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await supabase.from('profiles').update({ temp_code: shortCode, code_expires_at: expiresAt, code_type: type, pending_sig_id: sigId }).eq('id', userId);
  return shortCode;
}

export async function getMemberSignatureCount(email) {
  if (!supabase || !email) return 0;
  const { count } = await supabase.from('signatories').select('id', { count: 'exact', head: true }).ilike('signed_by', email.trim()).eq('completed', true);
  return count || 0;
}

export const MEMBER_SIGNATORY_LIMIT = 4;

export async function verifyUniversalCode(code, verifierEmail) {
  if (!supabase || !code || !verifierEmail) return { success: false, message: 'Invalid verification parameters.' };
  const isMember = await checkIfResidentMember(verifierEmail);
  const isRAComm = await checkIfRAComm(verifierEmail);

  if (!isMember && !isRAComm) return { success: false, message: 'Access Denied: Only active members or officers can verify.' };

  const { data: profile } = await supabase.from('profiles').select('*').eq('temp_code', code.trim().toUpperCase()).maybeSingle();
  if (!profile || new Date(profile.code_expires_at) < new Date()) return { success: false, message: 'Invalid or expired verification code.' };

  if (profile.code_type === 'SIGNATORY' && profile.pending_sig_id) {
    if (isMember && !isRAComm) {
      const signedCount = await getMemberSignatureCount(verifierEmail);
      if (signedCount >= MEMBER_SIGNATORY_LIMIT) return { success: false, message: `Limit reached: You've signed ${MEMBER_SIGNATORY_LIMIT} tasks.` };
    }
    const { error } = await supabase.from('signatories').update({ completed: true, signed_by: verifierEmail, signed_at: new Date().toISOString() }).eq('id', profile.pending_sig_id);
    if (error) return { success: false, message: error.message };
    await supabase.from('profiles').update({ temp_code: null }).eq('id', profile.id);
    return { success: true, message: `Verified Signatory Task for ${profile.nickname || 'Applicant'}!` };
  } 
  
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
  return { dailyCapEnabled: capRow ? capRow.value === 'true' : true, multiplier: multRow ? parseFloat(multRow.value) : 1.0 };
}

export async function updateGlobalSettings(key, value) {
  if (!supabase) return false;
  const { error } = await supabase.from('global_settings').upsert({ key, value: String(value) });
  return !error;
}

export async function getActiveTambaySession(applicantId) {
  const targetId = applicantId || await getCurrentUserId();
  if (!supabase || !targetId) return null;
  const { data } = await supabase.from('tambay_sessions').select('*').eq('applicant_id', targetId).eq('status', 'ACTIVE').maybeSingle();
  return data;
}

export async function validateApplicantTambay(applicantId, memberEmail) {
  if (!supabase || !applicantId || !memberEmail) return { success: false, message: 'Invalid request.' };
  const activeSession = await getActiveTambaySession(applicantId);
  const settings = await getGlobalSettings();

  if (!activeSession) {
    const { error } = await supabase.from('tambay_sessions').insert([{ applicant_id: applicantId, time_in: new Date().toISOString(), scanned_by_in: memberEmail, status: 'ACTIVE' }]);
    if (error) return { success: false, message: error.message };
    return { success: true, message: 'Applicant Timed IN successfully!' };
  } else {
    const timeIn = new Date(activeSession.time_in);
    const timeOut = new Date();
    const rawHours = Math.max(0.1, parseFloat(((timeOut - timeIn) / (1000 * 60 * 60)).toFixed(2)));
    const calculatedHours = rawHours * settings.multiplier;

    await supabase.from('tambay_sessions').update({ time_out: timeOut.toISOString(), hours_logged: calculatedHours, scanned_by_out: memberEmail, status: 'COMPLETED' }).eq('id', activeSession.id);
    await supabase.from('tambay_logs').insert([{ hours: calculatedHours, user_id: applicantId }]);
    return { success: true, message: `Applicant Timed OUT! Logged ${calculatedHours.toFixed(2)} hours.` };
  }
}

export async function getSignatories() {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return [];
  await generateApplicantSignatories(userId);
  const { data } = await supabase.from('signatories').select('*').eq('user_id', userId).order('created_at', { ascending: true });
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

    const sigRatio = completedSigs / (userSigs.length || 23);
    const tambayRatio = Math.min(totalTambayHours / 24, 1);
    const overallPercent = Math.round((sigRatio * 0.50 + tambayRatio * 0.35) * 100);
    const isTimedIn = (activeSessions || []).some(s => s.applicant_id === profile.id);

    return {
      id: profile.id, fullName: profile.full_name || 'N/A', nickname: profile.nickname || 'N/A',
      buddyGroup: profile.buddy_group_name || 'Unassigned', completedSigs, totalSigs: userSigs.length || 23,
      tambayHours: totalTambayHours.toFixed(1), overallPercent, isTimedIn
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
  await supabase.from('bids').delete().eq('applicant_id', applicantId);
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

export async function adminToggleApplicantSignatory(taskId, currentStatus) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase.from('signatories').update({ completed: !currentStatus }).eq('id', taskId);
  return !error;
}

export async function getBuddyGroupMembers(groupName) {
  if (!groupName || !supabase) return [];
  const { data } = await supabase.from('profiles').select('full_name, nickname').eq('buddy_group_name', groupName);
  return data || [];
}

export async function getAnnouncements() {
  if (!supabase) return [];
  const { data } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  return data || [];
}

export async function createAnnouncement(title, content, authorEmail, authorAvatar = null) {
  if (!supabase || !title || !content) return false;
  const { error } = await supabase.from('announcements').insert([{ title, content, author_email: authorEmail, author_avatar: authorAvatar }]);
  return !error;
}

export async function deleteAnnouncement(announcementId) {
  if (!supabase || !announcementId) return false;
  const { error } = await supabase.from('announcements').delete().eq('id', announcementId);
  return !error;
}

export async function getAvailabilitySlots() {
  if (!supabase) return [];
  const { data } = await supabase.from('availability_slots').select('*');
  return data || [];
}

export async function toggleUserAvailabilitySlot(userId, userName, slotKey, isAvailable) {
  if (!supabase) return false;
  if (isAvailable) { await supabase.from('availability_slots').delete().eq('user_id', userId).eq('time_slot', slotKey); } 
  else { await supabase.from('availability_slots').insert({ user_id: userId, user_name: userName, time_slot: slotKey }); }
  return true;
}

// ==========================================
// BLIND BUDDY BIDDING AUCTION (ESCROW LOGIC)
// ==========================================

export async function getBiddingState() {
  if (!supabase) return { is_active: false };
  const { data } = await supabase.from('bidding_state').select('is_active').eq('id', 1).single();
  return data || { is_active: false };
}

export async function getBuddyFams() {
  if (!supabase) return [];
  const { data } = await supabase.from('buddy_fams').select('*').order('name');
  return data || [];
}

// Fetch all bids for a specific family to build the Top 3 Leaderboard
export async function getTopBidsForFam(famId) {
  if (!supabase) return [];
  const { data } = await supabase.from('bids').select('amount').eq('fam_id', famId).order('amount', { ascending: false }).limit(3);
  return data || [];
}

// Calculates how much AC an applicant has available to spend (Total - Locked in other active bids)
export async function getAvailableAC(userId) {
  if (!supabase || !userId) return 0;
  const { data: profile } = await supabase.from('profiles').select('currency').eq('id', userId).single();
  const { data: bids } = await supabase.from('bids').select('amount').eq('applicant_id', userId);
  
  const totalAC = profile?.currency || 100;
  const escrowedAC = (bids || []).reduce((sum, bid) => sum + bid.amount, 0);
  
  return { totalAC, availableAC: totalAC - escrowedAC, myBids: bids || [] };
}

// Places or updates a bid. Verifies escrow balance.
export async function placeBid(famId, newBidAmount) {
  const userId = await getCurrentUserId();
  if (!userId || !supabase) return { success: false, message: 'Not authenticated.' };

  const { totalAC, availableAC } = await getAvailableAC(userId);
  const { data: existingBid } = await supabase.from('bids').select('amount').eq('applicant_id', userId).eq('fam_id', famId).maybeSingle();
  
  const currentBidOnThisFam = existingBid ? existingBid.amount : 0;
  const costDifference = newBidAmount - currentBidOnThisFam;

  // Validate if they have enough unlocked AC for the difference
  if (costDifference > availableAC) {
    return { success: false, message: `Insufficient AC! You only have ${availableAC} unlocked AC available.` };
  }

  // If 0, they are retracting their bid
  if (newBidAmount <= 0) {
    await supabase.from('bids').delete().eq('applicant_id', userId).eq('fam_id', famId);
    return { success: true, message: 'Bid retracted.' };
  }

  // Upsert the bid
  const { error } = await supabase.from('bids').upsert({ applicant_id: userId, fam_id: famId, amount: newBidAmount });
  return { success: !error, message: error ? error.message : 'Bid locked in escrow!' };
}

export async function adminUpdateBiddingState(isActive) {
  const { error } = await supabase.from('bidding_state').update({ is_active: isActive }).eq('id', 1);
  if (error) console.error(error);
  
  // If opening a new round, clear all old unfinalized bids
  if (isActive === true) {
    await supabase.from('bids').delete().neq('amount', -1); // Clears all
  }
  return !error;
}

// The Grand Resolution: Sorts all bids globally, assigns top 3 per group, refunds losers, and auto-fills
export async function adminResolveBidding() {
  // 1. Fetch all needed data
  const { data: allBids } = await supabase.from('bids').select('*').order('amount', { ascending: false });
  const { data: fams } = await supabase.from('buddy_fams').select('*').eq('is_locked', false);
  const { data: applicants } = await supabase.from('profiles').select('id, currency, buddy_group_name').eq('role', 'APPLICANT'); // Make sure applicants are distinguishable, or fetch all if everyone is an app

  if (!fams || !applicants || !allBids) return false;

  let assignments = {}; // applicant_id -> assigned fam_id
  let famCounts = {}; // fam_id -> number of applicants assigned
  let spentAc = {}; // applicant_id -> amount spent
  
  fams.forEach(f => famCounts[f.id] = 0);

  // 2. Loop through all bids globally (Highest to lowest)
  // Tie-breakers are inherently handled by standard DB sorting (or can add random factor if needed)
  for (let bid of allBids) {
    // If the applicant doesn't have a group yet AND the family has less than 3 slots filled
    if (!assignments[bid.applicant_id] && famCounts[bid.fam_id] < 3) {
      assignments[bid.applicant_id] = bid.fam_id;
      famCounts[bid.fam_id]++;
      spentAc[bid.applicant_id] = bid.amount;
    }
  }

  // 3. Safety Net Auto-Fill (For applicants who didn't win or didn't bid)
  // Create an array of remaining available slots across all groups
  let availableSlots = [];
  for (let f of fams) {
    let slotsLeft = 3 - famCounts[f.id];
    for (let i = 0; i < slotsLeft; i++) availableSlots.push(f.id);
  }
  // Shuffle slots randomly
  availableSlots.sort(() => Math.random() - 0.5);

  let unassigned = applicants.filter(a => !assignments[a.id] && a.buddy_group_name === 'Unassigned');
  unassigned.forEach(u => {
    if (availableSlots.length > 0) {
      assignments[u.id] = availableSlots.pop();
      spentAc[u.id] = 0; // Auto-filled, so it's free
    }
  });

  // 4. Update Database (Deduct only winning bids, assign groups, lock groups)
  for (let app of applicants) {
    let assignedFamId = assignments[app.id];
    if (assignedFamId) {
      let assignedFamName = fams.find(f => f.id === assignedFamId)?.name;
      let finalAc = app.currency - (spentAc[app.id] || 0); // Refunds happen naturally because we strictly deduct winning cost from the true total currency
      
      await supabase.from('profiles').update({
        buddy_group_name: assignedFamName,
        currency: finalAc
      }).eq('id', app.id);
    }
  }

  // 5. Lock the families & close the round
  for (let f of fams) {
    await supabase.from('buddy_fams').update({ is_locked: true }).eq('id', f.id);
  }
  await supabase.from('bidding_state').update({ is_active: false }).eq('id', 1);
  await supabase.from('bids').delete().neq('amount', -1); // Clear escrow table for clean slate

  return true;
}
