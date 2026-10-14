import { CONFIG } from './config.js';
import {
  supabase,
  getSignatories,
  getTambayHours,
  getApplicantTambayLogHistory,
  getActiveTambaySession,
  getAllActiveTambaySessions,
  adminForceCloseTambaySession,
  generateApplicantShortCode,
  getVerificationCodePreview,
  verifyUniversalCode,
  checkIfResidentMember,
  checkIfRAComm,
  getMemberProfile,
  getMemberPersonalActivityLog,
  getMostApproachedMembersLeaderboard,
  getGlobalSettings,
  updateGlobalSettings,
  getAllApplicantsProgress,
  getApplicantFullDetails,
  deleteApplicantProfile,
  adminAdjustTambayHours,
  adminAdjustTokens,
  adminToggleApplicantSignatory,
  adminUpdateApplicantGrades,
  getEventAttendeeUserIds,
  adminBulkSetEventAttendance,
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
let qrCountdownInterval = null;
let lastGeneratedQrMeta = { type: 'TAMBAY', targetId: null };
let inspectedApplicantId = null;
let currentMonday = getMonday(new Date());
let activeSwapMode = 'random';
let surveyNetwork = null;
let currentSignatoriesNodeMap = new Map();
let html5QrScanner = null;
let isQrScannerRunning = false;
let pendingVerificationCode = null;

// Roster Sorting & Quick-Filter State
let rosterSortField = 'overallPercent';
let rosterSortAsc = false;
let rosterGroupFilter = 'ALL';
let rosterStatusFilter = 'ALL';
let rosterSearchTerm = '';
let rosterControlsInitialized = false;

// Keyed Debounce Utility to prevent Realtime re-render storms
const debounceTimers = new Map();
function debounceTask(key, fn, delay = 300) {
  if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(() => {
    debounceTimers.delete(key);
    fn();
  }, delay));
}

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

/* =========================================================
   10-MINUTE COUNTDOWN BAR & AUTO-REFRESH ON QR CODE
   ========================================================= */
