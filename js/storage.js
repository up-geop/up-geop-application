import { CONFIG } from './config.js';

export const supabase = window.supabase
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

let cachedTraitsPool = null;
let cachedTasksPool = null;

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const matches = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
    const cleanMatches = matches.map(m => m.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    
    const rowObj = {};
    headers.forEach((h, index) => {
      rowObj[h] = cleanMatches[index] || '';
    });
    rows.push(rowObj);
  }
  return rows;
}

export async function getCommitteeDirectory() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('committee_directory').select('*');
  if (error) {
    console.error('Error fetching directory:', error);
    return [];
  }
  return data || [];
}

export async function getAvailableTraitsPool() {
  if (cachedTraitsPool && cachedTraitsPool.length > 0) {
    return cachedTraitsPool;
  }

  try {
    const res = await fetch(CONFIG.SHEETS.TRAITS_CSV_URL);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const csvData = await res.text();
    const rows = parseCSV(csvData);

    const traits = rows
      .map(r => {
        const values = Object.values(r);
        return r.trait || r.traits || (values.length > 1 ? values[1] : values[0]);
      })
      .map(t => typeof t === 'string' ? t.trim() : '')
      .filter(t => {
        if (!t || t.length === 0) return false;
        const lower = t.toLowerCase();
        return !lower.startsWith('trait') && 
               !['academics', 'publicity', 'racomm', 'internal', 'external', 'finance'].includes(lower);
      });

    if (traits.length > 0) {
      cachedTraitsPool = [...new Set(traits)];
      return cachedTraitsPool;
    }
  } catch (err) {
    console.warn('Could not fetch traits from Google Sheets, checking database fallback:', err);
  }

  if (supabase) {
    const { data: sigTraits } = await supabase.from('signatories').select('trait');
    if (sigTraits && sigTraits.length > 0) {
      const fallback = [...new Set(sigTraits.map(s => s.trait).filter(Boolean))];
      if (fallback.length > 0) {
        cachedTraitsPool = fallback;
        return cachedTraitsPool;
      }
    }
  }

  return [];
}

export async function getAvailableTasksPool() {
  if (cachedTasksPool && cachedTasksPool.length > 0) {
    return cachedTasksPool;
  }

  try {
    const res = await fetch(CONFIG.SHEETS.TASKS_CSV_URL);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const csvData = await res.text();
    const rows = parseCSV(csvData);

    const tasks = rows
      .map(r => r.task || r.tasks || r.name || Object.values(r)[0])
      .map(t => typeof t === 'string' ? t.trim() : '')
      .filter(t => t.length > 0 && !t.toLowerCase().startsWith('task'));

    if (tasks.length > 0) {
      cachedTasksPool = [...new Set(tasks)];
      return cachedTasksPool;
    }
  } catch (err) {
    console.warn('Could not fetch tasks from Google Sheets:', err);
  }

  return [];
}

export async function getCurrentUserId() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

export async function checkIfResidentMember(email) {
  if (!supabase || !email) return false;
  const { data, error } = await supabase
    .from('members')
    .select('email')
    .ilike('email', email.trim())
    .maybeSingle();

  if (error || !data) return false;
  return true;
}

export async function checkIfRAComm(email) {
  if (!supabase || !email) return false;
  const { data, error } = await supabase
    .from('members')
    .select('racomm')
    .ilike('email', email.trim())
    .maybeSingle();

  if (error || !data) return false;
  return !!data.racomm;
}

export async function getAllMembersList() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('members')
    .select('id, email, full_name, buddy_group_name, racomm')
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error fetching members list:', error);
    return [];
  }
  return data || [];
}

export async function getSignatories(userId = null) {
  if (!supabase) return [];
  const uid = userId || await getCurrentUserId();
  if (!uid) return [];

  const { data, error } = await supabase
    .from('signatories')
    .select('*')
    .eq('user_id', uid)
    .order('id', { ascending: true });

  if (error) {
    console.error('Error fetching signatories:', error);
    return [];
  }
  return data || [];
}

export async function selectTaskForSignatory(sigId, taskName) {
  if (!supabase || !sigId) return false;
  const { error } = await supabase
    .from('signatories')
    .update({ selected_task: taskName })
    .eq('id', sigId);

  if (error) {
    console.error('Error updating selected task:', error);
    return false;
  }
  return true;
}

