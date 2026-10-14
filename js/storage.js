import { CONFIG } from './config.js';

// Strict Singleton: Prevents Multiple GoTrueClient instances
if (!window.geopSupabaseInstance && window.supabase) {
  window.geopSupabaseInstance = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}
export const supabase = window.geopSupabaseInstance || null;

// In-Memory Caches for Static / Semi-Static Data
let cachedTraitsPool = null;
let cachedTasksPool = null;
let cachedDirectory = null;
let cachedMembersList = null;
const memberProfileCache = new Map();

export function invalidateCache(type = 'ALL') {
  if (type === 'ALL' || type === 'MEMBERS') {
    cachedMembersList = null;
    memberProfileCache.clear();
  }
  if (type === 'ALL' || type === 'DIRECTORY') {
    cachedDirectory = null;
  }
}

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
  if (cachedDirectory) return cachedDirectory;
  if (!supabase) return [];
  const { data, error } = await supabase.from('committee_directory').select('*');
  if (error) {
    console.error('Error fetching directory:', error);
    return [];
  }
  cachedDirectory = data || [];
  return cachedDirectory;
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

export async function getMemberProfile(email) {
  if (!supabase || !email) return null;
  const key = email.trim().toLowerCase();
  if (memberProfileCache.has(key)) return memberProfileCache.get(key);

  const { data, error } = await supabase
    .from('members')
    .select('*')
    .ilike('email', key)
    .maybeSingle();

  if (!error) {
    memberProfileCache.set(key, data || null);
  }
  return data || null;
}

export async function checkIfResidentMember(email) {
  const member = await getMemberProfile(email);
  return !!member;
}

export async function checkIfRAComm(email) {
  const member = await getMemberProfile(email);
  return !!member?.racomm;
}

export async function getAllMembersList() {
  if (cachedMembersList) return cachedMembersList;
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('members')
    .select('id, email, full_name, buddy_group_name, racomm')
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error fetching members list:', error);
    return [];
  }
  cachedMembersList = data || [];
  return cachedMembersList;
}

/* =========================================================
   MEMBER SIGNATURE QUOTA & ACTIVITY LOG HELPERS
   ========================================================= */
export async function getMemberSignatureCounts() {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('signatories')
    .select('signed_by, committee_name, role, type')
    .eq('completed', true);

  if (error || !data) return {};
  const counts = {};
  data.forEach(s => {
    const isPESTask = s.role === 'PES' || s.type === 'PES' || (s.committee_name || '').toUpperCase() === 'PES';
    const isVPTask = s.role === 'VP' || s.type === 'VP';
    const isOATask = ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.committee_name || '').toUpperCase()) ||
                     ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.role || '').toUpperCase());

    if (!isPESTask && !isVPTask && !isOATask && s.signed_by) {
      counts[s.signed_by] = (counts[s.signed_by] || 0) + 1;
    }
  });
  return counts;
}

