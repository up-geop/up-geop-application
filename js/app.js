import { CONFIG } from './config.js';
import {
  supabase,
  getSignatories,
  getTambayHours,
  getActiveTambaySession,
  generateApplicantShortCode,
  verifyUniversalCode,
  checkIfResidentMember,
  checkIfRAComm,
  getMemberProfile,
  getGlobalSettings,
  updateGlobalSettings,
  getAllApplicantsProgress,
  getApplicantFullDetails,
  deleteApplicantProfile,
  adminAdjustTambayHours,
  adminAdjustTokens,
  adminToggleApplicantSignatory,
  adminUpdateApplicantGrades,
  getBuddyGroupMembers,
  getManagedBuddyGroups,
  createBuddyGroup,
  deleteBuddyGroup,
  assignApplicantBuddyGroup,
  getAllMembersList,
  assignMemberBuddyGroup,
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  getAvailabilitySlots,
  toggleUserAvailabilitySlot,
  getUserTaskContributions,
  chipInToTask,
  withdrawFromTask,
  buyTambayMultiplierBoost,
  swapSignatoryTrait,
  getAvailableTraitsPool,
  getBuddyTasks,
  createBuddyTask,
  deleteBuddyTask,
  getApplicantBuddyTaskCompletions,
  toggleBuddyTaskCompletion,
  updateOfficialEventDate,
  createNotification,
  fetchAndClearNotifications,
  getUnreadNotificationCount
} from './storage.js';

import { renderSignatoriesTab } from './signatories.js';
import { getEvents, adminToggleEventAttendance, generateGoogleCalendarUrl } from './events.js';
import { signInWithGoogle, signOutUser, getCurrentUser, getUserProfileData, createApplicantProfile } from './auth.js';

let currentUser = null;
let timerInterval = null;
let inspectedApplicantId = null;
let currentMonday = getMonday(new Date());
let activeSwapMode = 'random';

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span><button style="background:none; border:none; font-size:1.1rem; color:inherit; cursor:pointer;">&times;</button>`;
  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function startTimer(timeIn) {
  if (timerInterval) clearInterval(timerInterval);
  const elem = document.getElementById('liveTimerDisplay');
  const start = new Date(timeIn).getTime();

  function update() {
    const diff = Date.now() - start;
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    const pad = n => String(n).padStart(2, '0');
    if (elem) elem.textContent = `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  }
  update();
  timerInterval = setInterval(update, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
}

function updateSettingsButtons(mult, capEnabled, sigLimitEnabled) {
  const btn1x = document.getElementById('set1xBtn');
  const btn2x = document.getElementById('set2xBtn');
  const btnEn = document.getElementById('enableCapBtn');
  const btnDis = document.getElementById('disableCapBtn');
  const btnSigEn = document.getElementById('enableSigLimitBtn');
  const btnSigDis = document.getElementById('disableSigLimitBtn');

  if (btn1x) btn1x.className = mult === 1.0 ? 'btn btn-checkin' : 'btn btn-secondary';
  if (btn2x) btn2x.className = mult === 2.0 ? 'btn btn-checkin' : 'btn btn-secondary';
  
  if (btnEn) btnEn.className = capEnabled ? 'btn btn-checkin' : 'btn btn-secondary';
  if (btnDis) btnDis.className = !capEnabled ? 'btn btn-checkin' : 'btn btn-secondary';

  if (btnSigEn) btnSigEn.className = sigLimitEnabled ? 'btn btn-checkin' : 'btn btn-secondary';
  if (btnSigDis) btnSigDis.className = !sigLimitEnabled ? 'btn btn-checkin' : 'btn btn-secondary';
}

function computeEffectiveDeadline(rawIso, isPotUnlocked) {
  const baseDate = new Date(rawIso);
  if (isPotUnlocked) {
    baseDate.setTime(baseDate.getTime() + (2 * 24 * 60 * 60 * 1000));
  }
  return baseDate;
}

async function renderShopView() {
  const container = document.getElementById('dynamicPotsContainer');
  if (!container || !currentUser) return;

  const [tasks, contributions, profile] = await Promise.all([
    getBuddyTasks(),
    getUserTaskContributions(),
    getUserProfileData(currentUser.id)
  ]);

  const currPot = document.getElementById('userCurrencyTextPot');
  if (currPot) currPot.textContent = profile?.currency ?? 0;

  if (tasks.length === 0) {
    container.innerHTML = '<p class="subtext">No active buddy tasks to extend right now.</p>';
    return;
  }

  container.innerHTML = tasks.map(t => {
    const current = t.pot_current || 0;
    const target = t.pot_target || 200;
    const isUnlocked = t.is_extended;
    const percent = Math.min(100, Math.round((current / target) * 100));
    
    const userContrib = contributions.find(c => c.task_id === t.id)?.amount || 0;

    return `
      <div style="background: var(--surface); border: 1px solid var(--border-subtle); padding: 14px; border-radius: var(--radius-sm);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="color: var(--brand-forest); font-size: 0.95rem;">${t.title}</strong>
          <span class="badge" style="background: ${isUnlocked ? 'var(--brand-mint)' : 'var(--surface-subtle)'}; color: ${isUnlocked ? '#fff' : 'inherit'};">
            ${current} / ${target} AC (${percent}%)
          </span>
        </div>

        <div style="background: #e5ded0; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 12px; border: 1px solid var(--border-medium);">
          <div style="background: ${isUnlocked ? 'var(--brand-mint)' : 'var(--brand-clay)'}; height: 100%; width: ${percent}%; transition: width 0.3s ease;"></div>
        </div>

        ${isUnlocked ? `
          <div style="color: var(--brand-forest); font-weight: 700; font-size: 0.85rem;">🎉 Goal Met! +2 Days Extension Unlocked!</div>
        ` : `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="chipInAmt-${t.id}" min="5" step="5" placeholder="Amt" style="width: 70px; padding: 4px; font-size: 0.8rem;" />
              <button class="btn btn-checkin chip-in-btn" data-task-id="${t.id}" style="min-height: 28px; padding: 4px 10px; font-size: 0.75rem;">Chip In</button>
            </div>
            
            ${userContrib > 0 ? `
              <div style="display: flex; gap: 8px; align-items: center;">
                <span style="font-size: 0.75rem; color: var(--brand-clay-deep);">You put in: <strong>${userContrib} AC</strong></span>
                <input type="number" id="withdrawAmt-${t.id}" min="5" max="${userContrib}" step="5" placeholder="Amt" style="width: 70px; padding: 4px; font-size: 0.8rem;" />
                <button class="btn btn-secondary withdraw-btn" data-task-id="${t.id}" style="min-height: 28px; padding: 4px 10px; font-size: 0.75rem;">Withdraw</button>
              </div>
            ` : ''}
          </div>
        `}
      </div>
    `;
  }).join('');
}