export async function updateSignatoryAnswer(sigId, field, value) {
  if (!supabase || !sigId || !field) return false;
  const updatePayload = {};
  updatePayload[field] = value;

  const { error } = await supabase
    .from('signatories')
    .update(updatePayload)
    .eq('id', sigId);

  if (error) {
    console.error(`Error updating signatory ${field}:`, error);
    return false;
  }
  return true;
}

export async function generateApplicantShortCode(targetId = null, type = 'SIGNATORY') {
  if (!supabase) return null;
  const uid = await getCurrentUserId();
  if (!uid) return null;

  await supabase
    .from('verification_codes')
    .delete()
    .eq('user_id', uid)
    .eq('type', type);

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const payload = {
    user_id: uid,
    code,
    type,
    created_at: new Date().toISOString()
  };

  if (targetId && targetId !== 'null') {
    payload.target_id = targetId;
  }

  const { error } = await supabase
    .from('verification_codes')
    .insert([payload]);

  if (error) {
    console.error('Error generating verification code:', error);
    return null;
  }
  return code;
}

export async function verifyUniversalCode(code, verifierEmail) {
  if (!supabase || !code || !verifierEmail) {
    return { success: false, message: 'Invalid verification parameters.' };
  }

  const cleanCode = code.trim().toUpperCase();
  const cleanEmail = verifierEmail.trim().toLowerCase();

  const { data: codeRecord, error: codeErr } = await supabase
    .from('verification_codes')
    .select('*')
    .eq('code', cleanCode)
    .maybeSingle();

  if (codeErr || !codeRecord) {
    return { success: false, message: 'Invalid or expired verification code.' };
  }

  const { data: member, error: memErr } = await supabase
    .from('members')
    .select('*')
    .ilike('email', cleanEmail)
    .maybeSingle();

  if (memErr || !member) {
    return { success: false, message: 'Only registered resident members can verify codes.' };
  }

  if (codeRecord.type === 'SIGNATORY') {
    const { data: sig, error: sigErr } = await supabase
      .from('signatories')
      .select('*')
      .eq('id', codeRecord.target_id)
      .maybeSingle();

    if (sigErr || !sig) {
      return { success: false, message: 'Target signatory was not found.' };
    }

    if (sig.completed) {
      return { success: false, message: 'This signatory has already been endorsed.' };
    }

    const isPESTask = sig.role === 'PES' || sig.type === 'PES' || (sig.committee_name || '').toUpperCase() === 'PES';
    const isVPTask = sig.role === 'VP' || sig.type === 'VP';

    let directory = [];
    if (isPESTask || isVPTask) {
      directory = await getCommitteeDirectory();
    }

    if (isPESTask) {
      const pesOfficer = directory.find(p => 
        p.role_type === 'PES' && 
        (p.full_name.toLowerCase() === (sig.member_name || '').toLowerCase() ||
         p.title.toLowerCase() === (sig.trait || sig.task || '').toLowerCase())
      );

      if (pesOfficer && pesOfficer.email.toLowerCase() !== cleanEmail) {
        return {
          success: false,
          message: `Forbidden: Only ${pesOfficer.title} (${pesOfficer.full_name}) can endorse this clearance.`
        };
      }
    }

    if (isVPTask) {
      const commConfig = directory.find(
        c => c.role_type === 'VP' && c.committee_name.toLowerCase() === (sig.committee_name || '').toLowerCase()
      );

      if (commConfig && commConfig.email.toLowerCase() !== cleanEmail) {
        return {
          success: false,
          message: `Forbidden: Only ${commConfig.full_name} (${commConfig.email}) can endorse this VP clearance.`
        };
      }
    }

    if (!isPESTask && !isVPTask) {
      const { count, error: countErr } = await supabase
        .from('signatories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', codeRecord.user_id)
        .eq('signed_by', member.full_name);

      if (!countErr && (count || 0) >= 4) {
        return {
          success: false,
          message: `${member.full_name} has already signed the maximum limit of 4 slots for this applicant.`
        };
      }
    }

    const updatePayload = {
      completed: true,
      signed_by: member.full_name,
      verified_at: new Date().toISOString()
    };

    let { error: updateErr } = await supabase
      .from('signatories')
      .update(updatePayload)
      .eq('id', sig.id);

    if (updateErr && updateErr.message && updateErr.message.includes('verified_at')) {
      const { error: retryErr } = await supabase
        .from('signatories')
        .update({
          completed: true,
          signed_by: member.full_name
        })
        .eq('id', sig.id);
      updateErr = retryErr;
    }

    if (updateErr) {
      console.error('Error updating signatory:', updateErr);
      return { success: false, message: updateErr.message || 'Database error occurred while recording signature.' };
    }

    await supabase.from('verification_codes').delete().eq('code', cleanCode);
    return { success: true, message: `Successfully endorsed by ${member.full_name}!` };
  }

  if (codeRecord.type === 'TAMBAY') {
    const active = await getActiveTambaySession(codeRecord.user_id);
    const settings = await getGlobalSettings();
    const baseMultiplier = settings.multiplier || 1.0;

    if (!active) {
      const { error: inErr } = await supabase
        .from('tambay_sessions')
        .insert([{
          user_id: codeRecord.user_id,
          time_in: new Date().toISOString(),
          verified_by: member.full_name
        }]);

      if (inErr) {
        return { success: false, message: 'Failed to start tambay session.' };
      }

      await supabase.from('verification_codes').delete().eq('code', cleanCode);
      return { success: true, message: `Applicant timed in by ${member.full_name}.` };
    } else {
      const now = new Date();
      const inTime = new Date(active.time_in);
      let durationHours = (now - inTime) / (1000 * 60 * 60);

      const { data: userProfile } = await supabase
        .from('profiles')
        .select('tambay_boost_active')
        .eq('id', codeRecord.user_id)
        .single();

      const hasBoost = !!userProfile?.tambay_boost_active;
      const effectiveMultiplier = baseMultiplier * (hasBoost ? 1.5 : 1.0);

      let creditedHours = durationHours * effectiveMultiplier;
      if (settings.dailyCapEnabled && creditedHours > 3.0) {
        creditedHours = 3.0;
      }
      creditedHours = Math.max(0.1, Number(creditedHours.toFixed(2)));

      await supabase.from('tambay_sessions').delete().eq('id', active.id);
      
      const { error: logErr } = await supabase
        .from('tambay_logs')
        .insert([{
          user_id: codeRecord.user_id,
          hours: creditedHours,
          verified_by: member.full_name + (hasBoost ? ' (1.5x Boost Applied)' : '')
        }]);

      if (logErr) {
        return { success: false, message: 'Failed to credit tambay hours.' };
      }

      if (hasBoost) {
        await supabase
          .from('profiles')
          .update({ tambay_boost_active: false })
          .eq('id', codeRecord.user_id);
      }

      await supabase.from('verification_codes').delete().eq('code', cleanCode);
      return { 
        success: true, 
        message: `Applicant timed out. +${creditedHours} hrs credited by ${member.full_name}${hasBoost ? ' with 1.5x boost!' : '!'}` 
      };
    }
  }

  return { success: false, message: 'Unsupported verification code type.' };
}