export async function getMemberPersonalActivityLog(memberFullName) {
  if (!supabase || !memberFullName) {
    return { signedList: [], tambayVerifications: [], regularSigCount: 0 };
  }

  const cleanName = memberFullName.trim();
  const [sigsRes, logsRes, activeRes, profilesRes] = await Promise.all([
    supabase.from('signatories').select('*').eq('completed', true).ilike('signed_by', cleanName),
    supabase.from('tambay_logs').select('*').ilike('verified_by', `${cleanName}%`).order('created_at', { ascending: false }).limit(20),
    supabase.from('tambay_sessions').select('*').ilike('verified_by', cleanName),
    supabase.from('profiles').select('id, full_name, nickname, buddy_group_name')
  ]);

  const profileMap = new Map((profilesRes.data || []).map(p => [p.id, p]));

  let regularSigCount = 0;
  const signedList = (sigsRes.data || []).map(s => {
    const p = profileMap.get(s.user_id) || {};
    const isPESTask = s.role === 'PES' || s.type === 'PES' || (s.committee_name || '').toUpperCase() === 'PES';
    const isVPTask = s.role === 'VP' || s.type === 'VP';
    const isOATask = ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.committee_name || '').toUpperCase()) ||
                     ['O.A', 'ALUMNI', 'OTHER MEMBER'].includes((s.role || '').toUpperCase());
    if (!isPESTask && !isVPTask && !isOATask) {
      regularSigCount++;
    }
    return {
      ...s,
      applicantName: p.nickname ? `${p.full_name} ("${p.nickname}")` : (p.full_name || 'Applicant'),
      applicantGroup: p.buddy_group_name || 'Unassigned',
      isRegularQuota: !isPESTask && !isVPTask && !isOATask
    };
  });

  const tambayVerifications = [
    ...(activeRes.data || []).map(a => {
      const p = profileMap.get(a.user_id) || {};
      return {
        id: a.id,
        applicantName: p.nickname ? `${p.full_name} ("${p.nickname}")` : (p.full_name || 'Applicant'),
        type: 'Active Time-In',
        hours: null,
        timestamp: a.time_in
      };
    }),
    ...(logsRes.data || []).map(l => {
      const p = profileMap.get(l.user_id) || {};
      return {
        id: l.id,
        applicantName: p.nickname ? `${p.full_name} ("${p.nickname}")` : (p.full_name || 'Applicant'),
        type: 'Completed Session',
        hours: l.hours,
        timestamp: l.created_at
      };
    })
  ];

  return { signedList, tambayVerifications, regularSigCount };
}

export async function getMostApproachedMembersLeaderboard() {
  if (!supabase) return [];
  const [sigsRes, logsRes] = await Promise.all([
    supabase.from('signatories').select('signed_by').eq('completed', true),
    supabase.from('tambay_logs').select('verified_by')
  ]);

  const statsMap = new Map();

  const ensureEntry = (name) => {
    if (!statsMap.has(name)) {
      statsMap.set(name, { name, sigs: 0, tambay: 0, total: 0 });
    }
    return statsMap.get(name);
  };

  (sigsRes.data || []).forEach(s => {
    const raw = (s.signed_by || '').trim();
    if (!raw || raw.includes('Admin Override')) return;
    const entry = ensureEntry(raw);
    entry.sigs++;
    entry.total++;
  });

  (logsRes.data || []).forEach(l => {
    let raw = (l.verified_by || '').trim();
    if (!raw || raw.includes('Admin Adjust') || raw.includes('Force-Close')) return;
    raw = raw.replace(/\s*\(1\.5x Boost Applied\)\s*/i, '').trim();
    if (!raw) return;
    const entry = ensureEntry(raw);
    entry.tambay++;
    entry.total++;
  });

  return Array.from(statsMap.values())
    .sort((a, b) => b.total - a.total || b.sigs - a.sigs)
    .slice(0, 8);
}

// Notification Helpers
export async function createNotification(userId, message) {
  if (!supabase || !userId) return;
  await supabase.from('notifications').insert([{ user_id: userId, message }]);
}

export async function fetchAndClearNotifications(userId) {
  if (!supabase || !userId) return [];
  const { data } = await supabase.from('notifications').select('*').eq('user_id', userId).eq('is_read', false);
  if (data && data.length > 0) {
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).in('id', data.map(n => n.id));
  }
  return data || [];
}