async function renderApplicantBuddyTasks(userGroup) {
  const container = document.getElementById('applicantOverviewBuddyTasks');
  const badge = document.getElementById('buddyTaskSummaryBadge');
  if (!container || !currentUser) return;

  const [tasks, completions] = await Promise.all([
    getBuddyTasks(),
    getApplicantBuddyTaskCompletions(currentUser.id)
  ]);

  const completedTaskIds = new Set(completions.map(c => c.task_id));

  const relevantTasks = tasks.filter(t => 
    t.target_group === 'ALL' || (userGroup && t.target_group.toLowerCase() === userGroup.toLowerCase())
  );

  if (badge) {
    const doneCount = relevantTasks.filter(t => completedTaskIds.has(t.id)).length;
    badge.textContent = `${doneCount} / ${relevantTasks.length} Done`;
    badge.style.background = doneCount === relevantTasks.length && relevantTasks.length > 0 ? 'var(--brand-mint)' : 'var(--surface-subtle)';
    badge.style.color = doneCount === relevantTasks.length && relevantTasks.length > 0 ? '#fff' : 'inherit';
  }

  if (relevantTasks.length === 0) {
    container.innerHTML = '<p class="subtext">No buddy tasks assigned yet.</p>';
    return;
  }

  const now = new Date();

  container.innerHTML = relevantTasks.map(t => {
    const isDone = completedTaskIds.has(t.id);
    const isPotUnlocked = !!t.is_extended;
    const deadline = computeEffectiveDeadline(t.deadline, isPotUnlocked);
    const isOverdue = !isDone && now > deadline;

    return `
      <div class="card" style="margin: 0; padding: 12px 14px; border-left: 4px solid ${isDone ? 'var(--brand-mint)' : (isOverdue ? '#9e2a2b' : 'var(--brand-clay)')}; background: ${isDone ? 'var(--brand-mint-subtle)' : 'var(--surface-subtle)'};">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <div>
            <span class="badge" style="font-size: 0.72rem; margin-bottom: 4px;">Target: ${t.target_group}</span>
            <strong style="font-size: 0.95rem; color: var(--text-heading); display: block;">${t.title}</strong>
            ${t.description ? `<p style="font-size: 0.82rem; color: var(--text-body); margin: 4px 0;">${t.description}</p>` : ''}
          </div>
          <span class="badge" style="background: ${isDone ? 'var(--brand-mint)' : (isOverdue ? '#9e2a2b' : 'var(--brand-clay)')}; color: #fff;">
            ${isDone ? 'Finished' : (isOverdue ? 'Overdue' : 'Pending')}
          </span>
        </div>

        <div style="margin-top: 8px; font-size: 0.78rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px;">
          <span style="color: ${isOverdue ? '#9e2a2b' : 'var(--text-muted)'}; font-weight: ${isOverdue ? '700' : 'normal'};">
            📅 Deadline: <strong>${deadline.toLocaleDateString()} ${deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
            ${isPotUnlocked ? '<span style="color: var(--brand-forest); font-weight: 700; margin-left: 4px;">(+2 Days Shop Boost Active)</span>' : ''}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

async function renderOfficerBuddyTasksManager() {
  const container = document.getElementById('racommBuddyTasksList');
  const groupSelect = document.getElementById('buddyTaskTargetGroupSelect');
  if (!container) return;

  const [tasks, groups] = await Promise.all([
    getBuddyTasks(),
    getManagedBuddyGroups()
  ]);

  const isRAComm = await checkIfRAComm(currentUser?.email);
  let memberGroup = null;
  
  if (!isRAComm && currentUser) {
     const memberProfile = await getMemberProfile(currentUser.email);
     memberGroup = memberProfile?.buddy_group_name;
  }

  if (groupSelect) {
    groupSelect.innerHTML = `
      <option value="ALL">All Applicants (Universal)</option>
      ${groups.map(g => `<option value="${g.name}">${g.name}</option>`).join('')}
    `;
  }

  let relevantTasks = tasks;
  if (!isRAComm) {
    relevantTasks = tasks.filter(t => 
      t.target_group === 'ALL' || 
      (memberGroup && t.target_group.toLowerCase() === memberGroup.toLowerCase())
    );
  }

  if (relevantTasks.length === 0) {
    container.innerHTML = '<p class="subtext">No buddy tasks assigned to your group yet.</p>';
    return;
  }

  container.innerHTML = relevantTasks.map(t => {
    const isPotUnlocked = !!t.is_extended;
    const deadline = computeEffectiveDeadline(t.deadline, isPotUnlocked);

    return `
      <div class="card" style="margin: 0; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span class="badge" style="margin-bottom: 2px;">${t.target_group}</span>
          <strong style="display: block; font-size: 0.95rem; color: var(--brand-forest);">${t.title}</strong>
          <small class="subtext" style="display: block;">${t.description || 'No description'}</small>
          <small style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; display: block;">
            Base: ${new Date(t.deadline).toLocaleDateString()} ${new Date(t.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            ${isPotUnlocked ? ` | <strong style="color: var(--brand-clay);">Effective (+2d): ${deadline.toLocaleDateString()}</strong>` : ''}
          </small>
        </div>
        ${isRAComm ? `
        <button class="btn btn-secondary delete-buddy-task-btn" data-id="${t.id}" style="min-height: 30px; padding: 2px 8px; font-size: 0.75rem; color: #9e2a2b;">
          Delete
        </button>
        ` : ''}
      </div>
    `;
  }).join('');
}

async function renderAnnouncementsBoard() {
  const list = document.getElementById('announcementsList');
  const form = document.getElementById('racommAnnouncementForm');
  const badge = document.getElementById('racommPostBadge');
  if (!list || !currentUser) return;

  const isRAComm = await checkIfRAComm(currentUser.email);
  if (form) form.style.display = isRAComm ? 'block' : 'none';
  if (badge) badge.style.display = isRAComm ? 'inline-block' : 'none';

  const items = await getAnnouncements();
  if (items.length === 0) {
    list.innerHTML = '<p class="subtext">No announcements posted yet.</p>';
    return;
  }

  list.innerHTML = items.map(a => `
    <div class="card" style="margin: 0; padding: 14px; position: relative;">
      ${isRAComm ? `<button class="btn btn-secondary delete-ann-btn" data-id="${a.id}" style="position:absolute; top:10px; right:10px; min-height:30px; padding:2px 8px; font-size:0.75rem; color:#b33a2b;">Delete</button>` : ''}
      <h3 style="font-size: 1rem; color: var(--brand-forest); margin-bottom: 4px;">${a.title}</h3>
      <p style="font-size: 0.85rem; margin-bottom: 8px; white-space: pre-line;">${a.content}</p>
      <small style="color: var(--text-muted);">Posted by ${a.author_email} on ${new Date(a.created_at).toLocaleDateString()}</small>
    </div>
  `).join('');
}

async function renderWhen2Meet() {
  const tbody = document.getElementById('availabilityGridTbody');
  const header = document.getElementById('when2meetHeaderRow');
  const dateInput = document.getElementById('when2meetStartDateInput');
  if (!tbody || !currentUser) return;

  if (dateInput && !dateInput.value) dateInput.value = formatDate(currentMonday);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentMonday);
    d.setDate(currentMonday.getDate() + i);
    dates.push(d);
  }

  if (header) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    header.innerHTML = '<th>Time</th>' + dates.map((d, i) => `<th>${days[i]}<br/><small style="font-weight:normal;">${d.getMonth() + 1}/${d.getDate()}</small></th>`).join('');
  }

  const allSlots = await getAvailabilitySlots();
  const times = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'];
  
  const countMap = {};
  const mySlots = new Set();

  allSlots.forEach(s => {
    if (!countMap[s.time_slot]) countMap[s.time_slot] = [];
    countMap[s.time_slot].push(s.user_name || 'User');
    if (s.user_id === currentUser.id) {
      mySlots.add(s.time_slot);
    }
  });

  tbody.innerHTML = times.map(time => {
    let row = `<tr><td style="font-weight:600; background:var(--surface-subtle);">${time}</td>`;
    dates.forEach(d => {
      const key = `${formatDate(d)}-${time}`;
      const people = countMap[key] || [];
      const count = people.length;
      const isMine = mySlots.has(key);

      const bg = count > 0 ? `rgba(46, 125, 90, ${Math.min(0.2 + count * 0.2, 0.85)})` : 'transparent';
      const textColor = count >= 3 ? '#ffffff' : 'inherit';

      row += `
        <td class="w2m-cell" 
            data-slot="${key}" 
            data-mine="${isMine ? 'true' : 'false'}" 
            style="background-color: ${bg}; color: ${textColor}; cursor: pointer; text-align: center; padding: 6px; border: ${isMine ? '2px solid var(--brand-forest)' : '1px solid var(--border-subtle)'};" 
            title="${people.length > 0 ? people.join(', ') : 'No one available'}">
          <div style="font-size: 0.75rem; font-weight: ${isMine ? '700' : '500'};">
            ${count > 0 ? `${count} free` : '-'}
          </div>
        </td>
      `;
    });
    return row + '</tr>';
  }).join('');
}

async function renderBuddyGroupBoard() {
  const board = document.getElementById('buddyGroupsBoard');
  if (!board) return;

  const [groups, applicants, members] = await Promise.all([
    getManagedBuddyGroups(),
    getAllApplicantsProgress(),
    getAllMembersList()
  ]);

  const activeGroupNames = new Set(groups.map(g => g.name));
  const groupNames = ['Unassigned', ...groups.map(g => g.name)];

  board.innerHTML = groups.map(g => {
    const groupApplicants = applicants.filter(a => (a.buddyGroup || '').trim() === g.name);
    const groupMembers = members.filter(m => (m.buddy_group_name || '').trim() === g.name);

    return `
      <div class="card" style="margin: 0; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <h3 style="font-family: var(--font-display); color: var(--brand-forest);">${g.name}</h3>
            <button class="btn btn-secondary delete-group-btn" data-id="${g.id}" style="min-height: 28px; padding: 2px 6px; font-size: 0.72rem; color: #b33a2b;">Delete</button>
          </div>
          <small class="badge" style="margin-bottom: 12px;">${groupMembers.length} Members • ${groupApplicants.length} Applicants</small>

          <div style="margin-top: 10px;">
            <strong style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 4px;">Resident Members</strong>
            <ul class="task-list" style="margin-bottom: 12px;">
              ${groupMembers.map(m => `
                <li class="task-item" style="padding: 6px 10px; font-size: 0.8rem;">
                  <span>${m.full_name}</span>
                  <select class="reassign-member-select" data-id="${m.id}" style="min-height: 28px; font-size: 0.75rem; padding: 2px 4px;">
                    ${groupNames.map(name => `<option value="${name}" ${name === g.name ? 'selected' : ''}>${name}</option>`).join('')}
                  </select>
                </li>
              `).join('') || '<li class="subtext" style="font-size: 0.78rem;">No members assigned.</li>'}
            </ul>

            <strong style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 4px;">Applicants</strong>
            <ul class="task-list">
              ${groupApplicants.map(a => `
                <li class="task-item" style="padding: 6px 10px; font-size: 0.8rem;">
                  <span>${a.nickname ? `${a.nickname} (${a.fullName})` : a.fullName}</span>
                  <select class="reassign-applicant-select" data-id="${a.id}" style="min-height: 28px; font-size: 0.75rem; padding: 2px 4px;">
                    ${groupNames.map(name => `<option value="${name}" ${name === g.name ? 'selected' : ''}>${name}</option>`).join('')}
                  </select>
                </li>
              `).join('') || '<li class="subtext" style="font-size: 0.78rem;">No applicants assigned.</li>'}
            </ul>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const unassignedApplicants = applicants.filter(a => {
    const bg = (a.buddyGroup || '').trim();
    return !bg || bg.toLowerCase() === 'unassigned' || !activeGroupNames.has(bg);
  });

  const unassignedMembers = members.filter(m => {
    const bg = (m.buddy_group_name || '').trim();
    return !bg || bg.toLowerCase() === 'unassigned' || !activeGroupNames.has(bg);
  });

  board.innerHTML += `
    <div class="card" style="margin: 0; background: var(--surface-subtle); border-style: dashed;">
      <h3 style="font-family: var(--font-display); color: var(--brand-clay-deep);">Unassigned Pool</h3>
      <small class="badge" style="margin-bottom: 12px;">${unassignedMembers.length} Members • ${unassignedApplicants.length} Applicants</small>

      <div style="margin-top: 10px;">
        <strong style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 4px;">Unassigned Members</strong>
        <ul class="task-list" style="margin-bottom: 12px;">
          ${unassignedMembers.map(m => `
            <li class="task-item" style="padding: 6px 10px; font-size: 0.8rem;">
              <span>${m.full_name}</span>
              <select class="reassign-member-select" data-id="${m.id}" style="min-height: 28px; font-size: 0.75rem;">
                ${groupNames.map(name => `<option value="${name}" ${name === 'Unassigned' ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </li>
          `).join('') || '<li class="subtext" style="font-size: 0.78rem;">None</li>'}
        </ul>

        <strong style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 4px;">Unassigned Applicants</strong>
        <ul class="task-list">
          ${unassignedApplicants.map(a => `
            <li class="task-item" style="padding: 6px 10px; font-size: 0.8rem;">
              <span>${a.nickname ? `${a.nickname} (${a.fullName})` : a.fullName}</span>
              <select class="reassign-applicant-select" data-id="${a.id}" style="min-height: 28px; font-size: 0.75rem;">
                ${groupNames.map(name => `<option value="${name}" ${name === 'Unassigned' ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </li>
          `).join('') || '<li class="subtext" style="font-size: 0.78rem;">None</li>'}
        </ul>
      </div>
    </div>
  `;
}

async function renderOfficerEventSchedules() {
  const container = document.getElementById('racommEventScheduleManager');
  if (!container) return;
  
  const [events, settingsRes] = await Promise.all([
    getEvents(),
    supabase.from('global_settings').select('key, value').ilike('key', 'event_date_%')
  ]);

  const savedDates = {};
  if (settingsRes.data) {
    settingsRes.data.forEach(s => savedDates[s.key] = s.value);
  }

  container.innerHTML = events.map(e => {
    const savedIso = savedDates[`event_date_${e.id}`];
    
    // Format UTC time to local datetime-local format
    let localDateStr = '';
    if (savedIso) {
      const d = new Date(savedIso);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      localDateStr = d.toISOString().slice(0, 16);
    }
    
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap; gap: 8px;">
        <strong style="color: var(--brand-forest); font-size: 0.95rem;">${e.name}</strong>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="datetime-local" id="eventDate-${e.id}" value="${localDateStr}" style="padding: 4px 8px; font-size: 0.8rem;" />
          <button class="btn btn-secondary save-event-date-btn" data-id="${e.id}" style="min-height: 28px; padding: 4px 10px; font-size: 0.75rem;">Save</button>
        </div>
      </div>
    `;
  }).join('');
}

async function renderLeaderboard() {
  const container = document.getElementById('leaderboardContainer');
  const tambayList = document.getElementById('topTambayersList');
  if (!container && !tambayList) return;

  const [applicants, groups] = await Promise.all([
    getAllApplicantsProgress(),
    getManagedBuddyGroups()
  ]);

  if (container) {
      const groupStats = groups.map(g => {
        const members = applicants.filter(a => a.buddyGroup === g.name);
        const avg = members.length ? members.reduce((sum, a) => sum + a.overallPercent, 0) / members.length : 0;
        return { name: g.name, avg: Math.round(avg), count: members.length };
      }).sort((a, b) => b.avg - a.avg);

      container.innerHTML = groupStats.map((g, i) => `
        <div class="card" style="margin: 0; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${i === 0 ? '#FBB03B' : 'var(--brand-clay)'};">
          <div style="display: flex; align-items: center; gap: 12px;">
            <h2 style="color: ${i === 0 ? '#FBB03B' : 'var(--text-muted)'}; margin: 0;">#${i + 1}</h2>
            <div>
              <h3 style="margin-bottom: 2px;">${g.name}</h3>
              <small class="subtext">${g.count} Applicants</small>
            </div>
          </div>
          <h2 style="color: var(--brand-forest); margin: 0;">${g.avg}%</h2>
        </div>
      `).join('') || '<p class="subtext">No groups established yet.</p>';
  }

  if (tambayList) {
      const top5 = applicants
        .filter(a => a.tambayHours > 0)
        .sort((a, b) => b.tambayHours - a.tambayHours)
        .slice(0, 5);

      if (top5.length === 0) {
        tambayList.innerHTML = '<li class="subtext" style="padding: 10px 14px;">No tambay hours logged yet.</li>';
      } else {
        tambayList.innerHTML = top5.map((a, i) => `
          <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <strong style="font-size: 1.1rem; color: ${i === 0 ? '#FBB03B' : (i === 1 ? '#A8A9AD' : (i === 2 ? '#CD7F32' : 'var(--text-muted)'))};">#${i + 1}</strong>
              <div>
                <strong style="color: var(--text-heading); display: block;">${a.nickname ? `${a.nickname} (${a.fullName})` : a.fullName}</strong>
                <small style="color: var(--text-muted);">${a.buddyGroup}</small>
              </div>
            </div>
            <span class="badge" style="background: var(--brand-mint-subtle); color: var(--brand-forest); font-family: var(--font-mono); font-weight: 700; font-size: 0.85rem;">
              ${a.tambayHours.toFixed(1)} hrs
            </span>
          </li>
        `).join('');
      }
  }
}

async function renderDashboard() {
  const [signatories, tambayHours, events, profile] = await Promise.all([
    getSignatories(),
    getTambayHours(),
    getEvents(),
    getUserProfileData(currentUser.id)
  ]);

  const totalSigs = signatories.length || 21;
  const completedSigs = signatories.filter(s => s.completed).length;
  const sigRatio = totalSigs > 0 ? (completedSigs / totalSigs) : 0;

  const tambayRatio = Math.min(tambayHours / CONFIG.TARGET_TAMBAY_HOURS, 1);
  const attendedEvents = events.filter(e => e.attended).length;

  const eventPoints = attendedEvents * 5;
  const sigPoints = Number((sigRatio * 15).toFixed(2));
  const tambayPoints = Number((tambayRatio * 5).toFixed(2));
  const interviewPoints = parseFloat(profile?.grade_interview) || 0;
  const ogtPoints = parseFloat(profile?.grade_ogt) || 0;
  const constiPoints = parseFloat(profile?.grade_consti_quiz) || 0;
  const buddyTaskPoints = parseFloat(profile?.grade_buddy_tasks) || 0;

  const totalPercent = Math.min(
    100,
    Math.round(eventPoints + sigPoints + tambayPoints + interviewPoints + ogtPoints + constiPoints + buddyTaskPoints)
  );

  const bar = document.getElementById('progressBar');
  const barLabel = document.getElementById('progressBarLabel');
  if (bar) bar.style.width = `${totalPercent}%`;
  if (barLabel) barLabel.textContent = `${totalPercent}%`;

  const sigText = document.getElementById('overviewSigText');
  if (sigText) sigText.textContent = `${completedSigs}/${totalSigs}`;

  const tambayText = document.getElementById('overviewTambayText');
  if (tambayText) tambayText.textContent = tambayHours.toFixed(1);

  const tambayBadge = document.getElementById('tambayBadge');
  if (tambayBadge) tambayBadge.textContent = `${tambayHours.toFixed(1)} / ${CONFIG.TARGET_TAMBAY_HOURS} hrs (${tambayPoints}%)`;

  const eventBadge = document.getElementById('eventBadge');
  if (eventBadge) eventBadge.textContent = `${attendedEvents} / 5 Attended (${eventPoints}%)`;

  const activeSession = await getActiveTambaySession(currentUser.id);
  const activeBanner = document.getElementById('activeTambayBanner');
  if (activeSession && activeBanner) {
    activeBanner.style.display = 'block';
    startTimer(activeSession.time_in);
  } else if (activeBanner) {
    activeBanner.style.display = 'none';
    stopTimer();
  }

  const sigContainer = document.getElementById('signatoryList');
  if (sigContainer) await renderSignatoriesTab(sigContainer);

  const eventList = document.getElementById('eventList');
  if (eventList) {
    eventList.innerHTML = events.map(evt => `
      <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; margin-bottom: 8px;">
        <div>
          <strong style="color: var(--brand-forest); font-size: 0.95rem;">${evt.name}</strong>
          <div style="margin-top: 2px;">
            <small style="color: var(--text-muted);">Weight: 5.0% • Officer-verified</small>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <a href="${generateGoogleCalendarUrl(evt.name)}" target="_blank" class="btn btn-secondary" style="min-height: 32px; padding: 4px 8px; font-size: 0.75rem;">📅 Add to Calendar</a>
          <span class="badge" style="background: ${evt.attended ? 'var(--brand-mint)' : 'var(--surface-subtle)'}; color: ${evt.attended ? '#ffffff' : 'inherit'}; font-weight: 600;">
            ${evt.attended ? 'Attended (+5%)' : 'Pending'}
          </span>
        </div>
      </li>
    `).join('');
  }
}

async function renderRoster() {
  const tbody = document.getElementById('applicantRosterTbody');
  if (!tbody || !currentUser) return;

  let applicants = await getAllApplicantsProgress();
  const isRAComm = await checkIfRAComm(currentUser.email);

  if (!isRAComm) {
    const memberProfile = await getMemberProfile(currentUser.email);
    const memberGroup = memberProfile?.buddy_group_name;
    
    if (!memberGroup || memberGroup === 'Unassigned') {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:16px;">You are not assigned to a Buddy Group yet.</td></tr>';
      return;
    }
    
    applicants = applicants.filter(app => (app.buddyGroup || '').toLowerCase() === memberGroup.toLowerCase());
    
    if (applicants.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:16px;">No applicants in ${memberGroup} yet.</td></tr>`;
      return;
    }
  } else if (applicants.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:16px;">No applicants registered.</td></tr>';
    return;
  }

  tbody.innerHTML = applicants.map(app => `
    <tr>
      <td><strong>${app.fullName}</strong> ("${app.nickname}")</td>
      <td>${app.buddyGroup}</td>
      <td style="font-family:var(--font-mono);">${app.completedSigs} / ${app.totalSigs}</td>
      <td style="font-family:var(--font-mono);">${app.tambayHours} hrs</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:var(--brand-forest);">${app.overallPercent}%</td>
      <td><span class="badge" style="background:${app.isTimedIn ? 'var(--brand-mint-subtle)' : 'var(--surface-subtle)'}; color:${app.isTimedIn ? 'var(--brand-mint)' : 'inherit'};">${app.isTimedIn ? 'Timed In' : 'Offline'}</span></td>
      <td><button class="btn btn-secondary inspect-btn" data-id="${app.id}" style="min-height:32px; padding:2px 8px; font-size:0.75rem;">${isRAComm ? 'Inspect & Grade' : 'View Details'}</button></td>
    </tr>
  `).join('');
}

async function openInspection(appId) {
  inspectedApplicantId = appId;
  const modal = document.getElementById('adminInspectionModal');
  const [details, events, isRAComm] = await Promise.all([
    getApplicantFullDetails(appId),
    getEvents(appId),
    checkIfRAComm(currentUser.email)
  ]);

  if (!details || !modal) return;
  const p = details.profile;

  document.getElementById('inspectApplicantName').textContent = `${p.full_name} ("${p.nickname}")`;
  document.getElementById('inspectApplicantEmail').textContent = `ID: ${p.id} | Balance: ${p.currency ?? 0} AC`;

  const groups = await getManagedBuddyGroups();
  const select = document.getElementById('inspectBuddyGroupSelect');
  const saveGrpBtn = document.getElementById('saveAssignedGroupBtn');
  
  if (select) {
    select.innerHTML = `
      <option value="Unassigned" ${p.buddy_group_name === 'Unassigned' ? 'selected' : ''}>Unassigned</option>
      ${groups.map(g => `<option value="${g.name}" ${p.buddy_group_name === g.name ? 'selected' : ''}>${g.name}</option>`).join('')}
    `;
    select.disabled = !isRAComm;
  }
  if (saveGrpBtn) saveGrpBtn.style.display = isRAComm ? 'block' : 'none';

  const panelsWrapper = document.getElementById('inspectPanelsWrapper');
  if (panelsWrapper) {
    panelsWrapper.innerHTML = `
      <div style="padding: 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); width: 100%;">
        <h4 style="margin: 0 0 8px 0; color: var(--brand-forest); font-size: 0.88rem;">Official Events Attendance (5% each)</h4>
        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.82rem;">
          ${events.map(evt => `
            <label style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #fff; border-radius: 4px; border: 1px solid var(--border-subtle); cursor: ${isRAComm ? 'pointer' : 'not-allowed'};">
              <span style="font-size: 0.8rem;">${evt.name}</span>
              <input type="checkbox" class="admin-event-check" data-event-id="${evt.id}" ${evt.attended ? 'checked' : ''} ${!isRAComm ? 'disabled' : ''} />
            </label>
          `).join('')}
        </div>
      </div>

      <div style="padding: 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); width: 100%;">
        <h4 style="margin: 0 0 8px 0; color: var(--brand-forest); font-size: 0.88rem;">Evaluation Scores (Manual)</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.8rem;">
          <label style="display: flex; flex-direction: column; gap: 2px;">
            <span>Interview (15%):</span>
            <input type="number" id="gradeInterviewInput" min="0" max="15" step="0.5" value="${p.grade_interview || 0}" style="width: 100%; padding: 4px; font-size: 0.8rem;" ${!isRAComm ? 'disabled' : ''} />
          </label>
          <label style="display: flex; flex-direction: column; gap: 2px;">
            <span>OGT 1 & 2 (20%):</span>
            <input type="number" id="gradeOgtInput" min="0" max="20" step="0.5" value="${p.grade_ogt || 0}" style="width: 100%; padding: 4px; font-size: 0.8rem;" ${!isRAComm ? 'disabled' : ''} />
          </label>
          <label style="display: flex; flex-direction: column; gap: 2px;">
            <span>Consti (10%):</span>
            <input type="number" id="gradeConstiInput" min="0" max="10" step="0.5" value="${p.grade_consti_quiz || 0}" style="width: 100%; padding: 4px; font-size: 0.8rem;" ${!isRAComm ? 'disabled' : ''} />
          </label>
          <label style="display: flex; flex-direction: column; gap: 2px;">
            <span>Buddy (10%):</span>
            <input type="number" id="gradeBuddyInput" min="0" max="10" step="0.01" value="${p.grade_buddy_tasks || 0}" style="width: 100%; padding: 4px; font-size: 0.8rem;" ${!isRAComm ? 'disabled' : ''} />
          </label>
        </div>
        ${isRAComm ? `<button class="btn btn-checkin" id="saveManualGradesBtn" style="margin-top: 10px; width: 100%; min-height: 34px; font-size: 0.8rem;">Save Evaluation Scores</button>` : ''}
      </div>
    `;

    if (isRAComm) {
      panelsWrapper.querySelectorAll('.admin-event-check').forEach(chk => {
        chk.addEventListener('change', async (e) => {
          const eventId = e.target.dataset.eventId;
          const checked = e.target.checked;
          const success = await adminToggleEventAttendance(inspectedApplicantId, eventId, checked, currentUser.email);
          if (success) {
            showToast(`Attendance ${checked ? 'credited (+5%)' : 'removed'}.`, 'success');
            await renderRoster();
          } else {
            showToast('Failed to update attendance.', 'error');
            e.target.checked = !checked;
          }
        });
      });

      document.getElementById('saveManualGradesBtn')?.addEventListener('click', async () => {
        const grades = {
          interview: document.getElementById('gradeInterviewInput').value,
          ogt: document.getElementById('gradeOgtInput').value,
          constiQuiz: document.getElementById('gradeConstiInput').value,
          buddyTasks: document.getElementById('gradeBuddyInput').value
        };
        if (await adminUpdateApplicantGrades(inspectedApplicantId, grades)) {
          showToast('Evaluation scores saved.', 'success');
          await renderRoster();
        } else {
          showToast('Failed to save scores.', 'error');
        }
      });
    }
  }

  const sigList = document.getElementById('inspectSignatoriesList');
  if (sigList) {
    sigList.innerHTML = (details.signatories || []).map(s => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--border-subtle); font-size:0.8rem;">
        <span><strong>${s.trait || s.task}</strong> <small style="color:var(--text-muted);">(${s.committee_name || 'Member'})</small></span>
        <input type="checkbox" class="admin-sig-check" data-id="${s.id}" ${s.completed ? 'checked' : ''} ${!isRAComm ? 'disabled' : ''} />
      </div>
    `).join('');
  }

  const logList = document.getElementById('inspectTambayLogsList');
  if (logList) {
    logList.innerHTML = (details.tambayLogs || []).map(l => `
      <div style="font-size:0.78rem; padding:2px 0;">+${l.hours} hrs on ${new Date(l.created_at).toLocaleString()}</div>
    `).join('') || '<small class="subtext">No logs recorded.</small>';
  }

  const actionsBar = document.getElementById('adminInspectionActionsBar');
  if (actionsBar) {
    actionsBar.style.display = isRAComm ? 'flex' : 'none';
  }

  modal.style.display = 'flex';
}

async function getFilteredAvailableTraits(targetSigId) {
  const [sigs, fullPool] = await Promise.all([
    getSignatories(currentUser.id),
    getAvailableTraitsPool()
  ]);

  const usedTraits = new Set(
    sigs
      .filter(s => s.id !== targetSigId)
      .map(s => (s.trait || s.task || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const targetSig = sigs.find(s => s.id === targetSigId);
  if (targetSig) {
    usedTraits.add((targetSig.trait || targetSig.task || '').trim().toLowerCase());
  }

  return fullPool.filter(trait => !usedTraits.has(trait.trim().toLowerCase()));
}

async function updateSwapOptions() {
  const sigId = document.getElementById('swapTargetSigSelect')?.value;
  const newTraitSelect = document.getElementById('swapNewTraitSelect');
  if (!sigId || !newTraitSelect || activeSwapMode !== 'specific') return;

  const availableTraits = await getFilteredAvailableTraits(sigId);

  if (availableTraits.length === 0) {
    newTraitSelect.innerHTML = '<option value="">-- No other unique traits available --</option>';
  } else {
    newTraitSelect.innerHTML = availableTraits.map(t => `<option value="${t}">${t}</option>`).join('');
  }
}

async function openSwapModal(mode) {
  activeSwapMode = mode;
  const modal = document.getElementById('swapTraitModal');
  const title = document.getElementById('swapModalTitle');
  const subtext = document.getElementById('swapModalSubtext');
  const specificBox = document.getElementById('specificTraitContainer');
  const sigSelect = document.getElementById('swapTargetSigSelect');

  const sigs = await getSignatories(currentUser.id);
  const eligibleSigs = sigs.filter(s => !s.completed && s.role !== 'VP' && s.role !== 'PES');

  if (eligibleSigs.length === 0) {
    showToast('No eligible pending signatory traits available to swap.', 'info');
    return;
  }

  if (sigSelect) {
    sigSelect.innerHTML = eligibleSigs.map(s => `
      <option value="${s.id}">${s.trait || s.task || 'Member Trait'} (${s.committee_name || 'Member'})</option>
    `).join('');
  }

  if (mode === 'specific') {
    title.textContent = 'Specific Trait Selection (50 AC)';
    subtext.textContent = 'Select your signatory and pick a new unique trait:';
    specificBox.style.display = 'block';
    await updateSwapOptions();
  } else {
    title.textContent = 'Random Trait Swap (30 AC)';
    subtext.textContent = 'Select your signatory to roll a new unique trait:';
    specificBox.style.display = 'none';
  }

  modal.style.display = 'flex';
}

async function handleAuth() {
  currentUser = await getCurrentUser();

  const authSec = document.getElementById('authSection');
  const onboardSec = document.getElementById('onboardingSection');
  const appDash = document.getElementById('applicantDashboardContent');
  const memDash = document.getElementById('memberDashboardContent');
  const bar = document.getElementById('userProfileBar');
  const emailText = document.getElementById('userEmailText');
  const badge = document.getElementById('roleBadgeHeader');

  if (currentUser) {
    if (authSec) authSec.style.display = 'none';
    if (bar) bar.style.display = 'flex';
    if (emailText) emailText.textContent = currentUser.email;

    const unreadCount = await getUnreadNotificationCount(currentUser.id);
    const notifBadge = document.getElementById('notifBadge');
    if (notifBadge) {
      if (unreadCount > 0) {
        notifBadge.style.display = 'block';
        notifBadge.textContent = unreadCount;
      } else {
        notifBadge.style.display = 'none';
        notifBadge.textContent = '0';
      }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('verifyCode') || urlParams.get('validateApplicant');
    if (code) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const res = await verifyUniversalCode(code, currentUser.email);
      showToast(res.message, res.success ? 'success' : 'error');
    }

    const isMember = await checkIfResidentMember(currentUser.email);
    const isRAComm = await checkIfRAComm(currentUser.email);

    if (isMember || isRAComm) {
      if (badge) badge.textContent = isRAComm ? 'RAComm Officer' : 'Resident Member';
      if (onboardSec) onboardSec.style.display = 'none';
      if (appDash) appDash.style.display = 'none';
      if (memDash) memDash.style.display = 'block';

      const racommTabs = document.querySelectorAll('.racomm-only-tab');
      racommTabs.forEach(tab => {
        tab.style.display = isRAComm ? 'inline-block' : 'none';
      });

      const officerTaskControls = document.getElementById('officerBuddyTaskControls');
      if (officerTaskControls) officerTaskControls.style.display = isRAComm ? 'block' : 'none';

      if (isRAComm) {
        const settings = await getGlobalSettings();
        const multText = document.getElementById('currentMultiplierText');
        const capText = document.getElementById('currentCapText');
        const sigLimitText = document.getElementById('currentSigLimitText');

        if (multText) multText.textContent = `${settings.multiplier}x`;
        if (capText) capText.textContent = settings.dailyCapEnabled ? 'Active' : 'Disabled';
        if (sigLimitText) sigLimitText.textContent = settings.memberSigLimitEnabled ? 'Active' : 'Disabled';

        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);

        await renderBuddyGroupBoard();
        await renderOfficerEventSchedules();
      } else {
        document.querySelectorAll('#racommTabNav .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tab="member-hub-view"]')?.classList.add('active');

        // Universally reset all tabs so shared tabs don't show
        document.querySelectorAll('.tab-content').forEach(c => {
          c.style.display = 'none';
          c.classList.remove('active');
        });
        const hub = document.getElementById('member-hub-view');
        if (hub) {
          hub.style.display = 'block';
          hub.classList.add('active');
        }
      }
      
      await renderRoster();
      await renderOfficerBuddyTasksManager();
      await renderLeaderboard();

    } else {
      if (badge) badge.textContent = 'Applicant';
      if (memDash) memDash.style.display = 'none';

      const profile = await getUserProfileData(currentUser.id);
      if (!profile) {
        if (onboardSec) onboardSec.style.display = 'block';
        if (appDash) appDash.style.display = 'none';
      } else {
        if (onboardSec) onboardSec.style.display = 'none';
        if (appDash) appDash.style.display = 'block';

        const greeting = document.getElementById('userGreetingHeading');
        const curr = document.getElementById('userCurrencyText');
        const currPot = document.getElementById('userCurrencyTextPot');
        const group = document.getElementById('buddyGroupName');
        const avatarImg = document.getElementById('userAvatarHero');

        const meta = currentUser.user_metadata || {};
        const identityMeta = currentUser.identities?.[0]?.identity_data || {};
        const googleAvatar = meta.avatar_url || meta.picture || identityMeta.avatar_url || identityMeta.picture;

        if (avatarImg) {
          avatarImg.referrerPolicy = 'no-referrer';
          avatarImg.src = googleAvatar || 'geop.png';
        }

        if (greeting) greeting.textContent = `Good day, ${profile.nickname || profile.full_name}!`;
        const bal = profile.currency ?? 0;
        if (curr) curr.textContent = bal;
        if (currPot) currPot.textContent = bal;
        if (group) group.textContent = profile.buddy_group_name || 'Unassigned';

        const buddies = await getBuddyGroupMembers(profile.buddy_group_name);
        const buddyList = document.getElementById('buddyList');
        const countBadge = document.getElementById('buddyCountBadge');

        if (countBadge) countBadge.textContent = `${buddies.length} Members`;
        if (buddyList) {
          buddyList.innerHTML = buddies.map(b => {
            const displayName = b.nickname ? `${b.nickname} (${b.full_name})` : b.full_name;
            const isMem = b.role === 'Member';

            return `
              <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
                <div><strong style="color: var(--text-heading);">${displayName}</strong></div>
                <span class="badge" style="background: ${isMem ? 'var(--brand-forest)' : 'var(--surface-subtle)'}; color: ${isMem ? '#ffffff' : 'inherit'};">
                  ${b.role}
                </span>
              </li>
            `;
          }).join('') || '<li class="subtext">No buddies assigned yet.</li>';
        }

        await renderDashboard();
        await renderApplicantBuddyTasks(profile.buddy_group_name);
        await renderShopView();
        await renderLeaderboard();
      }
    }
  } else {
    if (authSec) authSec.style.display = 'block';
    if (onboardSec) onboardSec.style.display = 'none';
    if (appDash) appDash.style.display = 'none';
    if (memDash) memDash.style.display = 'none';
    if (bar) bar.style.display = 'none';
  }
}

// Prevent attaching duplicate event listeners if the script is loaded twice
if (!window.__appInitialized) {
  window.__appInitialized = true;

  document.addEventListener('DOMContentLoaded', async () => {
    
    // --- Dark Mode Initialization ---
    const savedTheme = localStorage.getItem('geop_theme');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-mode');
      const darkToggle = document.getElementById('darkModeToggleBtn');
      if (darkToggle) darkToggle.textContent = '☀️';
    }

    document.getElementById('darkModeToggleBtn')?.addEventListener('click', (e) => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      localStorage.setItem('geop_theme', isDark ? 'dark' : 'light');
      e.target.textContent = isDark ? '☀️' : '🌙';
    });
    // --------------------------------

    await handleAuth();

    // Hunt down and destroy any lingering Service Workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) {
          registration.unregister();
        }
      });
    }

    // Strict Singleton check to ensure Realtime doesn't double-subscribe
    if (supabase && !window.hasRealtimeSubscribed) {
      window.hasRealtimeSubscribed = true;
      
      supabase.channel('app-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async () => {
          await renderRoster();
          await renderBuddyGroupBoard();
          await renderDashboard();
          await renderLeaderboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, async () => {
          await renderBuddyGroupBoard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signatories' }, async () => {
          showToast('Signatory matrix updated.', 'info');
          await renderDashboard();
          await renderLeaderboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_attendees' }, async () => {
          showToast('Event attendance updated.', 'info');
          await renderDashboard();
          await renderRoster();
          await renderLeaderboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'buddy_tasks' }, async () => {
          const profile = await getUserProfileData(currentUser?.id);
          await renderApplicantBuddyTasks(profile?.buddy_group_name);
          await renderOfficerBuddyTasksManager();
          await renderShopView();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_contributions' }, async () => {
          await renderShopView();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'buddy_task_completions' }, async () => {
          const profile = await getUserProfileData(currentUser?.id);
          await renderApplicantBuddyTasks(profile?.buddy_group_name);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, async () => {
          showToast('New announcement posted.', 'info');
          await renderAnnouncementsBoard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_slots' }, async () => {
          await renderWhen2Meet();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tambay_sessions' }, async () => {
          await renderDashboard();
          await renderRoster();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, async (payload) => {
          if (payload.new.user_id === currentUser?.id) {
            showToast(payload.new.message, 'info');
            const badge = document.getElementById('notifBadge');
            if (badge) {
                badge.style.display = 'block';
                badge.textContent = parseInt(badge.textContent || 0) + 1;
            }
          }
        })
        .subscribe();
    }

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      const target = document.getElementById(btn.dataset.copyTarget);
      const text = target?.textContent?.trim();
      if (!text || text === '------') return;

      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1400);
    });

    document.querySelectorAll('#racommTabNav .tab-btn, #applicantTabNav .tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tabId = btn.dataset.tab;
        if (!tabId) return;

        // Roster and Buddy Tasks are excluded from this block so regular members can access them
        if (tabId === 'racomm-buddy-groups' || tabId === 'racomm-settings') {
          const isOfficer = await checkIfRAComm(currentUser?.email);
          if (!isOfficer) {
            showToast('Access restricted to RAComm officers.', 'error');
            return;
          }
        }

        const parentNav = btn.closest('.tab-nav');
        if (parentNav) {
          parentNav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        }
        btn.classList.add('active');

        // UNIVERSAL HIDE FIX: This specifically targets all `.tab-content` divs on the page, 
        // including those placed entirely outside the dashboard div structures.
        document.querySelectorAll('.tab-content').forEach(c => {
          c.style.display = 'none';
          c.classList.remove('active');
        });

        const target = document.getElementById(tabId);
        if (target) {
          target.style.display = 'block';
          target.classList.add('active');

          if (tabId === 'tab-schedule') {
            await renderAnnouncementsBoard();
            await renderWhen2Meet();
          } else if (tabId === 'racomm-buddy-groups') {
            await renderBuddyGroupBoard();
          } else if (tabId === 'racomm-buddy-tasks') {
            await renderOfficerBuddyTasksManager();
          } else if (tabId === 'racomm-roster') {
            await renderRoster();
          } else if (tabId === 'tab-perks') {
            await renderShopView();
          } else if (tabId === 'tab-leaderboard') {
            await renderLeaderboard();
          }
        }
      });
    });

    const valModal = document.getElementById('manualCodeModal');
    document.getElementById('manualValidateBtn')?.addEventListener('click', () => {
      if (valModal) {
        valModal.style.display = 'flex';
        const inp = document.getElementById('manualCodeInput');
        if (inp) { inp.value = ''; inp.focus(); }
      }
    });

    document.getElementById('cancelManualCodeBtn')?.addEventListener('click', () => {
      if (valModal) valModal.style.display = 'none';
    });

    document.getElementById('submitManualCodeBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('manualCodeInput');
      const code = input?.value.trim();
      if (!code || code.length < 6) {
        showToast('Enter a valid 6-character code.', 'error');
        return;
      }
      const res = await verifyUniversalCode(code, currentUser.email);
      showToast(res.message, res.success ? 'success' : 'error');
      if (valModal) valModal.style.display = 'none';
      await handleAuth();
    });

    document.getElementById('showQrBtn')?.addEventListener('click', async () => {
      const container = document.getElementById('qrDisplayContainer');
      const canvas = document.getElementById('qrcodeCanvas');
      const text = document.getElementById('applicantShortCodeText');

      const activeSession = await getActiveTambaySession(currentUser.id);
      const isTimingOut = !!activeSession;

      const code = await generateApplicantShortCode(null, 'TAMBAY');
      if (text) text.textContent = code || 'ERROR';

      const verifyUrl = `${window.location.origin}${window.location.pathname}?verifyCode=${code}`;
      
      if (canvas) {
        canvas.innerHTML = `
          <div style="margin-bottom: 8px;">
            <span class="badge" style="background: ${isTimingOut ? '#b33a2b' : 'var(--brand-forest)'}; color: #ffffff;">
              ${isTimingOut ? 'Scan to TIME-OUT' : 'Scan to TIME-IN'}
            </span>
          </div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(verifyUrl)}" 
               alt="Tambay QR" width="160" height="160" style="border-radius: 6px;" />
        `;
      }

      if (container) container.style.display = 'block';
    });

    document.getElementById('closeQrBtn')?.addEventListener('click', () => {
      const container = document.getElementById('qrDisplayContainer');
      if (container) container.style.display = 'none';
    });

    /* Notification Bell Handler */
    document.getElementById('notificationBellBtn')?.addEventListener('click', async () => {
      if (!currentUser) return;
      
      // Fetch and clear the notifications from the database
      const notifs = await fetchAndClearNotifications(currentUser.id);
      
      // Reset the red badge to 0 and hide it
      const badge = document.getElementById('notifBadge');
      if (badge) {
          badge.style.display = 'none';
          badge.textContent = '0';
      }
      
      // Actually show the user what the notifications were!
      if (notifs && notifs.length > 0) {
          notifs.forEach((notif, index) => {
              // Add a slight stagger if there are multiple notifications so they stack nicely
              setTimeout(() => {
                  showToast(notif.message, 'info');
              }, index * 300); 
          });
      } else {
          showToast('No new notifications.', 'info');
      }
    });

    /* CSV Export Handler */
    document.getElementById('adminExportCsvBtn')?.addEventListener('click', async () => {
      const applicants = await getAllApplicantsProgress();
      let csv = "Name,Nickname,Buddy Group,Signatories,Tambay Hrs,Interview,OGT,Consti,Buddy Tasks,Total %\n";
      
      applicants.forEach(a => {
        csv += `"${a.fullName}","${a.nickname}","${a.buddyGroup}","='${a.completedSigs}/${a.totalSigs}'",${a.tambayHours},${a.gradeInterview},${a.gradeOgt},${a.gradeConsti},${a.gradeBuddy},${a.overallPercent}%\n`;
      });

      const link = document.createElement("a");
      link.href = encodeURI("data:text/csv;charset=utf-8," + csv);
      link.download = `GEOP_Roster_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    document.getElementById('refreshLeaderboardBtn')?.addEventListener('click', async () => {
      await renderLeaderboard();
      showToast('Leaderboard refreshed', 'info');
    });

    /* Shop Handlers */
    document.getElementById('dynamicPotsContainer')?.addEventListener('click', async (e) => {
      if (e.target.classList.contains('chip-in-btn')) {
        const taskId = e.target.dataset.taskId;
        const input = document.getElementById(`chipInAmt-${taskId}`);
        const amount = parseInt(input?.value, 10);
        if (!amount || amount <= 0) return;

        const res = await chipInToTask(taskId, amount);
        showToast(res.message, res.success ? 'success' : 'error');
        if (res.success) {
          await handleAuth();
          await renderShopView();
        }
      }

      if (e.target.classList.contains('withdraw-btn')) {
        const taskId = e.target.dataset.taskId;
        const input = document.getElementById(`withdrawAmt-${taskId}`);
        const amount = parseInt(input?.value, 10);
        if (!amount || amount <= 0) return;

        const res = await withdrawFromTask(taskId, amount);
        showToast(res.message, res.success ? 'success' : 'error');
        if (res.success) {
          await handleAuth();
          await renderShopView();
        }
      }
    });

    document.getElementById('buyTambayBoostBtn')?.addEventListener('click', async () => {
      const res = await buyTambayMultiplierBoost();
      showToast(res.message, res.success ? 'success' : 'error');
      if (res.success) await handleAuth();
    });

    document.getElementById('swapTargetSigSelect')?.addEventListener('change', async () => {
      await updateSwapOptions();
    });

    document.getElementById('openRandomSwapModalBtn')?.addEventListener('click', () => openSwapModal('random'));
    document.getElementById('openSpecificSwapModalBtn')?.addEventListener('click', () => openSwapModal('specific'));
    document.getElementById('cancelSwapBtn')?.addEventListener('click', () => {
      document.getElementById('swapTraitModal').style.display = 'none';
    });

    document.getElementById('confirmSwapBtn')?.addEventListener('click', async () => {
      const sigId = document.getElementById('swapTargetSigSelect')?.value;
      if (!sigId) return;

      const availableTraits = await getFilteredAvailableTraits(sigId);

      if (availableTraits.length === 0) {
        showToast('All available traits from the pool are already assigned to you!', 'error');
        return;
      }

      const cost = activeSwapMode === 'specific' ? 50 : 30;
      let chosenTrait = '';

      if (activeSwapMode === 'specific') {
        chosenTrait = document.getElementById('swapNewTraitSelect')?.value;
        if (!chosenTrait) {
          showToast('Please select a valid trait.', 'error');
          return;
        }
      } else {
        chosenTrait = availableTraits[Math.floor(Math.random() * availableTraits.length)];
      }

      const ok = await swapSignatoryTrait(sigId, chosenTrait, cost);
      if (ok) {
        showToast(`Signatory trait updated to: "${chosenTrait}"`, 'success');
        document.getElementById('swapTraitModal').style.display = 'none';
        await handleAuth();
        await renderDashboard();
      } else {
        showToast('Insufficient AC balance or failed to swap trait.', 'error');
      }
    });

    /* Buddy Tasks Management Handlers */
    document.getElementById('createBuddyTaskForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('buddyTaskTitleInput')?.value.trim();
      const desc = document.getElementById('buddyTaskDescInput')?.value.trim();
      const targetGroup = document.getElementById('buddyTaskTargetGroupSelect')?.value;
      const deadlineVal = document.getElementById('buddyTaskDeadlineInput')?.value;

      if (!title || !deadlineVal) {
        showToast('Title and deadline are required.', 'error');
        return;
      }

      const isoDeadline = new Date(deadlineVal).toISOString();
      const ok = await createBuddyTask(title, desc, targetGroup, isoDeadline);

      if (ok) {
        showToast('Buddy task published successfully!', 'success');
        document.getElementById('buddyTaskTitleInput').value = '';
        document.getElementById('buddyTaskDescInput').value = '';
        document.getElementById('buddyTaskDeadlineInput').value = '';
        await renderOfficerBuddyTasksManager();
      } else {
        showToast('Failed to create task.', 'error');
      }
    });

    document.getElementById('racommBuddyTasksList')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.delete-buddy-task-btn');
      if (!btn) return;
      if (confirm('Delete this buddy task?')) {
        const ok = await deleteBuddyTask(btn.dataset.id);
        if (ok) {
          showToast('Task removed.', 'info');
          await renderOfficerBuddyTasksManager();
        }
      }
    });

    /* Global Settings Controls */
    document.getElementById('set1xBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('hourly_multiplier', '1.0')) {
        showToast('Multiplier set to 1.0x', 'info');
        const settings = await getGlobalSettings();
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('set2xBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('hourly_multiplier', '2.0')) {
        showToast('Multiplier set to 2.0x', 'success');
        const settings = await getGlobalSettings();
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('enableCapBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('daily_cap_enabled', 'true')) {
        showToast('Daily cap enabled', 'info');
        const settings = await getGlobalSettings();
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('disableCapBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('daily_cap_enabled', 'false')) {
        showToast('Daily cap removed', 'info');
        const settings = await getGlobalSettings();
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('enableSigLimitBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('member_sig_limit_enabled', 'true')) {
        showToast('Global 4-signature limit enabled', 'info');
        const settings = await getGlobalSettings();
        document.getElementById('currentSigLimitText').textContent = 'Active';
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('disableSigLimitBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('member_sig_limit_enabled', 'false')) {
        showToast('Global 4-signature limit disabled', 'info');
        const settings = await getGlobalSettings();
        document.getElementById('currentSigLimitText').textContent = 'Disabled';
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    /* Save Event Dates Handler */
    document.getElementById('racommEventScheduleManager')?.addEventListener('click', async (e) => {
      if (e.target.classList.contains('save-event-date-btn')) {
        const eventId = e.target.dataset.id;
        const input = document.getElementById(`eventDate-${eventId}`);
        
        if (!input.value) {
          return showToast('Please select a valid date and time.', 'error');
        }

        const isoDate = new Date(input.value).toISOString();
        const ok = await updateOfficialEventDate(eventId, isoDate);
        
        if (ok) {
          showToast('Event schedule updated!', 'success');
          await renderOfficerEventSchedules();
        } else {
          showToast('Failed to update event schedule.', 'error');
        }
      }
    });

    document.getElementById('refreshBuddyGroupsBtn')?.addEventListener('click', async () => {
      await renderBuddyGroupBoard();
      showToast('Buddy groups refreshed.', 'info');
    });

    document.getElementById('createGroupDashboardBtn')?.addEventListener('click', async () => {
      const input = document.getElementById('newGroupNameInputDashboard');
      const name = input?.value.trim();
      if (!name) return;
      if (await createBuddyGroup(name)) {
        input.value = '';
        showToast(`Group "${name}" created.`, 'success');
        await renderBuddyGroupBoard();
      }
    });

    document.getElementById('buddyGroupsBoard')?.addEventListener('click', async (e) => {
      if (e.target.classList.contains('delete-group-btn')) {
        if (confirm('Delete this buddy group?')) {
          if (await deleteBuddyGroup(e.target.dataset.id)) {
            showToast('Group deleted.', 'info');
            await renderBuddyGroupBoard();
          }
        }
      }
    });

    document.getElementById('buddyGroupsBoard')?.addEventListener('change', async (e) => {
      if (e.target.classList.contains('reassign-applicant-select')) {
        const applicantId = e.target.dataset.id;
        const newGroup = e.target.value;
        if (await assignApplicantBuddyGroup(applicantId, newGroup)) {
          showToast(`Applicant assigned to ${newGroup}`, 'success');
          await renderBuddyGroupBoard();
          await renderRoster();
        }
      }

      if (e.target.classList.contains('reassign-member-select')) {
        const memberId = e.target.dataset.id;
        const newGroup = e.target.value;
        if (await assignMemberBuddyGroup(memberId, newGroup)) {
          showToast(`Member assigned to ${newGroup}`, 'success');
          await renderBuddyGroupBoard();
        }
      }
    });

    document.getElementById('saveAssignedGroupBtn')?.addEventListener('click', async () => {
      const select = document.getElementById('inspectBuddyGroupSelect');
      const groupName = select?.value;
      if (inspectedApplicantId && groupName) {
        if (await assignApplicantBuddyGroup(inspectedApplicantId, groupName)) {
          showToast(`Assigned to ${groupName}!`, 'success');
          await renderRoster();
          await renderBuddyGroupBoard();
        }
      }
    });

    document.getElementById('postAnnouncementBtn')?.addEventListener('click', async () => {
      const titleIn = document.getElementById('announcementTitleInput');
      const contentIn = document.getElementById('announcementContentInput');
      if (!titleIn?.value.trim() || !contentIn?.value.trim()) return;

      if (await createAnnouncement(titleIn.value.trim(), contentIn.value.trim(), currentUser.email, null)) {
        titleIn.value = '';
        contentIn.value = '';
        showToast('Announcement posted.', 'success');
        await renderAnnouncementsBoard();
      }
    });

    document.getElementById('announcementsList')?.addEventListener('click', async (e) => {
      if (e.target.classList.contains('delete-ann-btn')) {
        if (confirm('Delete this announcement?')) {
          if (await deleteAnnouncement(e.target.dataset.id)) {
            showToast('Announcement removed.', 'info');
            await renderAnnouncementsBoard();
          }
        }
      }
    });

    document.getElementById('when2meetStartDateInput')?.addEventListener('change', async (e) => {
      if (e.target.value) {
        currentMonday = getMonday(new Date(e.target.value));
        await renderWhen2Meet();
      }
    });

    document.getElementById('availabilityGridTbody')?.addEventListener('click', async (e) => {
      const cell = e.target.closest('.w2m-cell');
      if (!cell || !currentUser) return;

      const slot = cell.dataset.slot;
      const isMine = cell.dataset.mine === 'true';

      const profile = await getUserProfileData(currentUser.id);
      const displayName = profile?.nickname || profile?.full_name || currentUser.email.split('@')[0];

      const ok = await toggleUserAvailabilitySlot(currentUser.id, displayName, slot, isMine);
      if (!ok) {
        showToast('Could not update slot. Please check your connection.', 'error');
      }
      await renderWhen2Meet();
    });

    document.getElementById('searchApplicantInput')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#applicantRosterTbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
      });
    });

    document.getElementById('applicantRosterTbody')?.addEventListener('click', async (e) => {
      if (e.target.classList.contains('inspect-btn')) {
        await openInspection(e.target.dataset.id);
      }
    });

    document.getElementById('closeInspectModalBtn')?.addEventListener('click', () => {
      const m = document.getElementById('adminInspectionModal');
      if (m) m.style.display = 'none';
    });

    document.getElementById('adminAddHoursBtn')?.addEventListener('click', async () => {
      const val = prompt('Enter hours to credit (+/-):');
      if (val && !isNaN(val)) {
        await adminAdjustTambayHours(inspectedApplicantId, parseFloat(val));
        showToast('Hours adjusted.', 'success');
        await openInspection(inspectedApplicantId);
        await renderRoster();
      }
    });

    document.getElementById('adminEditTokensBtn')?.addEventListener('click', async () => {
      const val = prompt('Enter new token balance:');
      if (val && !isNaN(val)) {
        await adminAdjustTokens(inspectedApplicantId, parseInt(val, 10));
        showToast('Balance updated.', 'success');
        await openInspection(inspectedApplicantId);
      }
    });

    document.getElementById('inspectSignatoriesList')?.addEventListener('change', async (e) => {
      if (e.target.classList.contains('admin-sig-check')) {
        await adminToggleApplicantSignatory(e.target.dataset.id, e.target.checked);
        showToast('Signatory status updated.', 'success');
        await renderRoster();
      }
    });

    document.getElementById('adminDeleteApplicantBtn')?.addEventListener('click', async () => {
      if (inspectedApplicantId && confirm('Delete this applicant profile? This action is permanent.')) {
        const success = await deleteApplicantProfile(inspectedApplicantId);
        if (success) {
          document.getElementById('adminInspectionModal').style.display = 'none';
          showToast('Profile deleted successfully.', 'info');
          await renderRoster();
          await renderBuddyGroupBoard();
        } else {
          showToast('Failed to delete applicant profile.', 'error');
        }
      }
    });

    document.getElementById('adminExportPdfBtn')?.addEventListener('click', async () => {
      // 1. Open the tab IMMEDIATELY before awaiting anything to bypass popup blockers
      const win = window.open('', '_blank');
      if (!win) {
        showToast('Popup blocked! Please allow popups for this site.', 'error');
        return;
      }
      
      win.document.write('<h3 style="font-family: sans-serif; color: #1b382b;">Loading report...</h3>');

      // 2. Fetch the data
      const details = await getApplicantFullDetails(inspectedApplicantId);
      if (!details) {
        win.close();
        return;
      }
      
      const p = details.profile;
      
      // 3. Overwrite the loading text with the real data
      win.document.open();
      win.document.write(`
        <html>
          <head>
            <title>Applicant Report - ${p.full_name}</title>
            <style>
              body { font-family: sans-serif; padding: 24px; color: #2a2016; }
              h2 { color: #C1272D; border-bottom: 2px solid #FBB03B; padding-bottom: 6px; }
              table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 0.85rem; }
              th, td { border: 1px solid #DCD4C5; padding: 8px; text-align: left; }
              th { background: #EBE5DA; }
            </style>
          </head>
          <body>
            <h2>UP GEOP Applicant Summary</h2>
            <p><strong>Full Name:</strong> ${p.full_name} (${p.nickname})</p>
            <p><strong>Buddy Family:</strong> ${p.buddy_group_name}</p>
            <p><strong>Evaluation Grades:</strong> Interview: ${p.grade_interview || 0}/15 | OGT: ${p.grade_ogt || 0}/20 | Consti: ${p.grade_consti_quiz || 0}/10 | Buddy: ${p.grade_buddy_tasks || 0}/10</p>
            <h3>Signatories</h3>
            <table>
              <thead><tr><th>Committee</th><th>Assigned Trait Requirement</th><th>Status</th><th>Signed By</th></tr></thead>
              <tbody>
                ${(details.signatories || []).map(s => `
                  <tr><td>${s.committee_name}</td><td>${s.trait || s.task}</td><td>${s.completed ? 'Completed' : 'Pending'}</td><td>${s.signed_by || '-'}</td></tr>
                `).join('')}
              </tbody>
            </table>
            <script>window.onload = function() { window.print(); }<\/script>
          </body>
        </html>
      `);
      win.document.close();
    });

    document.getElementById('onboardingForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('onboardFullName')?.value.trim();
      const nick = document.getElementById('onboardNickname')?.value.trim();
      if (await createApplicantProfile(currentUser.id, name, nick)) {
        showToast('Profile initialized.', 'success');
        await handleAuth();
      }
    });

    document.getElementById('loginGoogleBtn')?.addEventListener('click', signInWithGoogle);
    document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);
  });
}