export async function getTambayHours(userId = null) {
  if (!supabase) return 0;
  const uid = userId || await getCurrentUserId();
  if (!uid) return 0;

  const { data, error } = await supabase
    .from('tambay_logs')
    .select('hours')
    .eq('user_id', uid);

  if (error || !data) return 0;
  return data.reduce((acc, row) => acc + (parseFloat(row.hours) || 0), 0);
}

export async function getActiveTambaySession(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('tambay_sessions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function getGlobalSettings() {
  if (!supabase) return { multiplier: 1.0, dailyCapEnabled: true };

  const { data } = await supabase
    .from('global_settings')
    .select('key, value');

  let multiplier = 1.0;
  let dailyCapEnabled = true;

  if (data) {
    const multObj = data.find(item => item.key === 'hourly_multiplier');
    const capObj = data.find(item => item.key === 'daily_cap_enabled');
    if (multObj) multiplier = parseFloat(multObj.value) || 1.0;
    if (capObj) dailyCapEnabled = capObj.value === 'true';
  }

  return { multiplier, dailyCapEnabled };
}

export async function updateGlobalSettings(key, value) {
  if (!supabase) return false;
  const { error } = await supabase
    .from('global_settings')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() });

  if (error) {
    console.error(`Error updating global setting ${key}:`, error);
    return false;
  }
  return true;
}