export async function getUnreadNotificationCount(userId) {
  if (!supabase || !userId) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  return count || 0;
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
  const { error } = await supabase
    .from('signatories')
    .update({ [field]: value })
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

/* =========================================================
   VERIFICATION PREVIEW HELPER FOR RESIDENT MEMBERS
   ========================================================= */
export async function getVerificationCodePreview(code, verifierEmail) {
  if (!supabase || !code || !verifierEmail) {
    return { valid: false, message: 'Invalid verification parameters.' };
  }

  const cleanCode = code.trim().toUpperCase();
  const cleanEmail = verifierEmail.trim().toLowerCase();

  const [codeRes, member] = await Promise.all([
    supabase.from('verification_codes').select('*').eq('code', cleanCode).maybeSingle(),
    getMemberProfile(cleanEmail)
  ]);

  const codeRecord = codeRes.data;
  if (codeRes.error || !codeRecord) {
    return { valid: false, message: 'Invalid or expired verification code.' };
  }

  if (!member) {
    return { valid: false, message: 'Only registered resident members can verify codes.' };
  }

  const { data: applicant } = await supabase
    .from('profiles')
    .select('id, full_name, nickname, buddy_group_name, tambay_boost_active')
    .eq('id', codeRecord.user_id)
    .maybeSingle();

  if (codeRecord.type === 'SIGNATORY') {
    const { data: sig } = await supabase
      .from('signatories')
      .select('*')
      .eq('id', codeRecord.target_id)
      .maybeSingle();

    if (!sig) {
      return { valid: false, message: 'Target signatory was not found.' };
    }
    if (sig.completed) {
      return { valid: false, message: 'This signatory has already been endorsed.' };
    }

    return {
      valid: true,
      code: cleanCode,
      type: 'SIGNATORY',
      applicant,
      signatory: sig,
      member
    };
  }

  if (codeRecord.type === 'TAMBAY') {
    const active = await getActiveTambaySession(codeRecord.user_id);
    return {
      valid: true,
      code: cleanCode,
      type: 'TAMBAY',
      applicant,
      activeSession: active,
      member
    };
  }

  return { valid: false, message: 'Unsupported verification code type.' };
}

export async function verifyUniversalCode(code, verifierEmail) {
  if (!supabase || !code || !verifierEmail) {
    return { success: false, message: 'Invalid verification parameters.' };
  }

  const cleanCode = code.trim().toUpperCase();
  const cleanEmail = verifierEmail.trim().toLowerCase();

  const [codeRes, member] = await Promise.all([
    supabase.from('verification_codes').select('*').eq('code', cleanCode).maybeSingle(),
    getMemberProfile(cleanEmail)
  ]);

  const codeRecord = codeRes.data;
  if (codeRes.error || !codeRecord) {
    return { success: false, message: 'Invalid or expired verification code.' };
  }

  if (!member) {
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
    const isOATask = (sig.committee_name || '').toUpperCase() === 'O.A' || (sig.role || '').toUpperCase() === 'O.A';

    if (isPESTask || isVPTask) {
      const directory = await getCommitteeDirectory();

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
    }

    if (!isPESTask && !isVPTask && !isOATask) {
      const settings = await getGlobalSettings();
      
      if (settings.memberSigLimitEnabled) {
        const { count, error: countErr } = await supabase
          .from('signatories')
          .select('id', { count: 'exact', head: true })
          .eq('signed_by', member.full_name)
          .neq('committee_name', 'O.A');

        if (!countErr && (count || 0) >= 4) {
          return {
            success: false,
            message: `${member.full_name} has reached their global limit of 4 regular signatures. (O.A. verifications do not count towards this limit).`
          };
        }
      }
    }

    let { error: updateErr } = await supabase
      .from('signatories')
      .update({
        completed: true,
        signed_by: member.full_name,
        verified_at: new Date().toISOString()
      })
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

    await Promise.all([
      supabase.from('verification_codes').delete().eq('code', cleanCode),
      createNotification(codeRecord.user_id, `${member.full_name} verified your ${sig.trait || sig.task} signatory!`)
    ]);
    
    return { success: true, message: `Successfully endorsed by ${member.full_name}!` };
  }

  if (codeRecord.type === 'TAMBAY') {
    const [active, settings] = await Promise.all([
      getActiveTambaySession(codeRecord.user_id),
      getGlobalSettings()
    ]);
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

      await Promise.all([
        supabase.from('verification_codes').delete().eq('code', cleanCode),
        createNotification(codeRecord.user_id, `${member.full_name} scanned your Time-In!`)
      ]);

      return { success: true, message: `Applicant timed in by ${member.full_name}.` };
    } else {
      const now = new Date();
      const inTime = new Date(active.time_in);
      const durationHours = (now - inTime) / (1000 * 60 * 60);

      const { data: userProfile } = await supabase
        .from('profiles')
        .select('tambay_boost_active')
        .eq('id', codeRecord.user_id)
        .single();

      const hasBoost = !!userProfile?.tambay_boost_active;
      const effectiveMultiplier = baseMultiplier * (hasBoost ? 1.5 : 1.0);

      let creditedHours = durationHours * effectiveMultiplier;
      
      if (settings.dailyCapEnabled) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const { data: todaysLogs } = await supabase
          .from('tambay_logs')
          .select('hours')
          .eq('user_id', codeRecord.user_id)
          .gte('created_at', startOfDay.toISOString());

        const hoursAlreadyToday = (todaysLogs || []).reduce((sum, log) => sum + (parseFloat(log.hours) || 0), 0);
        const hoursRemainingToday = Math.max(0, 3.0 - hoursAlreadyToday);

        if (creditedHours > hoursRemainingToday) {
          creditedHours = hoursRemainingToday;
        }
      }
      
      if (creditedHours <= 0) {
        await Promise.all([
          supabase.from('tambay_sessions').delete().eq('id', active.id),
          supabase.from('verification_codes').delete().eq('code', cleanCode)
        ]);
        return { success: false, message: 'Daily limit of 3 hours reached. Timed out with 0 additional hours credited.' };
      }
      
      creditedHours = Number(creditedHours.toFixed(2));

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

      const postTasks = [
        supabase.from('verification_codes').delete().eq('code', cleanCode),
        createNotification(codeRecord.user_id, `${member.full_name} timed you out (+${creditedHours} hrs)!`)
      ];

      if (hasBoost) {
        postTasks.push(
          supabase.from('profiles').update({ tambay_boost_active: false }).eq('id', codeRecord.user_id)
        );
      }

      await Promise.all(postTasks);

      return { 
        success: true, 
        message: `Applicant timed out. +${creditedHours} hrs credited by ${member.full_name}${hasBoost ? ' with 1.5x boost!' : '!'}` 
      };
    }
  }

  return { success: false, message: 'Unsupported verification code type.' };
}

