import { CONFIG } from './config.js';
import { 
  supabase, getBuddyGroupMembers, spendCurrency,
  getActiveTambaySession, validateApplicantTambay,
  checkIfResidentMember, checkIfRAComm, getGlobalSettings, updateGlobalSettings,
  createEvent, COMMITTEES_LIST, generateApplicantShortCode, getApplicantIdByShortCode,
  getAllApplicantsProgress
} from './storage.js';
import { getSignatories, toggleSignatoryTask } from './signatories.js';
import { getTambayHours } from './tambay.js';
import { getEvents, checkInToEvent } from './events.js';
import { signInWithGoogle, signOutUser, getCurrentUser, getUserProfileData, createApplicantProfile } from './auth.js';

let currentUser = null;
let timerInterval = null;

// ==========================================
// 2026 TOAST NOTIFICATION SYSTEM (Trend #1)
// ==========================================
export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    alert(message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button style="background:none; border:none; color:inherit; cursor:pointer; font-weight:bold;">&times;</button>
  `;

  toast.querySelector('button').onclick = () => toast.remove();

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

function startLiveTimer(timeInIso) {
  if (timerInterval) clearInterval(timerInterval);

  const timerElem = document.getElementById('liveTimerDisplay');
  const startTime = new Date(timeInIso).getTime();

  function updateTimer() {
    const now = new Date().getTime();
    const diff = now - startTime;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n) => String(n).padStart(2, '0');
    if (timerElem) {
      timerElem.textContent = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
    }
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopLiveTimer() {
  if (timerInterval) clearInterval(timerInterval);
}

async function calculateProgress() {
  const signatories = await getSignatories();
  const tambayHours = await getTambayHours();
  const events = await getEvents();

  const totalTasks = signatories.length;
  const completedTasks = signatories.filter(s => s.completed).length;
  const sigRatio = totalTasks > 0 ? (completedTasks / totalTasks) : 0;

  const tambayRatio = Math.min(tambayHours / CONFIG.TARGET_TAMBAY_HOURS, 1);

  const totalEvents = events.length;
  const attendedEvents = events.filter(e => e.attended).length;
  const eventRatio = totalEvents > 0 ? (attendedEvents / totalEvents) : 0;

  const total = Math.round(
    (sigRatio * CONFIG.WEIGHTS.SIGNATORIES + 
     tambayRatio * CONFIG.WEIGHTS.TAMBAY + 
     eventRatio * CONFIG.WEIGHTS.EVENTS) * 100
  );

  return { 
    total, 
    sigCompleted: completedTasks, 
    sigTotal: totalTasks, 
    tambayHours, 
    eventsAttended: attendedEvents, 
    eventsTotal: totalEvents,
    signatoriesList: signatories,
    eventsList: events
  };
}

// DYNAMIC RACOMM ROSTER RENDERER
async function renderApplicantRosterTable() {
  const tbody = document.getElementById('applicantRosterTbody');
  const totalApplicantsElem = document.getElementById('statTotalApplicants');
  const avgProgressElem = document.getElementById('statAvgProgress');
  const totalTambayElem = document.getElementById('statTotalTambay');
  const activeTambayElem = document.getElementById('statActiveTambay');

  if (!tbody) return;

  const applicants = await getAllApplicantsProgress();

  if (totalApplicantsElem) totalApplicantsElem.textContent = applicants.length;
  
  if (applicants.length > 0) {
    const avgProg = Math.round(applicants.reduce((sum, a) => sum + a.overallPercent, 0) / applicants.length);
    const sumTambay = applicants.reduce((sum, a) => sum + Number(a.tambayHours), 0);
    const activeCount = applicants.filter(a => a.isTimedIn).length;

    if (avgProgressElem) avgProgressElem.textContent = `${avgProg}%`;
    if (totalTambayElem) totalTambayElem.textContent = `${sumTambay.toFixed(1)} hrs`;
    if (activeTambayElem) activeTambayElem.textContent = activeCount;
  }

  tbody.innerHTML = '';

  if (applicants.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 16px; color: var(--text-muted);">
          No applicants registered yet.
        </td>
      </tr>
    `;
    return;
  }

  applicants.forEach(app => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-subtle)';
    tr.innerHTML = `
      <td style="padding: 10px 14px;"><strong>${app.fullName}</strong> ("${app.nickname}")</td>
      <td style="padding: 10px 14px;">${app.buddyGroup}</td>
      <td style="padding: 10px 14px; font-family: monospace;">${app.completedSigs} / ${app.totalSigs}</td>
      <td style="padding: 10px 14px; font-family: monospace;">${app.tambayHours} hrs</td>
      <td style="padding: 10px 14px;">0 Attended</td>
      <td style="padding: 10px 14px; font-family: monospace;">
        <strong style="color: var(--brand-forest);">${app.overallPercent}%</strong>
      </td>
      <td style="padding: 10px 14px;">
        ${app.isTimedIn ? `
          <span class="badge" style="background: #e8f5e9; color: #1b5e20; border: 1px solid #2e7d32;">🟢 Timed In</span>
        ` : `
          <span class="badge">Offline</span>
        `}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

export async function render() {
  const stats = await calculateProgress();

  const progressBar = document.getElementById('progressBar');
  if (progressBar) {
    progressBar.style.width = `${stats.total}%`;
    progressBar.textContent = `${stats.total}%`;
  }

  const sigBadge = document.getElementById('signatoryBadge');
  if (sigBadge) sigBadge.textContent = `${stats.sigCompleted} / ${stats.sigTotal} Done`;

  const tambayBadge = document.getElementById('tambayBadge');
  if (tambayBadge) tambayBadge.textContent = `${stats.tambayHours} / ${CONFIG.TARGET_TAMBAY_HOURS} hrs`;

  const eventBadge = document.getElementById('eventBadge');
  if (eventBadge) eventBadge.textContent = `${stats.eventsAttended} / ${stats.eventsTotal} Attended`;

  if (currentUser) {
    const activeSession = await getActiveTambaySession(currentUser.id);
    const activeBanner = document.getElementById('activeTambayBanner');
    const memberBadge = document.getElementById('timeInMemberBadge');

    if (activeSession && activeBanner) {
      activeBanner.style.display = 'block';
      if (memberBadge) memberBadge.textContent = `By: ${activeSession.scanned_by_in}`;
      startLiveTimer(activeSession.time_in);
    } else if (activeBanner) {
      activeBanner.style.display = 'none';
      stopLiveTimer();
    }
  }

  const sigList = document.getElementById('signatoryList');
  if (sigList) {
    sigList.innerHTML = '';

    COMMITTEES_LIST.forEach(comm => {
      const commSection = document.createElement('div');
      commSection.style.marginBottom = '16px';
      commSection.style.padding = '12px';
      commSection.style.border = '1px solid var(--border-subtle)';
      commSection.style.borderRadius = 'var(--radius-sm)';
      commSection.style.background = 'var(--surface-subtle)';

      commSection.innerHTML = `<h4 style="color: var(--brand-forest); margin-bottom: 8px;">🏛️ ${comm.name} Committee</h4>`;

      const commSigs = stats.signatoriesList.filter(s => s.committee_name === comm.name);
      const member1 = commSigs.find(s => s.type === 'MEMBER_1');
      const member2 = commSigs.find(s => s.type === 'MEMBER_2');

      const isVpUnlocked = member1?.completed && member2?.completed;

      commSigs.forEach(item => {
        const isVpTask = item.type === 'VP';
        const isLocked = isVpTask && !isVpUnlocked;

        const li = document.createElement('li');
        li.className = 'task-item';
        li.style.background = isLocked ? '#f5f5f5' : 'white';
        li.style.opacity = isLocked ? '0.6' : '1.0';

        li.innerHTML = `
          <div class="task-info">
            <strong>${isVpTask ? `👑 ${comm.vp}` : `👤 Member Task (${item.type === 'MEMBER_1' ? '#1' : '#2'})`}</strong>
            <small style="display: block; margin-top: 2px;">${item.trait_description}</small>
            <small style="color: var(--brand-forest); font-weight: 600;">Task: ${item.task_description}</small>
          </div>
          ${isLocked ? `
            <span class="badge" style="background: #e0e0e0; color: #666;">🔒 Locked</span>
          ` : `
            <input 
              type="checkbox" 
              ${item.completed ? 'checked' : ''} 
              data-id="${item.id}" 
              data-completed="${item.completed}"
              class="sig-checkbox" 
            />
          `}
        `;
        commSection.appendChild(li);
      });

      sigList.appendChild(commSection);
    });
  }

  const eventList = document.getElementById('eventList');
  if (eventList) {
    eventList.innerHTML = '';
    stats.eventsList.forEach(evt => {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.innerHTML = `
        <div class="task-info">
          <strong>${evt.name}</strong>
          <small>${evt.attended ? '✅ Attended' : '❌ Not Attended'}</small>
        </div>
        ${!evt.attended ? `
          <div style="display: flex; gap: 4px;">
            <input type="text" id="pass-${evt.id}" placeholder="Passcode" style="width: 100px; padding: 4px;" />
            <button class="btn btn-checkin" data-event-id="${evt.id}">Check In</button>
          </div>
        ` : '<span>Done</span>'}
      `;
      eventList.appendChild(li);
    });
  }
}

async function checkAndProcessUrlValidation(user) {
  const urlParams = new URLSearchParams(window.location.search);
  const validateApplicantId = urlParams.get('validateApplicant');

  if (validateApplicantId && user) {
    window.history.replaceState({}, document.title, window.location.pathname);
    const result = await validateApplicantTambay(validateApplicantId, user.email);
    showToast(result.message, result.success ? 'success' : 'error');
  }
}

async function handleAuthState() {
  currentUser = await getCurrentUser();

  const authSection = document.getElementById('authSection');
  const onboardingSection = document.getElementById('onboardingSection');
  const applicantDashboard = document.getElementById('applicantDashboardContent');
  const memberDashboard = document.getElementById('memberDashboardContent');
  const racommPanel = document.getElementById('racommPanel');
  const userProfileBar = document.getElementById('userProfileBar');
  const userEmailText = document.getElementById('userEmailText');
  const roleBadgeHeader = document.getElementById('roleBadgeHeader');

  if (currentUser) {
    if (authSection) authSection.style.display = 'none';
    if (userProfileBar) userProfileBar.style.display = 'flex';
    if (userEmailText) userEmailText.textContent = currentUser.email;

    await checkAndProcessUrlValidation(currentUser);

    const isMember = await checkIfResidentMember(currentUser.email);
    const isRAComm = await checkIfRAComm(currentUser.email);

    if (isMember || isRAComm) {
      if (onboardingSection) onboardingSection.style.display = 'none';
      if (applicantDashboard) applicantDashboard.style.display = 'none';
      if (memberDashboard) memberDashboard.style.display = 'block';

      if (roleBadgeHeader) {
        roleBadgeHeader.textContent = isRAComm ? 'RAComm Officer' : 'Resident Member';
        roleBadgeHeader.style.background = 'var(--brand-forest)';
      }

      if (racommPanel) {
        racommPanel.style.display = isRAComm ? 'block' : 'none';
      }

      if (isRAComm) {
        const settings = await getGlobalSettings();
        const multText = document.getElementById('currentMultiplierText');
        const capText = document.getElementById('currentCapText');

        if (multText) multText.textContent = `${settings.multiplier}x`;
        if (capText) capText.textContent = settings.dailyCapEnabled ? 'Active (3.0 hrs/day)' : 'Disabled (No Limit)';

        // RENDER LIVE APPLICANT ROSTER TABLE
        await renderApplicantRosterTable();
      }
    } else {
      if (memberDashboard) memberDashboard.style.display = 'none';

      if (roleBadgeHeader) {
        roleBadgeHeader.textContent = 'Applicant';
        roleBadgeHeader.style.background = '#0288d1';
      }

      const profile = await getUserProfileData(currentUser.id);

      if (!profile) {
        if (onboardingSection) onboardingSection.style.display = 'block';
        if (applicantDashboard) applicantDashboard.style.display = 'none';
      } else {
        if (onboardingSection) onboardingSection.style.display = 'none';
        if (applicantDashboard) applicantDashboard.style.display = 'block';

        const nicknameElem = document.getElementById('userNicknameHeading');
        const currencyElem = document.getElementById('userCurrencyText');
        const groupNameElem = document.getElementById('buddyGroupName');

        if (nicknameElem) nicknameElem.textContent = `Welcome, ${profile.nickname}! 👋`;
        if (currencyElem) currencyElem.textContent = profile.currency;
        if (groupNameElem) groupNameElem.textContent = profile.buddy_group_name;

        const buddies = await getBuddyGroupMembers(profile.buddy_group_name);
        const buddyList = document.getElementById('buddyList');
        const buddyCountBadge = document.getElementById('buddyCountBadge');

        if (buddyCountBadge) buddyCountBadge.textContent = `${buddies.length} Members`;
        if (buddyList) {
          buddyList.innerHTML = '';
          buddies.forEach(buddy => {
            const li = document.createElement('li');
            li.className = 'task-item';
            li.innerHTML = `
              <div class="task-info">
                <strong>${buddy.full_name}</strong>
                <small>Nickname: "${buddy.nickname}"</small>
              </div>
              <span class="badge">Buddy</span>
            `;
            buddyList.appendChild(li);
          });
        }

        await render();
      }
    }
  } else {
    if (authSection) authSection.style.display = 'block';
    if (onboardingSection) onboardingSection.style.display = 'none';
    if (applicantDashboard) applicantDashboard.style.display = 'none';
    if (memberDashboard) memberDashboard.style.display = 'none';
    if (userProfileBar) userProfileBar.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await handleAuthState();

  if (supabase) {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (window.location.hash.includes('access_token')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        await handleAuthState();
      }
    });
  }

  // Show QR Code & Short Code
  document.getElementById('showQrBtn')?.addEventListener('click', async () => {
    if (!currentUser) return;

    const qrContainer = document.getElementById('qrDisplayContainer');
    const qrCanvas = document.getElementById('qrcodeCanvas');
    const codeText = document.getElementById('applicantShortCodeText');

    if (qrContainer && qrCanvas) {
      qrCanvas.innerHTML = '';
      if (codeText) codeText.textContent = '...';

      const shortCode = await generateApplicantShortCode();
      if (codeText) codeText.textContent = shortCode || 'ERROR';

      const baseUrl = window.location.origin + window.location.pathname;
      const validationUrl = `${baseUrl}?validateApplicant=${currentUser.id}`;

      new QRCode(qrCanvas, {
        text: validationUrl,
        width: 180,
        height: 180,
        colorDark: "#0d2e20",
        colorLight: "#ffffff"
      });

      qrContainer.style.display = 'block';
    }
  });

  document.getElementById('closeQrBtn')?.addEventListener('click', () => {
    const qrContainer = document.getElementById('qrDisplayContainer');
    if (qrContainer) qrContainer.style.display = 'none';
  });

  // Modal Handlers for Manual Short Code Entry
  const closeModal = () => {
    const modal = document.getElementById('manualCodeModal');
    if (modal) modal.style.display = 'none';
  };

  document.getElementById('manualValidateBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('manualCodeModal');
    const input = document.getElementById('manualCodeInput');
    if (modal) {
      modal.style.display = 'flex';
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  });

  document.getElementById('closeModalBtn')?.addEventListener('click', closeModal);
  document.getElementById('cancelManualCodeBtn')?.addEventListener('click', closeModal);

  // Submit Short Code with Believable Friction Delay (350ms)
  document.getElementById('submitManualCodeBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('manualCodeInput');
    const submitBtn = document.getElementById('submitManualCodeBtn');
    if (!input || !currentUser) return;

    const cleanInput = input.value.trim().toUpperCase();

    if (cleanInput.length < 6) {
      showToast('Please enter a valid 6-character code.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying Code...';
    }

    await new Promise(resolve => setTimeout(resolve, 350));

    const applicantId = await getApplicantIdByShortCode(cleanInput);

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Validate Code 🚀';
    }

    if (applicantId) {
      closeModal();
      const res = await validateApplicantTambay(applicantId, currentUser.email);
      showToast(res.message, res.success ? 'success' : 'error');
      await handleAuthState();
    } else {
      showToast('Invalid or expired code. Please ask the applicant to regenerate their code.', 'error');
    }
  });

  document.getElementById('onboardingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullNameInput = document.getElementById('onboardFullName');
    const nicknameInput = document.getElementById('onboardNickname');

    if (currentUser && fullNameInput && nicknameInput) {
      const created = await createApplicantProfile(currentUser.id, fullNameInput.value, nicknameInput.value);
      if (created) {
        showToast('Profile created successfully!', 'success');
        await handleAuthState();
      }
    }
  });

  document.getElementById('loginGoogleBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);

  document.getElementById('buyDeadlineBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(30, 'Deadline Extension (+2 Days)')) {
      showToast('Redeemed Deadline Extension (+2 Days)!', 'success');
      await handleAuthState();
    }
  });

  document.getElementById('buyTaskSwapBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(50, 'Signatory Task Swap')) {
      showToast('Redeemed Signatory Task Swap!', 'success');
      await handleAuthState();
    }
  });

  document.getElementById('signatoryList')?.addEventListener('change', async (e) => {
    if (e.target.classList.contains('sig-checkbox')) {
      const taskId = e.target.dataset.id;
      const currentStatus = e.target.dataset.completed === 'true';
      await toggleSignatoryTask(taskId, currentStatus);
      showToast('Task updated!', 'info');
      await render();
    }
  });

  document.getElementById('eventList')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-checkin')) {
      const eventId = e.target.dataset.eventId;
      const passInput = document.getElementById(`pass-${eventId}`);
      if (passInput && await checkInToEvent(eventId, passInput.value)) {
        showToast('Event Attendance Verified! +2.0 hours credited.', 'success');
        await render();
      }
    }
  });

  document.getElementById('set1xBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('hourly_multiplier', '1.0')) {
      showToast('Multiplier set to 1.0x (Standard)', 'info');
      await handleAuthState();
    }
  });

  document.getElementById('set2xBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('hourly_multiplier', '2.0')) {
      showToast('⚡ Double Hours Activated! (2.0x)', 'success');
      await handleAuthState();
    }
  });

  document.getElementById('enableCapBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('daily_cap_enabled', 'true')) {
      showToast('Daily Cap Enabled (3.0 Hours Max)', 'info');
      await handleAuthState();
    }
  });

  document.getElementById('disableCapBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('daily_cap_enabled', 'false')) {
      showToast('Daily Cap Removed! (Unlimited Hours)', 'success');
      await handleAuthState();
    }
  });

  document.getElementById('addEventBtn')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('adminEventNameInput');
    const passkeyInput = document.getElementById('adminEventPasskeyInput');
    if (nameInput && await createEvent(nameInput.value, passkeyInput ? passkeyInput.value : '')) {
      nameInput.value = '';
      if (passkeyInput) passkeyInput.value = '';
      showToast('Event created successfully!', 'success');
      await handleAuthState();
    }
  });
});