export async function spendCurrency(amount) {
  if (!supabase) return false;
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('currency')
    .eq('id', uid)
    .single();

  if (pErr || !profile || (profile.currency || 0) < amount) {
    return false;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ currency: profile.currency - amount })
    .eq('id', uid);

  return !error;
}

/* =========================================================
   PERKS HELPERS: POT, BOOST, TRAIT SWAPPING
   ========================================================= */

export async function getUserTaskContributions() {
  const uid = await getCurrentUserId();
  if (!uid || !supabase) return [];
  const { data, error } = await supabase.from('task_contributions').select('*').eq('user_id', uid);
  if (error) return [];
  return data;
}

export async function chipInToTask(taskId, amount) {
  if (!supabase || !taskId || amount <= 0) return { success: false, message: 'Invalid amount.' };
  const uid = await getCurrentUserId();
  if (!uid) return { success: false, message: 'User not authenticated.' };

  const { data, error } = await supabase.rpc('chip_in_to_task', {
    p_task_id: taskId,
    p_user_id: uid,
    p_amount: parseInt(amount, 10)
  });

  if (error) return { success: false, message: error.message };
  return { success: true, message: 'Successfully chipped in!' };
}

export async function withdrawFromTask(taskId, amount) {
  if (!supabase || !taskId || amount <= 0) return { success: false, message: 'Invalid amount.' };
  const uid = await getCurrentUserId();
  if (!uid) return { success: false, message: 'User not authenticated.' };

  const { data, error } = await supabase.rpc('withdraw_from_task', {
    p_task_id: taskId,
    p_user_id: uid,
    p_amount: parseInt(amount, 10)
  });

  if (error) return { success: false, message: error.message };
  return { success: true, message: 'Successfully withdrew AC!' };
}

export async function buyTambayMultiplierBoost() {
  if (!supabase) return { success: false, message: 'Database offline.' };
  const uid = await getCurrentUserId();
  if (!uid) return { success: false, message: 'Please sign in.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('currency, tambay_boost_active')
    .eq('id', uid)
    .single();

  if (!profile || (profile.currency || 0) < 40) {
    return { success: false, message: 'Insufficient AC (40 AC needed).' };
  }
  if (profile.tambay_boost_active) {
    return { success: false, message: 'You already have an active 1.5× boost ready for your next session!' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      currency: profile.currency - 40,
      tambay_boost_active: true
    })
    .eq('id', uid);

  if (error) return { success: false, message: 'Failed to activate session boost.' };
  return { success: true, message: '1.5× Boost activated! It will apply to your next clocked-out tambay session.' };
}

export async function swapSignatoryTrait(sigId, newTrait, cost) {
  if (!supabase || !sigId || !newTrait) return false;
  const uid = await getCurrentUserId();
  if (!uid) return false;

  const hasFunds = await spendCurrency(cost);
  if (!hasFunds) return false;

  let { error } = await supabase
    .from('signatories')
    .update({ task: newTrait })
    .eq('id', sigId)
    .eq('user_id', uid);

  if (!error) {
    await supabase
      .from('signatories')
      .update({ trait: newTrait })
      .eq('id', sigId)
      .eq('user_id', uid);

    await supabase
      .from('signatories')
      .update({ selected_task: newTrait })
      .eq('id', sigId)
      .eq('user_id', uid);
  }

  if (error) {
    console.error('Error updating signatory trait details:', error);
    await supabase.rpc('increment_currency', { user_id: uid, amount: cost }).catch(() => {});
    return false;
  }
  return true;
}

/* =========================================================
   BUDDY TASKS & DEADLINE EXTENSION HELPERS
   ========================================================= */

export async function getBuddyTasks() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('buddy_tasks')
    .select('*')
    .order('deadline', { ascending: true });

  if (error) {
    console.error('Error fetching buddy tasks:', error);
    return [];
  }
  return data || [];
}

export async function createBuddyTask(title, description, targetGroup, deadlineIso) {
  if (!supabase || !title || !deadlineIso) return false;
  const { error } = await supabase
    .from('buddy_tasks')
    .insert([{
      title: title.trim(),
      description: description ? description.trim() : '',
      target_group: targetGroup || 'ALL',
      deadline: deadlineIso
    }]);

  if (error) {
    console.error('Error creating buddy task:', error);
    return false;
  }
  return true;
}