export function startQrCodeCountdown(type = 'TAMBAY', targetId = null) {
  lastGeneratedQrMeta = { type, targetId };
  if (qrCountdownInterval) clearInterval(qrCountdownInterval);

  const qrContainer = document.getElementById('qrDisplayContainer');
  if (!qrContainer) return;

  let controlsWrap = document.getElementById('qrCountdownControlsWrap');
  if (!controlsWrap) {
    controlsWrap = document.createElement('div');
    controlsWrap.id = 'qrCountdownControlsWrap';
    controlsWrap.style.cssText = 'margin-top: 12px; max-width: 260px; margin-left: auto; margin-right: auto;';
    const closeBtn = document.getElementById('closeQrBtn')?.parentElement;
    if (closeBtn) {
      qrContainer.insertBefore(controlsWrap, closeBtn);
    } else {
      qrContainer.appendChild(controlsWrap);
    }
  }

  const totalSeconds = 600; // 10 minutes
  let remaining = totalSeconds;

  const renderControls = () => {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const pct = Math.max(0, (remaining / totalSeconds) * 100);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    controlsWrap.innerHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--text-muted); margin-bottom: 4px;">
        <span>Code Validity</span>
        <strong style="font-family: var(--font-mono); color: ${remaining < 60 ? '#b33a2b' : 'var(--brand-forest)'};">${timeStr}</strong>
      </div>
      <div style="background: var(--border-subtle); height: 6px; border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
        <div style="background: ${remaining < 60 ? '#b33a2b' : 'var(--brand-forest)'}; width: ${pct}%; height: 100%; transition: width 1s linear;"></div>
      </div>
      <button type="button" id="regenerateQrCodeBtn" class="btn btn-secondary" style="min-height: 32px; padding: 4px 10px; font-size: 0.76rem; width: 100%;">
        Regenerate Code
      </button>
    `;

    controlsWrap.querySelector('#regenerateQrCodeBtn')?.addEventListener('click', async () => {
      if (lastGeneratedQrMeta.type === 'TAMBAY') {
        document.getElementById('showQrBtn')?.click();
      } else {
        const code = await generateApplicantShortCode(lastGeneratedQrMeta.targetId, 'SIGNATORY');
        if (code) {
          const textElem = document.getElementById('applicantShortCodeText');
          const canvasElem = document.getElementById('qrcodeCanvas');
          if (textElem) textElem.textContent = code;
          const verifyUrl = `${window.location.origin}${window.location.pathname}?verifyCode=${code}`;
          if (canvasElem) {
            canvasElem.innerHTML = `
              <div style="margin-bottom: 8px;">
                <span class="badge" style="background: var(--brand-forest); color: #ffffff;">Signatory Code</span>
              </div>
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(verifyUrl)}" 
                   alt="Signatory QR" width="160" height="160" style="border-radius: 6px;" />
            `;
          }
          startQrCodeCountdown('SIGNATORY', lastGeneratedQrMeta.targetId);
          showToast(`New code generated: ${code}`, 'info');
        }
      }
    });
  };

  renderControls();
  qrCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(qrCountdownInterval);
      const textElem = document.getElementById('applicantShortCodeText');
      if (textElem) textElem.textContent = 'EXPIRED';
      renderControls();
      return;
    }
    renderControls();
  }, 1000);
}

function autoCloseQrDisplayIfOpen() {
  const qrContainer = document.getElementById('qrDisplayContainer');
  if (qrContainer && qrContainer.style.display !== 'none') {
    qrContainer.style.display = 'none';
    if (qrCountdownInterval) clearInterval(qrCountdownInterval);
  }
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

function formatName(name) {
  if (!name) return '';
  const parts = name.split(' ');
  if (parts.length > 1) {
    return parts[0] + '\n' + parts.slice(1).join(' ');
  }
  return name;
}

/* =========================================================
   MEMBER PERSONAL ACTIVITY LOG ("WHO HAVE I SIGNED / TIMED IN?")
   ========================================================= */
async function renderMemberPersonalActivityCard() {
  const memHubTab = document.getElementById('member-hub-view');
  if (!memHubTab || !currentUser) return;

  const [memberProfile, settings] = await Promise.all([
    getMemberProfile(currentUser.email),
    getGlobalSettings()
  ]);
  if (!memberProfile) return;

  const { signedList, tambayVerifications, regularSigCount } = await getMemberPersonalActivityLog(memberProfile.full_name);

  let card = document.getElementById('memberPersonalActivityCard');
  if (!card) {
    card = document.createElement('section');
    card.id = 'memberPersonalActivityCard';
    card.className = 'card';
    memHubTab.appendChild(card);
  }

  const quotaBadgeText = settings.memberSigLimitEnabled
    ? `${regularSigCount} / 4 Regular Sigs Used`
    : `${regularSigCount} Regular Sigs (Limit Off)`;
  const isQuotaFull = settings.memberSigLimitEnabled && regularSigCount >= 4;

  const signedHtml = signedList.length === 0
    ? '<li class="subtext" style="padding: 8px 0;">You have not endorsed any applicant signatories yet.</li>'
    : signedList.map(s => `
      <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 0.82rem;">
        <div>
          <strong style="color: var(--text-heading);">${s.applicantName}</strong>
          <span class="badge" style="margin-left: 6px; font-size: 0.68rem;">${s.applicantGroup}</span>
          <div style="color: var(--text-muted); font-size: 0.76rem; margin-top: 2px;">
            ${s.committee_name || s.role}: <strong>${s.trait || s.task}</strong>
          </div>
        </div>
        <span class="badge" style="background: ${s.isRegularQuota ? 'var(--brand-mint-subtle)' : 'var(--surface-subtle)'}; color: var(--brand-forest);">
          ${s.isRegularQuota ? 'Regular Quota' : (s.committee_name || s.role)}
        </span>
      </li>
    `).join('');

  const tambayHtml = tambayVerifications.length === 0
    ? '<li class="subtext" style="padding: 8px 0;">No tambay sessions verified yet.</li>'
    : tambayVerifications.slice(0, 10).map(t => `
      <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 0.8rem;">
        <div>
          <strong style="color: var(--text-heading);">${t.applicantName}</strong>
          <div style="color: var(--text-muted); font-size: 0.74rem;">
            ${t.type} • ${t.timestamp ? new Date(t.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
          </div>
        </div>
        <span class="badge" style="background: ${t.hours ? 'var(--brand-mint-subtle)' : '#FFF7EB'}; color: var(--brand-forest); font-family: var(--font-mono);">
          ${t.hours ? `+${t.hours} hrs` : 'In Progress'}
        </span>
      </li>
    `).join('');

  card.innerHTML = `
    <div class="card-header" style="margin-bottom: 12px;">
      <div>
        <h3 style="font-size: 1.05rem; color: var(--brand-forest); margin: 0;">My Verification History & Quota</h3>
        <p class="subtext">Applicants you have personally signed or timed in/out as <strong>${memberProfile.full_name}</strong>.</p>
      </div>
      <span class="badge" style="background: ${isQuotaFull ? '#b33a2b' : 'var(--brand-forest)'}; color: #fff;">
        ${quotaBadgeText}
      </span>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px;">
      <div>
        <strong style="font-size: 0.78rem; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 6px;">
          Signatories Endorsed (${signedList.length})
        </strong>
        <ul class="task-list" style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
          ${signedHtml}
        </ul>
      </div>
      <div>
        <strong style="font-size: 0.78rem; text-transform: uppercase; color: var(--text-muted); display: block; margin-bottom: 6px;">
          Recent Tambay Verifications (${tambayVerifications.length})
        </strong>
        <ul class="task-list" style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
          ${tambayHtml}
        </ul>
      </div>
    </div>
  `;
}

/* =========================================================
   RACOMM BULK EVENT ATTENDANCE MATRIX MODAL
   ========================================================= */
function ensureBulkEventAttendanceModal() {
  let modal = document.getElementById('bulkEventAttendanceModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'bulkEventAttendanceModal';
  modal.className = 'modal-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 540px;">
      <div class="modal-header-bar">
        <div>
          <h2 style="font-family: var(--font-display); color: var(--brand-forest); font-size: 1.2rem; margin: 0;">Bulk Event Check-In Matrix</h2>
          <small class="subtext">Credit (+5%) attendance across multiple applicants at once.</small>
        </div>
        <button type="button" id="closeBulkEventModalBtn" class="btn btn-secondary" style="padding: 4px 10px; font-size: 1.1rem; line-height: 1;">&times;</button>
      </div>
      <div class="modal-scrollable-body">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label style="font-size: 0.76rem; font-weight: 600; display: block; margin-bottom: 4px;">Select Official Event:</label>
            <select id="bulkEventSelect" style="width: 100%; font-size: 0.82rem;"></select>
          </div>
          <div>
            <label style="font-size: 0.76rem; font-weight: 600; display: block; margin-bottom: 4px;">Filter Buddy Group:</label>
            <select id="bulkEventGroupFilter" style="width: 100%; font-size: 0.82rem;"></select>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px;">
          <span id="bulkEventCountLabel" class="badge">0 Selected</span>
          <div style="display: flex; gap: 6px;">
            <button type="button" id="bulkSelectAllVisibleBtn" class="btn btn-secondary" style="min-height: 28px; padding: 2px 8px; font-size: 0.74rem;">Select Visible</button>
            <button type="button" id="bulkDeselectAllVisibleBtn" class="btn btn-secondary" style="min-height: 28px; padding: 2px 8px; font-size: 0.74rem;">Clear Visible</button>
          </div>
        </div>
        <div id="bulkEventApplicantsList" style="display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; padding: 8px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);"></div>
      </div>
      <div class="modal-actions-bar">
        <button type="button" id="saveBulkEventAttendanceBtn" class="btn btn-checkin" style="flex: 2;">Save Event Attendance</button>
        <button type="button" id="cancelBulkEventModalBtn" class="btn btn-secondary" style="flex: 1;">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => { modal.style.display = 'none'; };
  document.getElementById('closeBulkEventModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelBulkEventModalBtn').addEventListener('click', closeModal);

  const updateCountBadge = () => {
    const checked = modal.querySelectorAll('.bulk-evt-app-check:checked').length;
    const total = modal.querySelectorAll('.bulk-evt-app-check').length;
    const badge = document.getElementById('bulkEventCountLabel');
    if (badge) badge.textContent = `${checked} / ${total} Attended`;
  };

  const loadChecksForSelectedEvent = async () => {
    const eventId = document.getElementById('bulkEventSelect')?.value;
    if (!eventId) return;
    const attendedUserIds = new Set(await getEventAttendeeUserIds(eventId));
    modal.querySelectorAll('.bulk-evt-app-check').forEach(chk => {
      chk.checked = attendedUserIds.has(chk.dataset.userId);
    });
    updateCountBadge();
  };

  document.getElementById('bulkEventSelect').addEventListener('change', loadChecksForSelectedEvent);

  document.getElementById('bulkEventGroupFilter').addEventListener('change', (e) => {
    const grp = e.target.value;
    modal.querySelectorAll('.bulk-evt-app-row').forEach(row => {
      row.style.display = (grp === 'ALL' || row.dataset.group === grp) ? 'flex' : 'none';
    });
  });

  document.getElementById('bulkSelectAllVisibleBtn').addEventListener('click', () => {
    modal.querySelectorAll('.bulk-evt-app-row').forEach(row => {
      if (row.style.display !== 'none') {
        const chk = row.querySelector('.bulk-evt-app-check');
        if (chk) chk.checked = true;
      }
    });
    updateCountBadge();
  });

  document.getElementById('bulkDeselectAllVisibleBtn').addEventListener('click', () => {
    modal.querySelectorAll('.bulk-evt-app-row').forEach(row => {
      if (row.style.display !== 'none') {
        const chk = row.querySelector('.bulk-evt-app-check');
        if (chk) chk.checked = false;
      }
    });
    updateCountBadge();
  });

  modal.addEventListener('change', (e) => {
    if (e.target.classList.contains('bulk-evt-app-check')) updateCountBadge();
  });

  document.getElementById('saveBulkEventAttendanceBtn').addEventListener('click', async () => {
    const eventId = document.getElementById('bulkEventSelect')?.value;
    if (!eventId || !currentUser) return;
    const btn = document.getElementById('saveBulkEventAttendanceBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const checkedIds = Array.from(modal.querySelectorAll('.bulk-evt-app-check:checked')).map(c => c.dataset.userId);
    const ok = await adminBulkSetEventAttendance(eventId, checkedIds, currentUser.email);

    btn.disabled = false;
    btn.textContent = 'Save Event Attendance';

    if (ok) {
      showToast(`Bulk attendance saved (${checkedIds.length} applicants marked attended).`, 'success');
      closeModal();
      await Promise.all([renderRoster(), renderLeaderboard()]);
    } else {
      showToast('Failed to save bulk event attendance.', 'error');
    }
  });

  modal._loadChecksForSelectedEvent = loadChecksForSelectedEvent;
  return modal;
}

async function openBulkEventAttendanceModal() {
  const modal = ensureBulkEventAttendanceModal();
  const [events, applicants, groups] = await Promise.all([
    getEvents(),
    getAllApplicantsProgress(),
    getManagedBuddyGroups()
  ]);

  const evtSelect = document.getElementById('bulkEventSelect');
  const grpSelect = document.getElementById('bulkEventGroupFilter');
  const listEl = document.getElementById('bulkEventApplicantsList');

  if (evtSelect) {
    evtSelect.innerHTML = events.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  }
  if (grpSelect) {
    grpSelect.innerHTML = `
      <option value="ALL">All Buddy Groups (${applicants.length})</option>
      <option value="Unassigned">Unassigned</option>
      ${groups.map(g => `<option value="${g.name}">${g.name}</option>`).join('')}
    `;
  }

  if (listEl) {
    listEl.innerHTML = applicants.map(a => `
      <label class="bulk-evt-app-row" data-group="${a.buddyGroup}" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--surface); border-radius: 6px; border: 1px solid var(--border-subtle); cursor: pointer; font-size: 0.82rem;">
        <div>
          <strong>${a.fullName}</strong> (${a.nickname})
          <span class="badge" style="margin-left: 6px; font-size: 0.68rem;">${a.buddyGroup}</span>
        </div>
        <input type="checkbox" class="bulk-evt-app-check" data-user-id="${a.id}" />
      </label>
    `).join('') || '<p class="subtext">No applicants registered.</p>';
  }

  modal.style.display = 'flex';
  if (modal._loadChecksForSelectedEvent) {
    await modal._loadChecksForSelectedEvent();
  }
}

function injectBulkEventRosterButton(isRAComm) {
  const csvBtn = document.getElementById('adminExportCsvBtn');
  if (!csvBtn) return;

  let bulkBtn = document.getElementById('adminBulkEventModalBtn');
  if (!isRAComm) {
    if (bulkBtn) bulkBtn.style.display = 'none';
    return;
  }

  if (!bulkBtn) {
    bulkBtn = document.createElement('button');
    bulkBtn.id = 'adminBulkEventModalBtn';
    bulkBtn.className = 'btn btn-secondary';
    bulkBtn.style.cssText = 'min-height: 36px; padding: 4px 10px; font-size: 0.82rem;';
    bulkBtn.textContent = 'Bulk Event Check-In';
    csvBtn.parentNode.insertBefore(bulkBtn, csvBtn);
    bulkBtn.addEventListener('click', openBulkEventAttendanceModal);
  }
  bulkBtn.style.display = 'inline-flex';
}

/* =========================================================
   ITEM 6: TAMBAY PACE & "HOURS NEEDED PER DAY" CALCULATOR + LOG HISTORY
   ========================================================= */
async function renderApplicantTambayHistoryAndPace() {
  if (!currentUser) return;
  const tambayBadge = document.getElementById('tambayBadge');
  const tambayCard = tambayBadge?.closest('section.card');
  if (!tambayCard) return;

  const [logs, settings] = await Promise.all([
    getApplicantTambayLogHistory(currentUser.id),
    getGlobalSettings()
  ]);

  const totalHours = logs.reduce((acc, row) => acc + (parseFloat(row.hours) || 0), 0);
  const remainingHours = Math.max(0, CONFIG.TARGET_TAMBAY_HOURS - totalHours);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const hoursToday = logs
    .filter(l => new Date(l.created_at) >= startOfDay)
    .reduce((acc, row) => acc + (parseFloat(row.hours) || 0), 0);

  const dailyCap = 3.0;
  const remainingTodayCap = Math.max(0, dailyCap - hoursToday);
  const minDaysRequired = settings.dailyCapEnabled
    ? Math.ceil(remainingHours / dailyCap)
    : (remainingHours > 0 ? 1 : 0);

  // Inject Tambay Pace & Daily Cap Advisor Box
  let paceBox = document.getElementById('applicantTambayPaceBox');
  if (!paceBox) {
    paceBox = document.createElement('div');
    paceBox.id = 'applicantTambayPaceBox';
    paceBox.style.cssText = 'margin-top: 14px; padding: 12px 14px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);';
    tambayCard.appendChild(paceBox);
  }

  const todayCapPct = Math.min(100, Math.round((hoursToday / dailyCap) * 100));

  paceBox.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: ${settings.dailyCapEnabled ? '10px' : '0'};">
      <div>
        <span style="font-size: 0.7rem; text-transform: uppercase; font-weight: 600; color: var(--text-muted); display: block;">Hours Needed</span>
        <strong style="font-family: var(--font-mono); font-size: 0.95rem; color: var(--brand-forest);">
          ${remainingHours === 0 ? 'Target Met (24h)' : `${remainingHours.toFixed(1)} hrs left`}
        </strong>
      </div>
      <div>
        <span style="font-size: 0.7rem; text-transform: uppercase; font-weight: 600; color: var(--text-muted); display: block;">Today's Logged Hours</span>
        <strong style="font-family: var(--font-mono); font-size: 0.95rem; color: var(--text-heading);">
          ${hoursToday.toFixed(2)}${settings.dailyCapEnabled ? ` / ${dailyCap.toFixed(1)} hrs` : ' hrs'}
        </strong>
      </div>
      <div>
        <span style="font-size: 0.7rem; text-transform: uppercase; font-weight: 600; color: var(--text-muted); display: block;">Pace Estimate</span>
        <strong style="font-size: 0.85rem; color: var(--text-heading);">
          ${remainingHours === 0
            ? 'Complete'
            : (settings.dailyCapEnabled
                ? `Min. ${minDaysRequired} tambay day${minDaysRequired === 1 ? '' : 's'} (at 3h/day cap)`
                : 'Daily cap disabled')}
        </strong>
      </div>
    </div>
    ${settings.dailyCapEnabled ? `
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 3px;">
          <span>Daily Cap Usage Today</span>
          <span>${remainingTodayCap > 0 ? `${remainingTodayCap.toFixed(2)} hrs remaining today` : 'Daily 3.0 hr limit reached'}</span>
        </div>
        <div style="background: var(--border-subtle); height: 6px; border-radius: 3px; overflow: hidden;">
          <div style="background: ${remainingTodayCap <= 0 ? '#b33a2b' : 'var(--brand-forest)'}; width: ${todayCapPct}%; height: 100%; transition: width 0.3s ease;"></div>
        </div>
      </div>
    ` : ''}
  `;

  // Collapsible Session History Drawer
  let historyWrap = document.getElementById('applicantPersonalTambayHistoryWrap');
  if (!historyWrap) {
    historyWrap = document.createElement('details');
    historyWrap.id = 'applicantPersonalTambayHistoryWrap';
    historyWrap.style.cssText = 'margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border-medium);';
    tambayCard.appendChild(historyWrap);
  }

  if (logs.length === 0) {
    historyWrap.innerHTML = `
      <summary style="cursor: pointer; font-weight: 600; font-size: 0.85rem; color: var(--brand-forest); user-select: none;">
        My Tambay Session History (0 sessions)
      </summary>
      <p class="subtext" style="margin-top: 8px;">No completed tambay sessions recorded yet.</p>
    `;
    return;
  }

  historyWrap.innerHTML = `
    <summary style="cursor: pointer; font-weight: 600; font-size: 0.85rem; color: var(--brand-forest); user-select: none;">
      My Tambay Session History (${logs.length} session${logs.length === 1 ? '' : 's'})
    </summary>
    <ul class="task-list" style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto;">
      ${logs.map(l => `
        <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 0.8rem;">
          <div>
            <strong style="color: var(--text-heading);">${new Date(l.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
            <small style="color: var(--text-muted); margin-left: 6px;">${new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            <div style="font-size: 0.74rem; color: var(--text-muted);">Verified by: ${l.verified_by || 'Resident Member'}</div>
          </div>
          <span class="badge" style="background: var(--brand-mint-subtle); color: var(--brand-forest); font-family: var(--font-mono); font-weight: 700;">
            +${Number(l.hours).toFixed(2)} hrs
          </span>
        </li>
      `).join('')}
    </ul>
  `;
}

/* =========================================================
   VERIFICATION PREVIEW MODAL FOR RESIDENT MEMBERS
   ========================================================= */
function ensureVerificationPreviewModal() {
  let modal = document.getElementById('verificationPreviewModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'verificationPreviewModal';
  modal.className = 'modal-backdrop';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal-box" style="max-width: 440px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h3 id="previewModalTitle" style="color: var(--brand-forest); margin: 0;">Verify Applicant Request</h3>
        <span id="previewModalTypeBadge" class="badge">Code</span>
      </div>
      <div id="previewModalBody" style="margin-bottom: 16px; font-size: 0.85rem; display: flex; flex-direction: column; gap: 10px;"></div>
      <div style="display: flex; gap: 8px;">
        <button id="confirmVerifyPreviewBtn" class="btn btn-checkin" style="flex: 1;">Approve & Verify</button>
        <button id="cancelVerifyPreviewBtn" class="btn btn-secondary" style="flex: 1;">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('cancelVerifyPreviewBtn').addEventListener('click', () => {
    modal.style.display = 'none';
    pendingVerificationCode = null;
  });

  document.getElementById('confirmVerifyPreviewBtn').addEventListener('click', async () => {
    if (!pendingVerificationCode || !currentUser) return;
    const btn = document.getElementById('confirmVerifyPreviewBtn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    const res = await verifyUniversalCode(pendingVerificationCode, currentUser.email);
    btn.disabled = false;
    btn.textContent = origText;
    modal.style.display = 'none';
    pendingVerificationCode = null;

    showToast(res.message, res.success ? 'success' : 'error');
    await handleAuth();
  });

  return modal;
}

async function openVerificationPreviewModal(code) {
  if (!currentUser) return;
  const preview = await getVerificationCodePreview(code, currentUser.email);
  if (!preview.valid) {
    showToast(preview.message, 'error');
    return;
  }

  pendingVerificationCode = preview.code;
  const modal = ensureVerificationPreviewModal();
  const titleEl = document.getElementById('previewModalTitle');
  const badgeEl = document.getElementById('previewModalTypeBadge');
  const bodyEl = document.getElementById('previewModalBody');
  const confirmBtn = document.getElementById('confirmVerifyPreviewBtn');

  const appName = preview.applicant
    ? (preview.applicant.nickname ? `${preview.applicant.full_name} ("${preview.applicant.nickname}")` : preview.applicant.full_name)
    : 'Unknown Applicant';
  const appGroup = preview.applicant?.buddy_group_name || 'Unassigned';

  if (preview.type === 'SIGNATORY') {
    const s = preview.signatory;
    const isOA = (s.committee_name || '').toUpperCase() === 'O.A' || (s.role || '').toUpperCase() === 'O.A';
    titleEl.textContent = 'Signatory Verification Preview';
    badgeEl.textContent = `${s.committee_name || s.role || 'Member'} Signatory`;
    badgeEl.style.background = 'var(--brand-forest)';
    badgeEl.style.color = '#fff';
    confirmBtn.textContent = 'Approve & Sign';

    const detailsRows = isOA ? `
      <div><strong>Entered Member/Alum Name:</strong> ${s.member_name || '<em>Not filled</em>'}</div>
      <div><strong>GEOP Batch:</strong> ${s.geop_batch || '<em>Not filled</em>'}</div>
      <div><strong>Favorite Flagship Event:</strong> ${s.favorite_flagship_event || '<em>Not filled</em>'}</div>
      <div><strong>Favorite GEOP Memory:</strong> ${s.favorite_geop_memory || '<em>Not filled</em>'}</div>
    ` : `
      ${s.selected_task ? `<div><strong>Selected Task from Pool:</strong> ${s.selected_task}</div>` : ''}
      <div><strong>Nickname:</strong> ${s.nickname || '<em>Not filled</em>'}</div>
      <div><strong>Favorite UP GEOP Tradition:</strong> ${s.favorite_tradition || '<em>Not filled</em>'}</div>
      <div><strong>Top Field Role:</strong> ${s.top_field_role || '<em>Not filled</em>'}</div>
      <div><strong>Unique Fact:</strong> ${s.unique_fact || '<em>Not filled</em>'}</div>
    `;

    bodyEl.innerHTML = `
      <div style="padding: 10px 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
        <div><strong>Applicant:</strong> ${appName}</div>
        <div><strong>Buddy Group:</strong> ${appGroup}</div>
      </div>
      <div style="padding: 10px 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border-left: 4px solid var(--brand-forest);">
        <div style="margin-bottom: 6px;"><strong style="color: var(--brand-forest);">Requirement / Trait:</strong><br/>${s.trait || s.task}</div>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; border-top: 1px dashed var(--border-medium); padding-top: 6px;">
          ${detailsRows}
        </div>
      </div>
    `;
  } else if (preview.type === 'TAMBAY') {
    const active = preview.activeSession;
    const isTimingOut = !!active;
    titleEl.textContent = isTimingOut ? 'Confirm Tambay Time-Out' : 'Confirm Tambay Time-In';
    badgeEl.textContent = isTimingOut ? 'TIME-OUT' : 'TIME-IN';
    badgeEl.style.background = isTimingOut ? '#b33a2b' : 'var(--brand-mint)';
    badgeEl.style.color = '#fff';
    confirmBtn.textContent = isTimingOut ? 'Confirm Time-Out' : 'Confirm Time-In';

    let sessionInfoHtml = '';
    if (isTimingOut) {
      const elapsedHrs = ((Date.now() - new Date(active.time_in).getTime()) / (1000 * 60 * 60)).toFixed(2);
      sessionInfoHtml = `
        <div><strong>Action:</strong> Clocking Out of Tambay Session</div>
        <div><strong>Timed In At:</strong> ${new Date(active.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (by ${active.verified_by})</div>
        <div><strong>Raw Elapsed Duration:</strong> ${elapsedHrs} hrs</div>
        ${preview.applicant?.tambay_boost_active ? `<div style="color: var(--brand-forest); font-weight: 700;">1.5x Tambay Boost Active</div>` : ''}
      `;
    } else {
      sessionInfoHtml = `<div><strong>Action:</strong> Starting a new live Tambay Session</div>`;
    }

    bodyEl.innerHTML = `
      <div style="padding: 10px 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
        <div><strong>Applicant:</strong> ${appName}</div>
        <div><strong>Buddy Group:</strong> ${appGroup}</div>
      </div>
      <div style="padding: 10px 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border-left: 4px solid ${isTimingOut ? '#b33a2b' : 'var(--brand-mint)'}; display: flex; flex-direction: column; gap: 4px;">
        ${sessionInfoHtml}
      </div>
    `;
  }

  modal.style.display = 'flex';
}

/* =========================================================
   "WHO'S AT THE TAMBAYAN RIGHT NOW?" LIVE WIDGET & AUTO-GUARD
   ========================================================= */
async function renderLiveTambayanPresence() {
  if (!currentUser) return;
  const [activeSessions, isRAComm] = await Promise.all([
    getAllActiveTambaySessions(),
    checkIfRAComm(currentUser.email)
  ]);

  const buildWidgetHtml = (showOfficerControls) => {
    if (activeSessions.length === 0) {
      return `
        <div class="card-header" style="margin-bottom: 4px;">
          <div>
            <h3 style="font-size: 1.05rem; color: var(--brand-forest); margin: 0;">Who's at the Tambayan Right Now?</h3>
            <p class="subtext">No applicants are currently timed in at the tambayan.</p>
          </div>
          <span class="badge">0 Active</span>
        </div>
      `;
    }

    const itemsHtml = activeSessions.map(s => {
      const hrs = Math.floor(s.elapsedHours);
      const mins = Math.floor((s.elapsedHours - hrs) * 60);
      const durText = `${hrs}h ${mins}m`;
      const displayName = s.nickname ? `${s.nickname} (${s.fullName})` : s.fullName;

      return `
        <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 12px; border-left: 4px solid ${s.isStale ? '#b33a2b' : 'var(--brand-mint)'};">
          <div>
            <strong style="color: var(--text-heading); font-size: 0.88rem;">${displayName}</strong>
            <span class="badge" style="margin-left: 6px; font-size: 0.7rem;">${s.buddyGroup}</span>
            ${s.isStale ? `<span class="badge" style="background: #b33a2b; color: #fff; margin-left: 4px; font-size: 0.7rem;">8h+ Stale Session</span>` : ''}
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
              In since ${new Date(s.time_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${durText} elapsed) • Verified by ${s.verified_by}
            </div>
          </div>
          ${showOfficerControls ? `
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-secondary force-close-tambay-btn" data-user-id="${s.user_id}" data-mode="zero" style="min-height: 28px; padding: 2px 8px; font-size: 0.72rem; color: #b33a2b; border-color: #b33a2b;">
                Force Close (0h)
              </button>
              <button type="button" class="btn btn-secondary force-close-tambay-btn" data-user-id="${s.user_id}" data-mode="custom" style="min-height: 28px; padding: 2px 8px; font-size: 0.72rem;">
                Close & Credit
              </button>
            </div>
          ` : `
            <span class="badge" style="background: var(--brand-mint-subtle); color: var(--brand-forest); font-family: var(--font-mono);">${durText}</span>
          `}
        </li>
      `;
    }).join('');

    return `
      <div class="card-header" style="margin-bottom: 10px;">
        <div>
          <h3 style="font-size: 1.05rem; color: var(--brand-forest); margin: 0;">Who's at the Tambayan Right Now?</h3>
          <p class="subtext">Live roster of applicants currently timed in.</p>
        </div>
        <span class="badge" style="background: var(--brand-mint); color: #fff;">${activeSessions.length} Active</span>
      </div>
      <ul class="task-list" style="display: flex; flex-direction: column; gap: 6px;">
        ${itemsHtml}
      </ul>
    `;
  };

  const appTambayTab = document.getElementById('tab-tambay');
  if (appTambayTab) {
    let appWidget = document.getElementById('applicantLiveTambayanWidget');
    if (!appWidget) {
      appWidget = document.createElement('section');
      appWidget.id = 'applicantLiveTambayanWidget';
      appWidget.className = 'card';
      const eventSection = document.getElementById('eventList')?.closest('section.card');
      if (eventSection) {
        appTambayTab.insertBefore(appWidget, eventSection);
      } else {
        appTambayTab.appendChild(appWidget);
      }
    }
    appWidget.innerHTML = buildWidgetHtml(false);
  }

  const memHubTab = document.getElementById('member-hub-view');
  if (memHubTab) {
    let memWidget = document.getElementById('memberLiveTambayanWidget');
    if (!memWidget) {
      memWidget = document.createElement('section');
      memWidget.id = 'memberLiveTambayanWidget';
      memWidget.className = 'card';
      memHubTab.appendChild(memWidget);
    }
    memWidget.innerHTML = buildWidgetHtml(isRAComm);
  }
}

/* =========================================================
   INTERACTIVE SURVEY CONTROL NETWORK
   ========================================================= */
function initSurveyNetwork(signatories) {
  const container = document.getElementById('surveyNetworkMap');
  if (!container) return;

  const nodes = [];
  const edges = [];
  let completedCount = 0;
  currentSignatoriesNodeMap.clear();

  nodes.push({
    id: 0,
    label: 'YOU',
    title: 'Your Control Station (Click any node to inspect or jump to task)',
    shape: 'circle',
    color: { background: '#FBB03B', border: '#C1272D' },
    font: { color: '#121212', face: 'monospace', size: 16, bold: true },
    borderWidth: 3,
    size: 25
  });

  signatories.forEach((sig, index) => {
    sig.nodeId = index + 1;
    currentSignatoriesNodeMap.set(sig.nodeId, sig);
    if (sig.completed) completedCount++;

    let rawLabel = '';
    let nShape = 'dot';
    let nSize = 10;

    if (sig.role === 'PES' || sig.type === 'PES') {
      rawLabel = sig.task || 'PES';
      nShape = 'star';
      nSize = sig.completed ? 22 : 16;
    } else if (sig.role === 'VP' || sig.type === 'VP') {
      rawLabel = 'VP ' + (sig.committee_name || '');
      nShape = 'diamond';
      nSize = sig.completed ? 16 : 12;
    } else if ((sig.committee_name || '').toUpperCase() === 'O.A') {
      rawLabel = sig.task === 'GEOP Alum' ? 'Alum' : 'Other';
      nShape = 'triangle';
      nSize = sig.completed ? 14 : 10;
    } else {
      rawLabel = (sig.committee_name || '') + ' Mem';
      nShape = 'dot';
      nSize = sig.completed ? 12 : 8;
    }

    if (sig.completed && sig.signed_by) {
      rawLabel = formatName(sig.signed_by);
    }

    const tooltipStatus = sig.completed
      ? `Signed by ${sig.signed_by || 'Verified'}\nRequirement: ${sig.trait || sig.task}`
      : `Pending (${sig.committee_name || sig.role || 'Member'})\nRequirement: ${sig.trait || sig.task}\nClick to jump to this task.`;

    nodes.push({
      id: sig.nodeId,
      label: rawLabel,
      title: tooltipStatus,
      shape: nShape,
      color: {
        background: sig.completed ? '#2e7d5a' : '#333333', 
        border: sig.completed ? '#4caf50' : '#555555'      
      },
      font: { color: sig.completed ? '#e0e0e0' : '#888888', size: 11, face: 'monospace', align: 'center' },
      size: nSize,
      borderWidth: 2
    });
  });

  const pesTasks = signatories.filter(s => s.role === 'PES' || s.type === 'PES' || (s.committee_name || '').toUpperCase() === 'PES');
  const vps = signatories.filter(s => s.role === 'VP' || s.type === 'VP');
  const members = signatories.filter(s => s.role === 'Member' || (!vps.includes(s) && !pesTasks.includes(s) && (s.committee_name || '').toUpperCase() !== 'O.A'));
  const oaTasks = signatories.filter(s => (s.committee_name || '').toUpperCase() === 'O.A');

  oaTasks.forEach(oa => {
    edges.push({
      from: 0, to: oa.nodeId,
      color: { color: oa.completed ? '#2e7d5a' : '#444444', opacity: oa.completed ? 0.9 : 0.3 },
      dashes: !oa.completed,
      width: oa.completed ? 3 : 1,
      length: 100
    });
  });

  members.forEach(m => {
    edges.push({
      from: 0, to: m.nodeId,
      color: { color: m.completed ? '#2e7d5a' : '#444444', opacity: m.completed ? 0.9 : 0.3 },
      dashes: !m.completed,
      width: m.completed ? 3 : 1,
      length: 90
    });
  });

  vps.forEach(vp => {
    const commMembers = members.filter(m => (m.committee_name || '').toLowerCase() === (vp.committee_name || '').toLowerCase());
    commMembers.forEach(m => {
      const edgeDone = m.completed && vp.completed;
      edges.push({
        from: m.nodeId, to: vp.nodeId,
        color: { color: edgeDone ? '#2e7d5a' : '#444444', opacity: edgeDone ? 0.9 : 0.3 },
        dashes: !edgeDone,
        width: edgeDone ? 3 : 1,
        length: 60
      });
    });
  });

  pesTasks.forEach(pes => {
    vps.forEach(vp => {
      const edgeDone = vp.completed && pes.completed;
      edges.push({
        from: vp.nodeId, to: pes.nodeId,
        color: { color: edgeDone ? '#2e7d5a' : '#444444', opacity: edgeDone ? 0.8 : 0.15 },
        dashes: !edgeDone,
        width: edgeDone ? 3 : 1,
        length: 200
      });
    });
  });

  const badge = document.getElementById('networkStatusBadge');
  if (badge) badge.textContent = `${completedCount} / ${signatories.length} Nodes`;

  const data = { nodes: nodes, edges: edges };
  const options = {
    physics: {
      forceAtlas2Based: { gravitationalConstant: -35, centralGravity: 0.005, springLength: 100, springConstant: 0.1 },
      maxVelocity: 50,
      solver: 'forceAtlas2Based',
      timestep: 0.35,
      stabilization: { iterations: 150 }
    },
    interaction: { dragNodes: true, zoomView: true, dragView: true, hover: true, tooltipDelay: 120 }
  };

  if (surveyNetwork) {
    surveyNetwork.setData(data);
  } else {
    surveyNetwork = new vis.Network(container, data, options);

    surveyNetwork.on('click', (params) => {
      if (!params.nodes || params.nodes.length === 0) return;
      const clickedNodeId = params.nodes[0];
      if (clickedNodeId === 0) {
        showToast(`Control Station: ${completedCount} of ${signatories.length} nodes tied in.`, 'info');
        return;
      }

      const sig = currentSignatoriesNodeMap.get(clickedNodeId);
      if (!sig) return;

      if (sig.completed) {
        const extra = sig.favorite_tradition
          ? ` • Tradition: "${sig.favorite_tradition}"`
          : (sig.favorite_geop_memory ? ` • Memory: "${sig.favorite_geop_memory}"` : '');
        showToast(`Signed by ${sig.signed_by || sig.member_name} (${sig.trait || sig.task})${extra}`, 'success');
      } else {
        const sigTabBtn = document.querySelector('#applicantTabNav [data-tab="tab-signatories"]');
        if (sigTabBtn) sigTabBtn.click();

        setTimeout(() => {
          const isPES = sig.role === 'PES' || sig.type === 'PES' || (sig.committee_name || '').toUpperCase() === 'PES';
          if (!isPES && sig.committee_name) {
            const filterBtn = document.querySelector(`#committeeFilterBar .committee-filter-btn[data-category="${sig.committee_name}"]`) ||
                              document.querySelector(`#committeeFilterBar .committee-filter-btn[data-category="ALL"]`);
            if (filterBtn) filterBtn.click();
          }

          const targetEl = document.querySelector(`[data-sig-id="${sig.id}"]`);
          const targetCard = targetEl?.closest('.card');
          if (targetCard) {
            targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const origOutline = targetCard.style.outline;
            targetCard.style.outline = '3px solid var(--brand-mint)';
            setTimeout(() => { targetCard.style.outline = origOutline; }, 2200);
          }
          showToast(`Jumped to pending task: ${sig.trait || sig.task}`, 'info');
        }, 120);
      }
    });
  }
}

/* =========================================================
   IN-APP CAMERA QR SCANNER FOR MEMBERS
   ========================================================= */
async function ensureQrLibraryLoaded() {
  if (window.Html5Qrcode) return true;
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function stopInAppQrScanner() {
  const scannerWrap = document.getElementById('inAppQrScannerWrapper');
  if (html5QrScanner && isQrScannerRunning) {
    try {
      await html5QrScanner.stop();
      html5QrScanner.clear();
    } catch (e) {
      console.warn('Error stopping QR scanner:', e);
    }
    isQrScannerRunning = false;
  }
  if (scannerWrap) scannerWrap.style.display = 'none';
}

function injectMemberQrScannerUI() {
  const hubSection = document.querySelector('#member-hub-view section.card');
  const manualBtn = document.getElementById('manualValidateBtn');
  if (!hubSection || !manualBtn || document.getElementById('openCameraQrBtn')) return;

  const btnWrapper = document.createElement('div');
  btnWrapper.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';
  manualBtn.parentNode.insertBefore(btnWrapper, manualBtn);
  btnWrapper.appendChild(manualBtn);

  const scanBtn = document.createElement('button');
  scanBtn.id = 'openCameraQrBtn';
  scanBtn.className = 'btn btn-secondary';
  scanBtn.style.cssText = 'min-height: 40px; padding: 6px 16px; border-color: var(--brand-forest); color: var(--brand-forest);';
  scanBtn.textContent = 'Scan QR with Camera';
  btnWrapper.appendChild(scanBtn);

  const scannerWrap = document.createElement('div');
  scannerWrap.id = 'inAppQrScannerWrapper';
  scannerWrap.style.cssText = 'display: none; margin-top: 16px; padding: 16px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-medium); text-align: center;';
  scannerWrap.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <strong style="font-size: 0.9rem; color: var(--brand-forest);">Point Camera at Applicant QR Code</strong>
      <button type="button" id="closeCameraQrBtn" class="btn btn-secondary" style="min-height: 30px; padding: 2px 10px; font-size: 0.78rem;">Close Camera</button>
    </div>
    <div id="inAppQrReader" style="max-width: 340px; margin: 0 auto; border-radius: 8px; overflow: hidden;"></div>
  `;
  hubSection.appendChild(scannerWrap);

  scanBtn.addEventListener('click', async () => {
    if (isQrScannerRunning) {
      await stopInAppQrScanner();
      return;
    }

    const loaded = await ensureQrLibraryLoaded();
    if (!loaded) {
      showToast('Could not load camera scanner library. Please check your connection.', 'error');
      return;
    }

    scannerWrap.style.display = 'block';
    html5QrScanner = new window.Html5Qrcode('inAppQrReader');

    try {
      isQrScannerRunning = true;
      await html5QrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (decodedText) => {
          await stopInAppQrScanner();

          let extractedCode = decodedText.trim();
          try {
            const url = new URL(decodedText);
            extractedCode = url.searchParams.get('verifyCode') || url.searchParams.get('validateApplicant') || extractedCode;
          } catch {
            // Raw 6-char code fallback
          }

          if (!extractedCode || extractedCode.length < 6) {
            showToast('Unrecognized QR code format.', 'error');
            return;
          }

          await openVerificationPreviewModal(extractedCode);
        },
        () => {}
      );
    } catch (err) {
      isQrScannerRunning = false;
      scannerWrap.style.display = 'none';
      showToast('Camera permission denied or unavailable on this device.', 'error');
    }
  });

  document.getElementById('closeCameraQrBtn')?.addEventListener('click', stopInAppQrScanner);
}

/* =========================================================
   APPLICANT GRADE BREAKDOWN DRAWER
   ========================================================= */
function renderGradeBreakdownUI(breakdown) {
  const bar = document.getElementById('progressBar');
  const gradeSection = bar?.closest('section.card');
  if (!gradeSection) return;

  let container = document.getElementById('gradeBreakdownDrawer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'gradeBreakdownDrawer';
    container.style.cssText = 'margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border-medium); display: grid; grid-template-columns: repeat(auto-fit, minmax(115px, 1fr)); gap: 8px;';
    gradeSection.appendChild(container);
  }

  const items = [
    { label: 'Events', val: breakdown.eventPoints, max: 25 },
    { label: 'Signatories', val: breakdown.sigPoints, max: 15 },
    { label: 'Tambay Hrs', val: breakdown.tambayPoints, max: 5 },
    { label: 'Interview', val: breakdown.interviewPoints, max: 15 },
    { label: 'OGT 1 & 2', val: breakdown.ogtPoints, max: 20 },
    { label: 'Consti Quiz', val: breakdown.constiPoints, max: 10 },
    { label: 'Buddy Tasks', val: breakdown.buddyTaskPoints, max: 10 }
  ];

  container.innerHTML = items.map(item => {
    const isFull = item.val >= item.max;
    return `
      <div style="background: var(--surface-subtle); border: 1px solid ${isFull ? 'var(--brand-mint)' : 'var(--border-subtle)'}; border-radius: var(--radius-sm); padding: 6px 10px; display: flex; flex-direction: column; justify-content: space-between;">
        <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">${item.label}</span>
        <strong style="font-family: var(--font-mono); font-size: 0.9rem; color: ${isFull ? 'var(--brand-forest)' : 'var(--text-heading)'};">
          ${Number(item.val).toFixed(1).replace(/\.0$/, '')} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">/ ${item.max}%</span>
        </strong>
      </div>
    `;
  }).join('');
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
          <div style="color: var(--brand-forest); font-weight: 700; font-size: 0.85rem;">Goal Met: +2 Days Extension Unlocked</div>
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
            Deadline: <strong>${deadline.toLocaleDateString()} ${deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
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

  const [tasks, groups, isRAComm] = await Promise.all([
    getBuddyTasks(),
    getManagedBuddyGroups(),
    checkIfRAComm(currentUser?.email)
  ]);

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

/* =========================================================
   ITEM 5: TARGETED & PINNED ANNOUNCEMENTS (ALL vs. BUDDY GROUP)
   ========================================================= */
async function renderPinnedOverviewAnnouncement(userGroup) {
  const overviewTab = document.getElementById('tab-overview');
  if (!overviewTab || !currentUser) return;

  const allAnnouncements = await getAnnouncements();
  const relevant = allAnnouncements.filter(a => {
    const tg = (a.target_group || 'ALL').trim();
    return !tg || tg.toUpperCase() === 'ALL' || (userGroup && tg.toLowerCase() === userGroup.toLowerCase());
  });

  let pinnedEl = document.getElementById('applicantPinnedAnnouncementCard');
  if (relevant.length === 0) {
    if (pinnedEl) pinnedEl.style.display = 'none';
    return;
  }

  const latest = relevant[0];
  const isRecent = (Date.now() - new Date(latest.created_at).getTime()) < (24 * 60 * 60 * 1000);
  const targetLabel = (!latest.target_group || latest.target_group === 'ALL') ? 'All Portal' : latest.target_group;

  if (!pinnedEl) {
    pinnedEl = document.createElement('section');
    pinnedEl.id = 'applicantPinnedAnnouncementCard';
    pinnedEl.className = 'card';
    pinnedEl.style.cssText = 'border-left: 4px solid var(--brand-forest); background: var(--surface); margin-bottom: 16px;';
    const statsGrid = overviewTab.querySelector('.stats-grid');
    if (statsGrid) {
      overviewTab.insertBefore(pinnedEl, statsGrid);
    } else {
      overviewTab.prepend(pinnedEl);
    }
  }

  pinnedEl.style.display = 'block';
  pinnedEl.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 8px; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span class="badge" style="background: var(--brand-forest); color: #fff;">Pinned Announcement</span>
        <span class="badge">${targetLabel}</span>
        ${isRecent ? `<span class="badge" style="background: var(--brand-mint); color: #111; font-weight: 700;">NEW</span>` : ''}
      </div>
      <small style="color: var(--text-muted); font-size: 0.75rem;">${new Date(latest.created_at).toLocaleDateString()}</small>
    </div>
    <h3 style="font-size: 1rem; color: var(--text-heading); margin-bottom: 4px;">${latest.title}</h3>
    <p style="font-size: 0.85rem; color: var(--text-body); white-space: pre-line; margin: 0;">${latest.content}</p>
  `;
}

async function renderAnnouncementsBoard() {
  const list = document.getElementById('announcementsList');
  const form = document.getElementById('racommAnnouncementForm');
  const badge = document.getElementById('racommPostBadge');
  if (!list || !currentUser) return;

  const [isRAComm, isMember, items, groups] = await Promise.all([
    checkIfRAComm(currentUser.email),
    checkIfResidentMember(currentUser.email),
    getAnnouncements(),
    getManagedBuddyGroups()
  ]);

  let userBuddyGroup = null;
  if (isMember || isRAComm) {
    const memProf = await getMemberProfile(currentUser.email);
    userBuddyGroup = memProf?.buddy_group_name || null;
  } else {
    const appProf = await getUserProfileData(currentUser.id);
    userBuddyGroup = appProf?.buddy_group_name || null;
  }

  const canPost = isRAComm || (isMember && userBuddyGroup && userBuddyGroup !== 'Unassigned');

  if (form) {
    form.style.display = canPost ? 'block' : 'none';
    let targetSelect = document.getElementById('announcementTargetGroupSelect');
    if (!targetSelect) {
      targetSelect = document.createElement('select');
      targetSelect.id = 'announcementTargetGroupSelect';
      targetSelect.style.cssText = 'width: 100%; margin-bottom: 8px; font-size: 0.85rem;';
      const postBtn = document.getElementById('postAnnouncementBtn');
      if (postBtn) form.insertBefore(targetSelect, postBtn);
    }

    if (isRAComm) {
      targetSelect.innerHTML = `
        <option value="ALL">Target Audience: All Portal (Universal)</option>
        ${groups.map(g => `<option value="${g.name}">Target Audience: ${g.name} Only</option>`).join('')}
      `;
      targetSelect.disabled = false;
    } else if (userBuddyGroup) {
      targetSelect.innerHTML = `<option value="${userBuddyGroup}">Target Audience: ${userBuddyGroup} Only</option>`;
      targetSelect.disabled = true;
    }
  }

  if (badge) {
    badge.style.display = canPost ? 'inline-block' : 'none';
    badge.textContent = isRAComm ? 'Officer' : 'Member';
  }

  const visibleItems = isRAComm
    ? items
    : items.filter(a => {
        const tg = (a.target_group || 'ALL').trim();
        return !tg || tg.toUpperCase() === 'ALL' || (userBuddyGroup && tg.toLowerCase() === userBuddyGroup.toLowerCase());
      });

  if (visibleItems.length === 0) {
    list.innerHTML = '<p class="subtext">No announcements posted yet.</p>';
    return;
  }

  const nowMs = Date.now();
  list.innerHTML = visibleItems.map(a => {
    const isRecent = (nowMs - new Date(a.created_at).getTime()) < (24 * 60 * 60 * 1000);
    const targetText = (!a.target_group || a.target_group === 'ALL') ? 'All Portal' : a.target_group;
    const canDelete = isRAComm || (a.author_email && a.author_email.toLowerCase() === currentUser.email.toLowerCase());

    return `
      <div class="card" style="margin: 0; padding: 14px; position: relative; border-left: 4px solid ${targetText === 'All Portal' ? 'var(--brand-forest)' : 'var(--brand-clay)'};">
        ${canDelete ? `<button class="btn btn-secondary delete-ann-btn" data-id="${a.id}" style="position:absolute; top:10px; right:10px; min-height:28px; padding:2px 8px; font-size:0.75rem; color:#b33a2b;">Delete</button>` : ''}
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          <span class="badge" style="font-size: 0.7rem;">${targetText}</span>
          ${isRecent ? `<span class="badge" style="background: var(--brand-mint); color: #111; font-size: 0.68rem; font-weight: 700;">NEW</span>` : ''}
        </div>
        <h3 style="font-size: 1rem; color: var(--brand-forest); margin-bottom: 4px;">${a.title}</h3>
        <p style="font-size: 0.85rem; margin-bottom: 8px; white-space: pre-line;">${a.content}</p>
        <small style="color: var(--text-muted);">Posted by ${a.author_email} on ${new Date(a.created_at).toLocaleDateString()}</small>
      </div>
    `;
  }).join('');
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

/* =========================================================
   MOST APPROACHED RESIDENT MEMBERS ON LEADERBOARD
   ========================================================= */
async function renderLeaderboard() {
  const container = document.getElementById('leaderboardContainer');
  const tambayList = document.getElementById('topTambayersList');
  const leaderboardTab = document.getElementById('tab-leaderboard');
  if (!container && !tambayList) return;

  const [applicants, groups, topMembers] = await Promise.all([
    getAllApplicantsProgress(),
    getManagedBuddyGroups(),
    getMostApproachedMembersLeaderboard()
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

  if (leaderboardTab) {
    let memSpotlightCard = document.getElementById('mostApproachedMembersCard');
    if (!memSpotlightCard) {
      memSpotlightCard = document.createElement('section');
      memSpotlightCard.id = 'mostApproachedMembersCard';
      memSpotlightCard.className = 'card';
      leaderboardTab.appendChild(memSpotlightCard);
    }

    const memItemsHtml = topMembers.length === 0
      ? '<li class="subtext" style="padding: 10px 14px;">No resident member verifications recorded yet.</li>'
      : topMembers.map((m, i) => `
        <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <strong style="font-size: 1.1rem; color: ${i === 0 ? '#FBB03B' : (i === 1 ? '#A8A9AD' : (i === 2 ? '#CD7F32' : 'var(--text-muted)'))};">#${i + 1}</strong>
            <div>
              <strong style="color: var(--text-heading); display: block;">${m.name}</strong>
              <small style="color: var(--text-muted);">${m.sigs} Signatories • ${m.tambay} Tambay Verifications</small>
            </div>
          </div>
          <span class="badge" style="background: var(--brand-mint-subtle); color: var(--brand-forest); font-family: var(--font-mono); font-weight: 700; font-size: 0.82rem;">
            ${m.total} Total
          </span>
        </li>
      `).join('');

    memSpotlightCard.innerHTML = `
      <div class="card-header">
        <div>
          <h2>Most Approached Resident Members</h2>
          <p class="subtext">Resident members with the most applicant signatories endorsed and tambay sessions verified.</p>
        </div>
        <span class="badge" style="background: var(--brand-clay); color: #fff;">Members MVP</span>
      </div>
      <ul class="task-list">${memItemsHtml}</ul>
    `;
  }
}

async function renderDashboard() {
  if (!currentUser) return;

  const [signatories, tambayHours, events, profile, activeSession] = await Promise.all([
    getSignatories(),
    getTambayHours(),
    getEvents(),
    getUserProfileData(currentUser.id),
    getActiveTambaySession(currentUser.id)
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

  renderGradeBreakdownUI({
    eventPoints,
    sigPoints,
    tambayPoints,
    interviewPoints,
    ogtPoints,
    constiPoints,
    buddyTaskPoints
  });

  const sigText = document.getElementById('overviewSigText');
  if (sigText) sigText.textContent = `${completedSigs}/${totalSigs}`;

  const tambayText = document.getElementById('overviewTambayText');
  if (tambayText) tambayText.textContent = tambayHours.toFixed(1);

  const tambayBadge = document.getElementById('tambayBadge');
  if (tambayBadge) tambayBadge.textContent = `${tambayHours.toFixed(1)} / ${CONFIG.TARGET_TAMBAY_HOURS} hrs (${tambayPoints}%)`;

  const eventBadge = document.getElementById('eventBadge');
  if (eventBadge) eventBadge.textContent = `${attendedEvents} / 5 Attended (${eventPoints}%)`;

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

  initSurveyNetwork(signatories);
  await Promise.all([
    renderLiveTambayanPresence(),
    renderApplicantTambayHistoryAndPace(),
    renderPinnedOverviewAnnouncement(profile?.buddy_group_name)
  ]);

  const eventList = document.getElementById('eventList');
  if (eventList) {
    eventList.innerHTML = events.map(evt => `
      <li class="task-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; margin-bottom: 8px;">
        <div>
          <strong style="color: var(--brand-forest); font-size: 0.95rem;">${evt.name}</strong>
          <div style="margin-top: 2px;">
            <small style="color: var(--text-muted);">
              Weight: 5.0% • ${evt.scheduledDate ? `Scheduled: ${new Date(evt.scheduledDate).toLocaleDateString()} ${new Date(evt.scheduledDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Officer-verified'}
            </small>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <a href="${generateGoogleCalendarUrl(evt.name, evt.scheduledDate)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="min-height: 32px; padding: 4px 8px; font-size: 0.75rem;">Add to Calendar</a>
          <span class="badge" style="background: ${evt.attended ? 'var(--brand-mint)' : 'var(--surface-subtle)'}; color: ${evt.attended ? '#ffffff' : 'inherit'}; font-weight: 600;">
            ${evt.attended ? 'Attended (+5%)' : 'Pending'}
          </span>
        </div>
      </li>
    `).join('');
  }
}

/* =========================================================
   ITEM 7: ROSTER COLUMN SORTING & STATUS QUICK-FILTERS
   ========================================================= */
function setupRosterControlsAndHeaders(groups, isRAComm) {
  const searchInput = document.getElementById('searchApplicantInput');
  const rosterTable = document.getElementById('applicantRosterTbody')?.closest('table');
  if (!searchInput || !rosterTable) return;

  const controlsBar = searchInput.parentElement;
  if (controlsBar) {
    controlsBar.style.flexWrap = 'wrap';

    let groupFilterSelect = document.getElementById('rosterGroupFilterSelect');
    if (isRAComm) {
      if (!groupFilterSelect) {
        groupFilterSelect = document.createElement('select');
        groupFilterSelect.id = 'rosterGroupFilterSelect';
        groupFilterSelect.style.cssText = 'min-height: 36px; padding: 4px 8px; font-size: 0.8rem;';
        controlsBar.insertBefore(groupFilterSelect, searchInput);
        groupFilterSelect.addEventListener('change', (e) => {
          rosterGroupFilter = e.target.value;
          renderRoster();
        });
      }
      groupFilterSelect.innerHTML = `
        <option value="ALL" ${rosterGroupFilter === 'ALL' ? 'selected' : ''}>All Groups</option>
        <option value="Unassigned" ${rosterGroupFilter === 'Unassigned' ? 'selected' : ''}>Unassigned</option>
        ${groups.map(g => `<option value="${g.name}" ${rosterGroupFilter === g.name ? 'selected' : ''}>${g.name}</option>`).join('')}
      `;
      groupFilterSelect.style.display = 'inline-block';
    } else if (groupFilterSelect) {
      groupFilterSelect.style.display = 'none';
    }

    let statusFilterSelect = document.getElementById('rosterStatusFilterSelect');
    if (!statusFilterSelect) {
      statusFilterSelect = document.createElement('select');
      statusFilterSelect.id = 'rosterStatusFilterSelect';
      statusFilterSelect.style.cssText = 'min-height: 36px; padding: 4px 8px; font-size: 0.8rem;';
      controlsBar.insertBefore(statusFilterSelect, searchInput);
      statusFilterSelect.addEventListener('change', (e) => {
        rosterStatusFilter = e.target.value;
        renderRoster();
      });
    }
    statusFilterSelect.innerHTML = `
      <option value="ALL" ${rosterStatusFilter === 'ALL' ? 'selected' : ''}>All Status</option>
      <option value="TIMED_IN" ${rosterStatusFilter === 'TIMED_IN' ? 'selected' : ''}>Timed In</option>
      <option value="STALE" ${rosterStatusFilter === 'STALE' ? 'selected' : ''}>8h+ Stale</option>
      <option value="OFFLINE" ${rosterStatusFilter === 'OFFLINE' ? 'selected' : ''}>Offline</option>
    `;
  }

  const theadRow = rosterTable.querySelector('thead tr');
  if (theadRow) {
    const columns = [
      { label: 'Applicant', field: 'fullName' },
      { label: 'Buddy Group', field: 'buddyGroup' },
      { label: 'Signatories', field: 'completedSigs' },
      { label: 'Tambay', field: 'tambayHours' },
      { label: 'Progress', field: 'overallPercent' },
      { label: 'Status', field: 'isTimedIn' },
      { label: 'Action', field: null }
    ];

    theadRow.innerHTML = columns.map(col => {
      if (!col.field) return `<th>${col.label}</th>`;
      const isSorted = rosterSortField === col.field;
      const dirIndicator = isSorted ? (rosterSortAsc ? ' (asc)' : ' (desc)') : '';
      return `<th class="sortable-roster-th" data-sort-field="${col.field}" style="cursor: pointer; user-select: none; color: ${isSorted ? 'var(--brand-forest)' : 'inherit'};">${col.label}${dirIndicator}</th>`;
    }).join('');

    if (!rosterControlsInitialized) {
      rosterControlsInitialized = true;
      theadRow.addEventListener('click', (e) => {
        const th = e.target.closest('.sortable-roster-th');
        if (!th) return;
        const field = th.dataset.sortField;
        if (rosterSortField === field) {
          rosterSortAsc = !rosterSortAsc;
        } else {
          rosterSortField = field;
          rosterSortAsc = field === 'fullName' || field === 'buddyGroup';
        }
        renderRoster();
      });
    }
  }
}

async function renderRoster() {
  const tbody = document.getElementById('applicantRosterTbody');
  if (!tbody || !currentUser) return;

  let [applicants, isRAComm, groups] = await Promise.all([
    getAllApplicantsProgress(),
    checkIfRAComm(currentUser.email),
    getManagedBuddyGroups()
  ]);

  injectBulkEventRosterButton(isRAComm);
  setupRosterControlsAndHeaders(groups, isRAComm);

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

  // Apply Quick-Filters (Group, Status, Search Term)
  let filtered = applicants.filter(app => {
    if (isRAComm && rosterGroupFilter !== 'ALL' && (app.buddyGroup || '') !== rosterGroupFilter) {
      return false;
    }
    if (rosterStatusFilter === 'TIMED_IN' && !app.isTimedIn) return false;
    if (rosterStatusFilter === 'STALE' && !app.isStaleSession) return false;
    if (rosterStatusFilter === 'OFFLINE' && app.isTimedIn) return false;

    if (rosterSearchTerm) {
      const hay = `${app.fullName} ${app.nickname} ${app.buddyGroup}`.toLowerCase();
      if (!hay.includes(rosterSearchTerm)) return false;
    }
    return true;
  });

  // Apply Column Sorting
  filtered.sort((a, b) => {
    let valA = a[rosterSortField];
    let valB = b[rosterSortField];
    if (typeof valA === 'string') {
      valA = valA.toLowerCase();
      valB = (valB || '').toLowerCase();
      return rosterSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    valA = Number(valA) || 0;
    valB = Number(valB) || 0;
    return rosterSortAsc ? valA - valB : valB - valA;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:16px;">No applicants match the selected filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(app => `
    <tr>
      <td><strong>${app.fullName}</strong> ("${app.nickname}")</td>
      <td>${app.buddyGroup}</td>
      <td style="font-family:var(--font-mono);">${app.completedSigs} / ${app.totalSigs}</td>
      <td style="font-family:var(--font-mono);">${app.tambayHours} hrs</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:var(--brand-forest);">${app.overallPercent}%</td>
      <td>
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="badge" style="background:${app.isTimedIn ? (app.isStaleSession ? '#b33a2b' : 'var(--brand-mint-subtle)') : 'var(--surface-subtle)'}; color:${app.isTimedIn ? (app.isStaleSession ? '#fff' : 'var(--brand-mint)') : 'inherit'};">
            ${app.isTimedIn ? (app.isStaleSession ? '8h+ Timed In' : 'Timed In') : 'Offline'}
          </span>
          ${isRAComm && app.isTimedIn ? `
            <button type="button" class="btn btn-secondary force-close-tambay-btn" data-user-id="${app.id}" data-mode="zero" style="min-height: 24px; padding: 2px 6px; font-size: 0.7rem; color: #b33a2b;">
              Force Out
            </button>
          ` : ''}
        </div>
      </td>
      <td><button class="btn btn-secondary inspect-btn" data-id="${app.id}" style="min-height:32px; padding:2px 8px; font-size:0.75rem;">${isRAComm ? 'Inspect & Grade' : 'View Details'}</button></td>
    </tr>
  `).join('');
}

/* =========================================================
   BUDDY TASK CHECKLIST IN INSPECTION MODAL
   ========================================================= */
async function openInspection(appId) {
  inspectedApplicantId = appId;
  const modal = document.getElementById('adminInspectionModal');
  const [details, events, isRAComm, allBuddyTasks, applicantTaskCompletions, groups] = await Promise.all([
    getApplicantFullDetails(appId),
    getEvents(appId),
    checkIfRAComm(currentUser.email),
    getBuddyTasks(),
    getApplicantBuddyTaskCompletions(appId),
    getManagedBuddyGroups()
  ]);

  if (!details || !modal) return;
  const p = details.profile;

  document.getElementById('inspectApplicantName').textContent = `${p.full_name} ("${p.nickname}")`;
  document.getElementById('inspectApplicantEmail').textContent = `ID: ${p.id} | Balance: ${p.currency ?? 0} AC`;

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

  const appGroup = p.buddy_group_name || 'Unassigned';
  const relevantBuddyTasks = allBuddyTasks.filter(t =>
    t.target_group === 'ALL' || t.target_group.toLowerCase() === appGroup.toLowerCase()
  );
  const completedBuddyTaskSet = new Set(applicantTaskCompletions.map(c => c.task_id));

  const panelsWrapper = document.getElementById('inspectPanelsWrapper');
  if (panelsWrapper) {
    panelsWrapper.innerHTML = `
      <div style="padding: 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); width: 100%; margin-bottom: 8px;">
        <h4 style="margin: 0 0 8px 0; color: var(--brand-forest); font-size: 0.88rem;">Official Events Attendance (5% each)</h4>
        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.82rem;">
          ${events.map(evt => `
            <label style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--surface); border-radius: 4px; border: 1px solid var(--border-subtle); cursor: ${isRAComm ? 'pointer' : 'not-allowed'};">
              <span style="font-size: 0.8rem; color: var(--text-heading);">${evt.name}</span>
              <input type="checkbox" class="admin-event-check" data-event-id="${evt.id}" ${evt.attended ? 'checked' : ''} ${!isRAComm ? 'disabled' : ''} />
            </label>
          `).join('')}
        </div>
      </div>

      <div style="padding: 12px; background: var(--surface-subtle); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); width: 100%; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h4 style="margin: 0; color: var(--brand-forest); font-size: 0.88rem;">Assigned Buddy Tasks Checklist</h4>
          ${isRAComm && relevantBuddyTasks.length > 0 ? `<button type="button" id="autoCalcBuddyScoreBtn" class="btn btn-secondary" style="min-height: 24px; padding: 2px 8px; font-size: 0.7rem;">Auto-Compute 10%</button>` : ''}
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.82rem;">
          ${relevantBuddyTasks.length === 0
            ? '<small class="subtext">No buddy tasks assigned to this group yet.</small>'
            : relevantBuddyTasks.map(bt => `
              <label style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--surface); border-radius: 4px; border: 1px solid var(--border-subtle); cursor: ${isRAComm ? 'pointer' : 'not-allowed'};">
                <span style="font-size: 0.8rem; color: var(--text-heading);">${bt.title} <small style="color: var(--text-muted);">(${bt.target_group})</small></span>
                <input type="checkbox" class="admin-buddy-task-check" data-task-id="${bt.id}" ${completedBuddyTaskSet.has(bt.id) ? 'checked' : ''} ${!isRAComm ? 'disabled' : ''} />
              </label>
            `).join('')
          }
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

      panelsWrapper.querySelectorAll('.admin-buddy-task-check').forEach(chk => {
        chk.addEventListener('change', async (e) => {
          const taskId = e.target.dataset.taskId;
          const checked = e.target.checked;
          const ok = await toggleBuddyTaskCompletion(taskId, inspectedApplicantId, checked, currentUser.email);
          if (ok) {
            showToast(`Buddy task marked as ${checked ? 'completed' : 'pending'}.`, 'success');
          } else {
            showToast('Failed to update buddy task completion.', 'error');
            e.target.checked = !checked;
          }
        });
      });

      document.getElementById('autoCalcBuddyScoreBtn')?.addEventListener('click', () => {
        const allChecks = Array.from(panelsWrapper.querySelectorAll('.admin-buddy-task-check'));
        if (allChecks.length === 0) return;
        const checkedCount = allChecks.filter(c => c.checked).length;
        const computedScore = Number(((checkedCount / allChecks.length) * 10).toFixed(2));
        const buddyInput = document.getElementById('gradeBuddyInput');
        if (buddyInput) {
          buddyInput.value = computedScore;
          showToast(`Computed ${checkedCount}/${allChecks.length} tasks = ${computedScore}% (Click Save Evaluation Scores to apply)`, 'info');
        }
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
      await openVerificationPreviewModal(code);
    }

    const [isMember, isRAComm] = await Promise.all([
      checkIfResidentMember(currentUser.email),
      checkIfRAComm(currentUser.email)
    ]);

    if (isMember || isRAComm) {
      if (badge) badge.textContent = isRAComm ? 'RAComm Officer' : 'Resident Member';
      if (onboardSec) onboardSec.style.display = 'none';
      if (appDash) appDash.style.display = 'none';
      if (memDash) memDash.style.display = 'block';

      injectMemberQrScannerUI();

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

        await Promise.all([
          renderBuddyGroupBoard(),
          renderOfficerEventSchedules()
        ]);
      } else {
        document.querySelectorAll('#racommTabNav .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tab="member-hub-view"]')?.classList.add('active');

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
      
      await Promise.all([
        renderRoster(),
        renderOfficerBuddyTasksManager(),
        renderLeaderboard(),
        renderLiveTambayanPresence(),
        renderMemberPersonalActivityCard()
      ]);

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

        await Promise.all([
          renderDashboard(),
          renderApplicantBuddyTasks(profile.buddy_group_name),
          renderShopView(),
          renderLeaderboard()
        ]);
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
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          debounceTask('profiles', async () => {
            await Promise.all([renderRoster(), renderBuddyGroupBoard(), renderDashboard(), renderLeaderboard()]);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => {
          debounceTask('members', async () => {
            await renderBuddyGroupBoard();
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'signatories' }, (payload) => {
          if (payload?.new?.user_id === currentUser?.id && payload?.new?.completed) {
            autoCloseQrDisplayIfOpen();
          }
          debounceTask('signatories', async () => {
            showToast('Signatory matrix updated.', 'info');
            await Promise.all([renderDashboard(), renderLeaderboard(), renderMemberPersonalActivityCard()]);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_attendees' }, () => {
          debounceTask('events', async () => {
            showToast('Event attendance updated.', 'info');
            await Promise.all([renderDashboard(), renderRoster(), renderLeaderboard()]);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'buddy_tasks' }, () => {
          debounceTask('buddy_tasks', async () => {
            const profile = await getUserProfileData(currentUser?.id);
            await Promise.all([
              renderApplicantBuddyTasks(profile?.buddy_group_name),
              renderOfficerBuddyTasksManager(),
              renderShopView()
            ]);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_contributions' }, () => {
          debounceTask('task_contributions', () => renderShopView());
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'buddy_task_completions' }, () => {
          debounceTask('buddy_task_completions', async () => {
            const profile = await getUserProfileData(currentUser?.id);
            await renderApplicantBuddyTasks(profile?.buddy_group_name);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
          debounceTask('announcements', async () => {
            showToast('New announcement posted.', 'info');
            const profile = await getUserProfileData(currentUser?.id);
            await Promise.all([
              renderAnnouncementsBoard(),
              renderPinnedOverviewAnnouncement(profile?.buddy_group_name)
            ]);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_slots' }, () => {
          debounceTask('availability', () => renderWhen2Meet());
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tambay_sessions' }, (payload) => {
          if (payload?.new?.user_id === currentUser?.id || payload?.old?.user_id === currentUser?.id) {
            autoCloseQrDisplayIfOpen();
          }
          debounceTask('tambay_sessions', async () => {
            await Promise.all([
              renderDashboard(),
              renderRoster(),
              renderLiveTambayanPresence(),
              renderMemberPersonalActivityCard()
            ]);
          });
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, async (payload) => {
          if (payload.new.user_id === currentUser?.id) {
            autoCloseQrDisplayIfOpen();
            showToast(payload.new.message, 'info');
            const badge = document.getElementById('notifBadge');
            if (badge) {
              badge.style.display = 'block';
              badge.textContent = parseInt(badge.textContent || 0, 10) + 1;
            }
          }
        })
        .subscribe();
    }

    // Global Delegated Handler for Copy Buttons & RAComm Force-Close Tambay Buttons
    document.addEventListener('click', async (e) => {
      const forceBtn = e.target.closest('.force-close-tambay-btn');
      if (forceBtn && currentUser) {
        const targetUid = forceBtn.dataset.userId;
        const mode = forceBtn.dataset.mode;
        let creditHrs = 0;

        if (mode === 'custom') {
          const val = prompt('Enter tambay hours to credit for this session (e.g. 1.5, or 0 for forgotten time-out):', '1.0');
          if (val === null) return;
          creditHrs = Math.max(0, parseFloat(val) || 0);
        } else {
          if (!confirm('Force-close this active tambay session with 0 hours credited?')) return;
        }

        const ok = await adminForceCloseTambaySession(targetUid, creditHrs, currentUser.email);
        if (ok) {
          showToast(`Session closed (${creditHrs} hrs credited).`, 'success');
          await Promise.all([renderLiveTambayanPresence(), renderRoster(), renderDashboard()]);
        } else {
          showToast('Failed to force-close session.', 'error');
        }
        return;
      }

      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      const target = document.getElementById(btn.dataset.copyTarget);
      const text = target?.textContent?.trim();
      if (!text || text === '------' || text === 'EXPIRED') return;

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

        if (tabId !== 'member-hub-view' && isQrScannerRunning) {
          await stopInAppQrScanner();
        }

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

        document.querySelectorAll('.tab-content').forEach(c => {
          c.style.display = 'none';
          c.classList.remove('active');
        });

        const target = document.getElementById(tabId);
        if (target) {
          target.style.display = 'block';
          target.classList.add('active');

          if (tabId === 'tab-schedule') {
            await Promise.all([renderAnnouncementsBoard(), renderWhen2Meet()]);
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
          } else if (tabId === 'tab-tambay') {
            await Promise.all([renderLiveTambayanPresence(), renderApplicantTambayHistoryAndPace()]);
          } else if (tabId === 'member-hub-view') {
            await Promise.all([renderLiveTambayanPresence(), renderMemberPersonalActivityCard()]);
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
      if (valModal) valModal.style.display = 'none';
      await openVerificationPreviewModal(code);
    });

    document.getElementById('showQrBtn')?.addEventListener('click', async () => {
      const container = document.getElementById('qrDisplayContainer');
      const canvas = document.getElementById('qrcodeCanvas');
      const text = document.getElementById('applicantShortCodeText');

      const [activeSession, code] = await Promise.all([
        getActiveTambaySession(currentUser.id),
        generateApplicantShortCode(null, 'TAMBAY')
      ]);
      const isTimingOut = !!activeSession;

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
      startQrCodeCountdown('TAMBAY', null);
    });

    document.getElementById('closeQrBtn')?.addEventListener('click', () => {
      const container = document.getElementById('qrDisplayContainer');
      if (container) container.style.display = 'none';
      if (qrCountdownInterval) clearInterval(qrCountdownInterval);
    });

    /* Notification Bell Handler */
    document.getElementById('notificationBellBtn')?.addEventListener('click', async () => {
      if (!currentUser) return;
      
      const notifs = await fetchAndClearNotifications(currentUser.id);
      
      const badge = document.getElementById('notifBadge');
      if (badge) {
        badge.style.display = 'none';
        badge.textContent = '0';
      }
      
      if (notifs && notifs.length > 0) {
        notifs.forEach((notif, index) => {
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
      showToast('Leaderboard refreshed.', 'info');
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
        showToast('All available traits from the pool are already assigned to you.', 'error');
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
        showToast('Buddy task published successfully.', 'success');
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
        document.getElementById('currentMultiplierText').textContent = '1.0x';
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('set2xBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('hourly_multiplier', '2.0')) {
        showToast('Multiplier set to 2.0x', 'success');
        const settings = await getGlobalSettings();
        document.getElementById('currentMultiplierText').textContent = '2.0x';
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('enableCapBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('daily_cap_enabled', 'true')) {
        showToast('Daily cap enabled', 'info');
        const settings = await getGlobalSettings();
        document.getElementById('currentCapText').textContent = 'Active';
        updateSettingsButtons(settings.multiplier, settings.dailyCapEnabled, settings.memberSigLimitEnabled);
      }
    });

    document.getElementById('disableCapBtn')?.addEventListener('click', async () => {
      if (await updateGlobalSettings('daily_cap_enabled', 'false')) {
        showToast('Daily cap removed', 'info');
        const settings = await getGlobalSettings();
        document.getElementById('currentCapText').textContent = 'Disabled';
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
          showToast('Event schedule updated.', 'success');
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
          await Promise.all([renderBuddyGroupBoard(), renderRoster()]);
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
          showToast(`Assigned to ${groupName}.`, 'success');
          await Promise.all([renderRoster(), renderBuddyGroupBoard()]);
        }
      }
    });

    document.getElementById('postAnnouncementBtn')?.addEventListener('click', async () => {
      const titleIn = document.getElementById('announcementTitleInput');
      const contentIn = document.getElementById('announcementContentInput');
      const targetSelect = document.getElementById('announcementTargetGroupSelect');
      if (!titleIn?.value.trim() || !contentIn?.value.trim()) return;

      const targetVal = targetSelect?.value && targetSelect.value !== 'ALL' ? targetSelect.value : null;

      if (await createAnnouncement(titleIn.value.trim(), contentIn.value.trim(), currentUser.email, targetVal)) {
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
      rosterSearchTerm = e.target.value.toLowerCase().trim();
      renderRoster();
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
        await Promise.all([openInspection(inspectedApplicantId), renderRoster()]);
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
          await Promise.all([renderRoster(), renderBuddyGroupBoard()]);
        } else {
          showToast('Failed to delete applicant profile.', 'error');
        }
      }
    });

    document.getElementById('adminExportPdfBtn')?.addEventListener('click', async () => {
      const win = window.open('', '_blank');
      if (!win) {
        showToast('Popup blocked. Please allow popups for this site.', 'error');
        return;
      }
      
      win.document.write('<h3 style="font-family: sans-serif; color: #1b382b;">Loading report...</h3>');

      const details = await getApplicantFullDetails(inspectedApplicantId);
      if (!details) {
        win.close();
        return;
      }
      
      const p = details.profile;
      
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
