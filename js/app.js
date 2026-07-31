import { CONFIG } from './config.js';
import { 
  supabase, getBuddyGroupMembers, spendCurrency,
  getActiveTambaySession, validateApplicantTambay, verifyUniversalCode,
  checkIfResidentMember, checkIfRAComm, getGlobalSettings, updateGlobalSettings,
  createEvent, COMMITTEES_LIST, generateApplicantShortCode,
  getAllApplicantsProgress, getApplicantFullDetails, deleteApplicantProfile,
  adminAdjustTambayHours, adminAdjustTokens, adminToggleApplicantSignatory,
  getSignatories, getTambayHours, getEvents
} from './storage.js';

import { renderSignatoriesTab } from './signatories.js';
import { checkInToEvent } from './events.js';
import { signInWithGoogle, signOutUser, getCurrentUser, getUserProfileData, createApplicantProfile } from './auth.js';

let currentUser = null;
let timerInterval = null;
let currentInspectedApplicantId = null;

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

  const totalTasks = signatories.length || 18;
  const completedTasks = signatories.filter(s => s.completed).length;
  const sigRatio = totalTasks > 0 ? (completedTasks / totalTasks) : 0;

  const tambayRatio = Math.min(tambayHours / (CONFIG?.TARGET_TAMBAY_HOURS || 15), 1);

  const totalEvents = events.length;
  const attendedEvents = events.filter(e => e.attended).length;
  const eventRatio = totalEvents > 0 ? (attendedEvents / totalEvents) : 0;

  const total = Math.round(
    (sigRatio * (CONFIG?.WEIGHTS?.SIGNATORIES || 0.50) + 
     tambayRatio * (CONFIG?.WEIGHTS?.TAMBAY || 0.35) + 
     eventRatio * (CONFIG?.WEIGHTS?.EVENTS || 0.15)) * 100
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

async function renderApplicantRosterTable() {
  const tbody = document.getElementById('applicantRosterTbody');
  if (!tbody) return;

  const applicants = await getAllApplicantsProgress();
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
      <td style="padding: 10px 14px; font-family: var(--font-mono);">${app.completedSigs} / ${app.totalSigs}</td>
      <td style="padding: 10px 14px; font-family: var(--font-mono);">${app.tambayHours} hrs</td>
      <td style="padding: 10px 14px; font-family: var(--font-mono);">
        <strong style="color: var(--brand-forest);">${app.overallPercent}%</strong>
      </td>
      <td style="padding: 10px 14px;">
        ${app.isTimedIn ? `<span class="badge" style="background: #e8f5e9; color: #1b5e20;">Timed In</span>` : `<span class="badge">Offline</span>`}
      </td>
      <td style="padding: 10px 14px;">
        <button class="btn btn-secondary inspect-app-btn" data-id="${app.id}" style="padding: 4px 10px; font-size: 0.78rem;">Inspect</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function openApplicantInspectionModal(applicantId) {
  currentInspectedApplicantId = applicantId;
  const modal = document.getElementById('adminInspectionModal');
  const details = await getApplicantFullDetails(applicantId);

  if (!details || !details.profile || !modal) return;

  document.getElementById('inspectApplicantName').textContent = `${details.profile.full_name} ("${details.profile.nickname}")`;
  document.getElementById('inspectApplicantEmail').textContent = `ID: ${details.profile.id} | Tokens: ${details.profile.currency}`;

  const sigListElem = document.getElementById('inspectSignatoriesList');
  sigListElem.innerHTML = '';

  (details.signatories || []).forEach(sig => {
    const row = document.createElement('div');
    row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border: 1px solid var(--border-subtle); border-radius: 4px; background: white; font-size: 0.82rem;";
    row.innerHTML = `
      <div>
        <strong>[${sig.committee_name}] ${sig.type}</strong>: ${sig.trait_description}
      </div>
      <input type="checkbox" ${sig.completed ? 'checked' : ''} data-sig-id="${sig.id}" class="admin-sig-toggle" />
    `;
    sigListElem.appendChild(row);
  });

  const tambayElem = document.getElementById('inspectTambayLogsList');
  tambayElem.innerHTML = (details.tambayLogs || []).length === 0 ? '<small style="color: var(--text-muted);">No tambay logs recorded yet.</small>' : '';

  (details.tambayLogs || []).forEach(log => {
    const logItem = document.createElement('div');
    logItem.style.fontSize = '0.8rem';
    logItem.style.marginBottom = '4px';
    logItem.textContent = `+${log.hours} hrs logged on ${new Date(log.created_at).toLocaleString()}`;
    tambayElem.appendChild(logItem);
  });

  modal.style.display = 'flex';
}

export async function render() {
  const stats = await calculateProgress();

  const progressBar = document.getElementById('progressBar');
  if (progressBar) {
    progressBar.style.width = `${stats.total}%`;
    progressBar.textContent = `${stats.total}%`;
  }

  const overviewProg = document.getElementById('overviewProgressText');
  if (overviewProg) overviewProg.textContent = `${stats.total}%`;

  const overviewSig = document.getElementById('overviewSigText');
  if (overviewSig) overviewSig.textContent = `${stats.sigCompleted}/${stats.sigTotal}`;

  const overviewTambay = document.getElementById('overviewTambayText');
  if (overviewTambay) overviewTambay.textContent = `${stats.tambayHours.toFixed(1)}`;

  const sigBadge = document.getElementById('signatoryBadge');
  if (sigBadge) sigBadge.textContent = `${stats.sigCompleted} / ${stats.sigTotal} Done`;

  const tambayBadge = document.getElementById('tambayBadge');
  if (tambayBadge) tambayBadge.textContent = `${stats.tambayHours} / ${CONFIG?.TARGET_TAMBAY_HOURS || 15} hrs`;

  const eventBadge = document.getElementById('eventBadge');
  if (eventBadge) eventBadge.textContent = `${stats.eventsAttended} / ${stats.eventsTotal} Attended`;

  if (currentUser) {
    const activeSession = await getActiveTambaySession(currentUser.id);
    const activeBanner = document.getElementById('activeTambayBanner');
    const memberBadge = document.getElementById('timeInMemberBadge');

    if (activeSession && activeBanner) {
      activeBanner.style.display = 'block';
      if (memberBadge) memberBadge.textContent = `Verified by: ${activeSession.scanned_by_in}`;
      startLiveTimer(activeSession.time_in);
    } else if (activeBanner) {
      activeBanner.style.display = 'none';
      stopLiveTimer();
    }
  }

  const signatoriesTabContainer = document.getElementById('signatoriesTab') || document.getElementById('signatoryList');
  if (signatoriesTabContainer) {
    await renderSignatoriesTab(signatoriesTabContainer);
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
          <small>${evt.attended ? 'Attended' : 'Pending'}</small>
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

function setupRealtimeListeners() {
  if (!supabase) return;

  supabase
    .channel('public-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'signatories' },
      async () => {
        showToast('Signatory matrix updated live!', 'success');
        await render();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tambay_sessions' },
      async () => {
        await render();
      }
    )
    .subscribe();
}

async function checkAndProcessUrlValidation(user) {
  const urlParams = new URLSearchParams(window.location.search);
  const verifyCode = urlParams.get('verifyCode') || urlParams.get('validateApplicant');

  if (verifyCode && user) {
    window.history.replaceState({}, document.title, window.location.pathname);
    const result = await verifyUniversalCode(verifyCode, user.email);
    showToast(result.message, result.success ? 'success' : 'error');
    if (result.success) await render();
  }
}

async function handleAuthState() {
  currentUser = await getCurrentUser();

  const authSection = document.getElementById('authSection');
  const onboardingSection = document.getElementById('onboardingSection');
  const applicantDashboard = document.getElementById('applicantDashboardContent');
  const memberDashboard = document.getElementById('memberDashboardContent');
  const racommTabNav = document.getElementById('racommTabNav');
  const userProfileBar = document.getElementById('userProfileBar');
  const userEmailText = document.getElementById('userEmailText');
  const userAvatarHeader = document.getElementById('userAvatarHeader');
  const userAvatarHero = document.getElementById('userAvatarHero');
  const roleBadgeHeader = document.getElementById('roleBadgeHeader');

  if (currentUser) {
    if (authSection) authSection.style.display = 'none';
    if (userProfileBar) userProfileBar.style.display = 'flex';
    if (userEmailText) userEmailText.textContent = currentUser.email;

    const avatarUrl = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || 'logo.png.jpg';
    if (userAvatarHeader) userAvatarHeader.src = avatarUrl;
    if (userAvatarHero) userAvatarHero.src = avatarUrl;

    await checkAndProcessUrlValidation(currentUser);

    const isMember = await checkIfResidentMember(currentUser.email);
    const isRAComm = await checkIfRAComm(currentUser.email);

    if (isMember || isRAComm) {
      if (onboardingSection) onboardingSection.style.display = 'none';
      if (memberDashboard) memberDashboard.style.display = 'block';
      if (applicantDashboard) applicantDashboard.style.display = 'none';

      if (roleBadgeHeader) {
        roleBadgeHeader.textContent = isRAComm ? 'RAComm Officer' : 'Resident Member';
      }

      if (racommTabNav) {
        racommTabNav.style.display = isRAComm ? 'flex' : 'none';
      }

      if (isRAComm) {
        const settings = await getGlobalSettings();
        const multText = document.getElementById('currentMultiplierText');
        const capText = document.getElementById('currentCapText');

        if (multText) multText.textContent = `${settings.multiplier}x`;
        if (capText) capText.textContent = settings.dailyCapEnabled ? 'Active (3.0 hrs/day)' : 'Disabled';

        await renderApplicantRosterTable();
      }
    } else {
      if (memberDashboard) memberDashboard.style.display = 'none';

      if (roleBadgeHeader) {
        roleBadgeHeader.textContent = 'Applicant';
      }

      const profile = await getUserProfileData(currentUser.id);

      if (!profile) {
        if (onboardingSection) onboardingSection.style.display = 'block';
        if (applicantDashboard) applicantDashboard.style.display = 'none';
      } else {
        if (onboardingSection) onboardingSection.style.display = 'none';
        if (applicantDashboard) applicantDashboard.style.display = 'block';

        const greetingElem = document.getElementById('userGreetingHeading');
        const currencyElem = document.getElementById('userCurrencyText');
        const groupNameElem = document.getElementById('buddyGroupName');

        if (greetingElem) greetingElem.textContent = `Good day, ${profile.nickname || profile.full_name || 'Applicant'}!`;
        if (currencyElem) currencyElem.textContent = profile.currency ?? 100;
        if (groupNameElem) groupNameElem.textContent = profile.buddy_group_name || 'Unassigned';

        const buddies = await getBuddyGroupMembers(profile.buddy_group_name);
        const buddyList = document.getElementById('buddyList');
        const buddyCountBadge = document.getElementById('buddyCountBadge');

        if (buddyCountBadge) buddyCountBadge.textContent = `${buddies.length} Members`;
        if (buddyList) {
          buddyList.innerHTML = '';
          if (buddies.length === 0) {
            buddyList.innerHTML = '<li class="text-muted">No group buddies assigned yet.</li>';
          } else {
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
  setupRealtimeListeners();

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

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetTabId = btn.dataset.tab;

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
        content.classList.remove('active');
      });

      const targetContent = document.getElementById(`${targetTabId}Tab`) || document.getElementById(targetTabId);
      
      if (targetContent) {
        targetContent.style.display = 'block';
        targetContent.classList.add('active');

        if (targetTabId === 'signatories' || targetTabId === 'signatoriesTab') {
          await renderSignatoriesTab(targetContent);
        }
      }
    });
  });

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

  document.getElementById('closeModalBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('manualCodeModal');
    if (modal) modal.style.display = 'none';
  });

  document.getElementById('submitManualCodeBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('manualCodeInput');
    if (!input || !currentUser) return;

    const cleanInput = input.value.trim().toUpperCase();
    if (cleanInput.length < 6) {
      showToast('Please enter a valid 6-character code.', 'error');
      return;
    }

    const res = await verifyUniversalCode(cleanInput, currentUser.email);
    
    const modal = document.getElementById('manualCodeModal');
    if (modal) modal.style.display = 'none';

    showToast(res.message, res.success ? 'success' : 'error');
    await handleAuthState();
  });

  document.getElementById('showQrBtn')?.addEventListener('click', async () => {
    if (!currentUser) return;

    const qrContainer = document.getElementById('qrDisplayContainer');
    const qrCanvas = document.getElementById('qrcodeCanvas');
    const codeText = document.getElementById('applicantShortCodeText');

    if (qrContainer) {
      if (codeText) codeText.textContent = '...';

      const shortCode = await generateApplicantShortCode(null, 'TAMBAY');
      if (codeText) codeText.textContent = shortCode || 'ERROR';

      const baseUrl = window.location.origin + window.location.pathname;
      const validationUrl = `${baseUrl}?verifyCode=${shortCode}`;

      if (qrCanvas) {
        qrCanvas.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(validationUrl)}" alt="Tambay QR" style="width:180px; height:180px; margin: 0 auto; display:block;" />`;
      }

      qrContainer.style.display = 'block';
    }
  });

  document.getElementById('closeQrBtn')?.addEventListener('click', () => {
    const qrContainer = document.getElementById('qrDisplayContainer');
    if (qrContainer) qrContainer.style.display = 'none';
  });

  document.getElementById('buyDeadlineBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(30, 'Deadline Extension (+2 Days)')) {
      showToast('Redeemed Deadline Extension (+2 Days).', 'success');
      await handleAuthState();
    }
  });

  document.getElementById('buyTaskSwapBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(50, 'Signatory Task Swap')) {
      showToast('Redeemed Signatory Task Swap.', 'success');
      await handleAuthState();
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
      showToast('Double Hours Activated! (2.0x)', 'success');
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
      showToast('Daily Cap Removed!', 'success');
      await handleAuthState();
    }
  });

  document.getElementById('addEventBtn')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('adminEventNameInput');
    const passkeyInput = document.getElementById('adminEventPasskeyInput');
    if (nameInput && await createEvent(nameInput.value, passkeyInput ? passkeyInput.value : '')) {
      nameInput.value = '';
      if (passkeyInput) passkeyInput.value = '';
      showToast('Event created successfully.', 'success');
      await handleAuthState();
    }
  });

  document.getElementById('applicantRosterTbody')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('inspect-app-btn')) {
      const appId = e.target.dataset.id;
      await openApplicantInspectionModal(appId);
    }
  });

  document.getElementById('closeInspectModalBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('adminInspectionModal');
    if (modal) modal.style.display = 'none';
  });

  document.getElementById('inspectSignatoriesList')?.addEventListener('change', async (e) => {
    if (e.target.classList.contains('admin-sig-toggle')) {
      const taskId = e.target.dataset.sigId;
      const currentStatus = !e.target.checked;
      await adminToggleApplicantSignatory(taskId, currentStatus);
      showToast('Applicant signatory updated by admin.', 'success');
      await renderApplicantRosterTable();
    }
  });

  document.getElementById('adminAddHoursBtn')?.addEventListener('click', async () => {
    if (!currentInspectedApplicantId) return;
    const input = prompt('Enter hours to add (e.g. 1.5) or deduct (e.g. -1.0):');
    if (input && !isNaN(input)) {
      await adminAdjustTambayHours(currentInspectedApplicantId, parseFloat(input));
      showToast('Hours adjusted successfully.', 'success');
      await openApplicantInspectionModal(currentInspectedApplicantId);
      await renderApplicantRosterTable();
    }
  });

  document.getElementById('adminEditTokensBtn')?.addEventListener('click', async () => {
    if (!currentInspectedApplicantId) return;
    const input = prompt('Enter new GEOP Token balance:');
    if (input && !isNaN(input)) {
      await adminAdjustTokens(currentInspectedApplicantId, parseInt(input, 10));
      showToast('Token balance updated.', 'success');
      await openApplicantInspectionModal(currentInspectedApplicantId);
    }
  });

  document.getElementById('adminDeleteApplicantBtn')?.addEventListener('click', async () => {
    if (!currentInspectedApplicantId) return;
    if (confirm('Are you sure you want to permanently delete this applicant profile?')) {
      await deleteApplicantProfile(currentInspectedApplicantId);
      const modal = document.getElementById('adminInspectionModal');
      if (modal) modal.style.display = 'none';
      showToast('Applicant profile removed.', 'info');
      await renderApplicantRosterTable();
    }
  });

  document.getElementById('onboardingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullNameInput = document.getElementById('onboardFullName');
    const nicknameInput = document.getElementById('onboardNickname');

    if (currentUser && fullNameInput && nicknameInput) {
      const created = await createApplicantProfile(currentUser.id, fullNameInput.value, nicknameInput.value);
      if (created) {
        showToast('Profile created successfully.', 'success');
        await handleAuthState();
      }
    }
  });

  document.getElementById('loginGoogleBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);
});