export async function deleteBuddyTask(taskId) {
  if (!supabase || !taskId) return false;
  const { error } = await supabase
    .from('buddy_tasks')
    .delete()
    .eq('id', taskId);

  return !error;
}

export async function getApplicantBuddyTaskCompletions(userId = null) {
  if (!supabase) return [];
  const uid = userId || await getCurrentUserId();
  if (!uid) return [];

  const { data, error } = await supabase
    .from('buddy_task_completions')
    .select('*')
    .eq('user_id', uid);

  if (error) return [];
  return data || [];
}

export async function toggleBuddyTaskCompletion(taskId, applicantId, isCompleted, verifierName) {
  if (!supabase || !taskId || !applicantId) return false;

  if (isCompleted) {
    const { error } = await supabase
      .from('buddy_task_completions')
      .upsert([{
        task_id: taskId,
        user_id: applicantId,
        verified_by: verifierName,
        completed_at: new Date().toISOString()
      }], { onConflict: 'task_id,user_id' });
    return !error;
  } else {
    const { error } = await supabase
      .from('buddy_task_completions')
      .delete()
      .eq('task_id', taskId)
      .eq('user_id', applicantId);
    return !error;
  }
}

/* =========================================================
   ADMINISTRATION & GRADING HELPERS
   ========================================================= */

export async function getManagedBuddyGroups() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('buddy_groups')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching buddy groups:', error);
    return [];
  }
  return data || [];
}

export async function createBuddyGroup(name) {
  if (!supabase || !name) return false;
  const { error } = await supabase
    .from('buddy_groups')
    .insert([{ name: name.trim() }]);

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

export async function assignMemberBuddyGroup(memberId, groupName) {
  if (!supabase || !memberId || !groupName) return false;
  const { error } = await supabase
    .from('members')
    .update({ buddy_group_name: groupName })
    .eq('id', memberId);

  return !error;
}

export async function getBuddyGroupMembers(groupName) {
  if (!supabase || !groupName || groupName === 'Unassigned') return [];

  const [resMembers, resApplicants] = await Promise.all([
    supabase.from('members').select('full_name').eq('buddy_group_name', groupName),
    supabase.from('profiles').select('full_name, nickname').eq('buddy_group_name', groupName)
  ]);

  const list = [];
  (resMembers.data || []).forEach(m => {
    list.push({ full_name: m.full_name, nickname: '', role: 'Member' });
  });
  (resApplicants.data || []).forEach(a => {
    list.push({ full_name: a.full_name, nickname: a.nickname, role: 'Applicant' });
  });

  return list;
}

export async function adminUpdateApplicantGrades(applicantId, grades) {
  if (!supabase || !applicantId) return false;

  const { error } = await supabase
    .from('profiles')
    .update({
      grade_interview: parseFloat(grades.interview) || 0,
      grade_ogt: parseFloat(grades.ogt) || 0,
      grade_consti_quiz: parseFloat(grades.constiQuiz) || 0,
      grade_buddy_tasks: parseFloat(grades.buddyTasks) || 0
    })
    .eq('id', applicantId);

  return !error;
}

export async function getAllApplicantsProgress() {
  if (!supabase) return [];

  const [profilesRes, sigsRes, tambayLogsRes, activeSessionsRes, eventsRes] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('signatories').select('user_id, completed'),
    supabase.from('tambay_logs').select('user_id, hours'),
    supabase.from('tambay_sessions').select('user_id'),
    supabase.from('event_attendees').select('user_id')
  ]);

  const profiles = profilesRes.data || [];
  const sigs = sigsRes.data || [];
  const logs = tambayLogsRes.data || [];
  const attendedEvents = eventsRes.data || [];
  const activeSet = new Set((activeSessionsRes.data || []).map(s => s.user_id));

  return profiles.map(p => {
    const userSigs = sigs.filter(s => s.user_id === p.id);
    const totalSigs = userSigs.length || 21;
    const completedSigs = userSigs.filter(s => s.completed).length;

    const userLogs = logs.filter(l => l.user_id === p.id);
    const tambayHours = Number(userLogs.reduce((sum, l) => sum + (parseFloat(l.hours) || 0), 0).toFixed(1));

    const userEventsCount = attendedEvents.filter(e => e.user_id === p.id).length;

    const sigRatio = totalSigs > 0 ? (completedSigs / totalSigs) : 0;
    const tambayRatio = Math.min(tambayHours / CONFIG.TARGET_TAMBAY_HOURS, 1);

    const automatedScore = (userEventsCount * 5) + (sigRatio * 15) + (tambayRatio * 5);
    const manualScore = 
      (parseFloat(p.grade_interview) || 0) +
      (parseFloat(p.grade_ogt) || 0) +
      (parseFloat(p.grade_consti_quiz) || 0) +
      (parseFloat(p.grade_buddy_tasks) || 0);

    const overallPercent = Math.min(100, Math.round(automatedScore + manualScore));

    return {
      id: p.id,
      fullName: p.full_name,
      nickname: p.nickname,
      buddyGroup: p.buddy_group_name || 'Unassigned',
      completedSigs,
      totalSigs,
      tambayHours,
      overallPercent,
      isTimedIn: activeSet.has(p.id)
    };
  });
}