/* =========================================================
   LIVE TAMBAYAN SESSIONS, LOG HISTORY & RACOMM FORCE-CLOSE
   ========================================================= */
export async function getAllActiveTambaySessions() {
  if (!supabase) return [];
  const [sessionsRes, profilesRes] = await Promise.all([
    supabase.from('tambay_sessions').select('*').order('time_in', { ascending: true }),
    supabase.from('profiles').select('id, full_name, nickname, buddy_group_name')
  ]);

  const sessions = sessionsRes.data || [];
  const profileMap = new Map((profilesRes.data || []).map(p => [p.id, p]));

  return sessions.map(s => {
    const p = profileMap.get(s.user_id) || {};
    const elapsedHours = (Date.now() - new Date(s.time_in).getTime()) / (1000 * 60 * 60);
    return {
      ...s,
      fullName: p.full_name || 'Applicant',
      nickname: p.nickname || '',
      buddyGroup: p.buddy_group_name || 'Unassigned',
      elapsedHours,
      isStale: elapsedHours >= 8
    };
  });
}

export async function adminForceCloseTambaySession(userId, creditHours = 0, officerEmail = 'RAComm Officer') {
  if (!supabase || !userId) return false;
  const active = await getActiveTambaySession(userId);
  if (!active) return false;

  const { error: delErr } = await supabase
    .from('tambay_sessions')
    .delete()
    .eq('id', active.id);

  if (delErr) return false;

  const parsedCredit = Number((parseFloat(creditHours) || 0).toFixed(2));
  if (parsedCredit > 0) {
    await supabase.from('tambay_logs').insert([{
      user_id: userId,
      hours: parsedCredit,
      verified_by: `${officerEmail} (RAComm Force-Close)`
    }]);
  }

  await createNotification(
    userId,
    `Your active tambay session was closed by RAComm (${parsedCredit > 0 ? `+${parsedCredit} hrs credited` : '0 hrs credited - forgotten time-out'}).`
  );

  return true;
}