export async function getApplicantFullDetails(applicantId) {
  if (!supabase || !applicantId) return null;

  const [profileRes, sigsRes, logsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', applicantId).single(),
    supabase.from('signatories').select('*').eq('user_id', applicantId).order('id', { ascending: true }),
    supabase.from('tambay_logs').select('*').eq('user_id', applicantId).order('created_at', { ascending: false })
  ]);

  return {
    profile: profileRes.data,
    signatories: sigsRes.data || [],
    tambayLogs: logsRes.data || []
  };
}

export async function adminAdjustTambayHours(applicantId, hours) {
  if (!supabase || !applicantId) return false;
  const { error } = await supabase
    .from('tambay_logs')
    .insert([{
      user_id: applicantId,
      hours: parseFloat(hours),
      verified_by: 'RAComm Officer (Admin Adjust)'
    }]);

  return !error;
}

export async function adminAdjustTokens(applicantId, newBalance) {
  if (!supabase || !applicantId) return false;
  const { error } = await supabase
    .from('profiles')
    .update({ currency: parseInt(newBalance, 10) })
    .eq('id', applicantId);

  return !error;
}

export async function adminToggleApplicantSignatory(sigId, completed) {
  if (!supabase || !sigId) return false;
  const { error } = await supabase
    .from('signatories')
    .update({
      completed: !!completed,
      signed_by: completed ? 'RAComm Officer (Admin Override)' : null,
      verified_at: completed ? new Date().toISOString() : null
    })
    .eq('id', sigId);

  return !error;
}

export async function deleteApplicantProfile(applicantId) {
  if (!supabase || !applicantId) return false;
  const { error } = await supabase.rpc('admin_delete_applicant', {
    target_user_id: applicantId
  });

  if (error) {
    console.error('Error deleting applicant:', error);
    return false;
  }
  return true;
}

export async function getAnnouncements() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching announcements:', error);
    return [];
  }
  return data || [];
}

export async function createAnnouncement(title, content, authorEmail, targetGroup = null) {
  if (!supabase) return false;
  const { error } = await supabase
    .from('announcements')
    .insert([{
      title: title.trim(),
      content: content.trim(),
      author_email: authorEmail,
      target_group: targetGroup
    }]);

  return !error;
}

export async function deleteAnnouncement(id) {
  if (!supabase || !id) return false;
  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', id);

  return !error;
}

export async function getAvailabilitySlots() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('availability_slots')
    .select('*');

  if (error) {
    console.error('Error fetching availability:', error);
    return [];
  }
  return data || [];
}

export async function toggleUserAvailabilitySlot(userId, userName, timeSlot, isSelected) {
  if (!supabase || !userId || !timeSlot) return false;

  if (isSelected) {
    const { error } = await supabase
      .from('availability_slots')
      .delete()
      .eq('user_id', userId)
      .eq('time_slot', timeSlot);
    return !error;
  } else {
    const { error } = await supabase
      .from('availability_slots')
      .insert([{
        user_id: userId,
        user_name: userName,
        time_slot: timeSlot
      }]);
    return !error;
  }
}