export async function getApplicantTambayLogHistory(userId = null) {
  if (!supabase) return [];
  const uid = userId || await getCurrentUserId();
  if (!uid) return [];

  const { data, error } = await supabase
    .from('tambay_logs')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data;
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

export async function resetTambayHours(userId = null) {
  if (!supabase) return false;
  const uid = userId || await getCurrentUserId();
  if (!uid) return false;
  const { error } = await supabase.from('tambay_logs').delete().eq('user_id', uid);
  return !error;
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
  if (!supabase) return { multiplier: 1.0, dailyCapEnabled: true, memberSigLimitEnabled: true };

  const { data } = await supabase
    .from('global_settings')
    .select('key, value');

  let multiplier = 1.0;
  let dailyCapEnabled = true;
  let memberSigLimitEnabled = true;

  if (data) {
    const multObj = data.find(item => item.key === 'hourly_multiplier');
    const capObj = data.find(item => item.key === 'daily_cap_enabled');
    const sigLimObj = data.find(item => item.key === 'member_sig_limit_enabled');
    if (multObj) multiplier = parseFloat(multObj.value) || 1.0;
    if (capObj) dailyCapEnabled = capObj.value === 'true';
    if (sigLimObj) memberSigLimitEnabled = sigLimObj.value === 'true';
  }

  return { multiplier, dailyCapEnabled, memberSigLimitEnabled };
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

  const { error } = await supabase.rpc('chip_in_to_task', {
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

  const { error } = await supabase.rpc('withdraw_from_task', {
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

  const { error } = await supabase
    .from('signatories')
    .update({
      task: newTrait,
      trait: newTrait,
      selected_task: null
    })
    .eq('id', sigId)
    .eq('user_id', uid);

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
   BULK EVENT ATTENDANCE & ADMIN HELPERS
   ========================================================= */
export async function getEventAttendeeUserIds(eventId) {
  if (!supabase || !eventId) return [];
  const { data, error } = await supabase
    .from('event_attendees')
    .select('user_id')
    .eq('event_id', eventId);

  if (error || !data) return [];
  return data.map(r => r.user_id);
}

export async function adminBulkSetEventAttendance(eventId, targetUserIds, officerEmail) {
  if (!supabase || !eventId) return false;

  const existingIds = new Set(await getEventAttendeeUserIds(eventId));
  const desiredIds = new Set(targetUserIds || []);

  const toInsert = [...desiredIds]
    .filter(uid => !existingIds.has(uid))
    .map(uid => ({
      user_id: uid,
      event_id: eventId,
      marked_by: officerEmail
    }));

  const toDelete = [...existingIds].filter(uid => !desiredIds.has(uid));

  const ops = [];
  if (toInsert.length > 0) {
    ops.push(supabase.from('event_attendees').insert(toInsert));
  }
  if (toDelete.length > 0) {
    ops.push(
      supabase
        .from('event_attendees')
        .delete()
        .eq('event_id', eventId)
        .in('user_id', toDelete)
    );
  }

  if (ops.length === 0) return true;
  const results = await Promise.all(ops);
  return results.every(r => !r.error);
}

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

  if (!error) invalidateCache('MEMBERS');
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
    supabase.from('tambay_sessions').select('user_id, time_in'),
    supabase.from('event_attendees').select('user_id')
  ]);

  const profiles = profilesRes.data || [];
  const activeSessionMap = new Map((activeSessionsRes.data || []).map(s => [s.user_id, s.time_in]));

  const sigStatsMap = new Map();
  (sigsRes.data || []).forEach(s => {
    const cur = sigStatsMap.get(s.user_id) || { total: 0, completed: 0 };
    cur.total++;
    if (s.completed) cur.completed++;
    sigStatsMap.set(s.user_id, cur);
  });

  const tambaySumMap = new Map();
  (tambayLogsRes.data || []).forEach(l => {
    const cur = tambaySumMap.get(l.user_id) || 0;
    tambaySumMap.set(l.user_id, cur + (parseFloat(l.hours) || 0));
  });

  const eventCountMap = new Map();
  (eventsRes.data || []).forEach(e => {
    eventCountMap.set(e.user_id, (eventCountMap.get(e.user_id) || 0) + 1);
  });

  return profiles.map(p => {
    const sigStat = sigStatsMap.get(p.id) || { total: 0, completed: 0 };
    const totalSigs = sigStat.total || 21;
    const completedSigs = sigStat.completed;

    const rawTambay = tambaySumMap.get(p.id) || 0;
    const tambayHours = Number(rawTambay.toFixed(1));

    const userEventsCount = eventCountMap.get(p.id) || 0;

    const sigRatio = totalSigs > 0 ? (completedSigs / totalSigs) : 0;
    const tambayRatio = Math.min(tambayHours / CONFIG.TARGET_TAMBAY_HOURS, 1);

    const automatedScore = (userEventsCount * 5) + (sigRatio * 15) + (tambayRatio * 5);
    const manualScore = 
      (parseFloat(p.grade_interview) || 0) +
      (parseFloat(p.grade_ogt) || 0) +
      (parseFloat(p.grade_consti_quiz) || 0) +
      (parseFloat(p.grade_buddy_tasks) || 0);

    const overallPercent = Math.min(100, Math.round(automatedScore + manualScore));
    const activeTimeIn = activeSessionMap.get(p.id) || null;
    const activeElapsedHrs = activeTimeIn ? (Date.now() - new Date(activeTimeIn).getTime()) / (1000 * 60 * 60) : 0;

    return {
      id: p.id,
      fullName: p.full_name,
      nickname: p.nickname,
      buddyGroup: p.buddy_group_name || 'Unassigned',
      completedSigs,
      totalSigs,
      tambayHours,
      overallPercent,
      isTimedIn: activeSessionMap.has(p.id),
      activeElapsedHrs,
      isStaleSession: activeElapsedHrs >= 8,
      gradeInterview: p.grade_interview || 0,
      gradeOgt: p.grade_ogt || 0,
      gradeConsti: p.grade_consti_quiz || 0,
      gradeBuddy: p.grade_buddy_tasks || 0
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

  if (error) {
    console.error('Tambay Adjust Error:', error.message);
    return false;
  }
  return true;
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
      .upsert([{
        user_id: userId,
        user_name: userName,
        time_slot: timeSlot
      }], { onConflict: 'user_id,time_slot' });
    return !error;
  }
}

export async function updateOfficialEventDate(eventId, dateIso) {
  if (!supabase || !eventId) return false;
  return await updateGlobalSettings(`event_date_${eventId}`, dateIso);
}

// Legacy/Admin compatibility exports for admin.js
export async function addSignatoryRequirement(role, task) {
  if (!supabase) return false;
  const uid = await getCurrentUserId();
  const { error } = await supabase.from('signatories').insert([{ user_id: uid, role, task, trait: task }]);
  return !error;
}

export async function createEvent(name, passkey) {
  if (!supabase) return false;
  const { error } = await supabase.from('events').insert([{ name, passkey, weight_percent: 5 }]);
  return !error;
}
