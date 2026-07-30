import { CONFIG } from './config.js';
import { 
  getStoredData, supabase, getBuddyGroupMembers, spendCurrency,
  getActiveTambaySession, validateApplicantTambay 
} from './storage.js';
import { getSignatories, toggleSignatoryTask } from './signatories.js';
import { getTambayHours, resetTambayHours } from './tambay.js';
import { getEvents, checkInToEvent } from './events.js';
import { switchRole, handleAddSignatoryRequirement, handleCreateEvent } from './admin.js';
import { signInWithGoogle, signOutUser, getCurrentUser, getUserProfileData, createApplicantProfile } from './auth.js';

let currentUser = null;
let timerInterval = null;

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

export async function render() {
  const { userRole } = getStoredData();
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
    stats.signatoriesList.forEach(item => {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.innerHTML = `
        <div class="task-info">
          <strong>${item.role}</strong>
          <small>Task: ${item.task}</small>
        </div>
        <input 
          type="checkbox" 
          ${item.completed ? 'checked' : ''} 
          data-id="${item.id}" 
          data-completed="${item.completed}"
          class="sig-checkbox" 
        />
      `;
      sigList.appendChild(li);
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

  const adminPanel = document.getElementById('adminPanel');
  if (adminPanel) {
    adminPanel.style.display = userRole === 'admin' ? 'block' : 'none';
  }
}

async function checkAndProcessUrlValidation(user) {
  const urlParams = new URLSearchParams(window.location.search);
  const validateApplicantId = urlParams.get('validateApplicant');

  if (validateApplicantId && user) {
    window.history.replaceState({}, document.title, window.location.pathname);
    const result = await validateApplicantTambay(validateApplicantId, user.email);
    alert(result.message);
  }
}

async function handleAuthState() {
  currentUser = await getCurrentUser();

  const authSection = document.getElementById('authSection');
  const onboardingSection = document.getElementById('onboardingSection');
  const dashboardContent = document.getElementById('dashboardContent');
  const userProfileBar = document.getElementById('userProfileBar');
  const userEmailText = document.getElementById('userEmailText');

  if (currentUser) {
    if (authSection) authSection.style.display = 'none';
    if (userProfileBar) userProfileBar.style.display = 'flex';
    if (userEmailText) userEmailText.textContent = currentUser.email;

    await checkAndProcessUrlValidation(currentUser);

    const profile = await getUserProfileData(currentUser.id);

    if (!profile) {
      if (onboardingSection) onboardingSection.style.display = 'block';
      if (dashboardContent) dashboardContent.style.display = 'none';
    } else {
      if (onboardingSection) onboardingSection.style.display = 'none';
      if (dashboardContent) dashboardContent.style.display = 'block';

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
  } else {
    if (authSection) authSection.style.display = 'block';
    if (onboardingSection) onboardingSection.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'none';
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

  document.getElementById('showQrBtn')?.addEventListener('click', () => {
    if (!currentUser) return;

    const qrContainer = document.getElementById('qrDisplayContainer');
    const qrCanvas = document.getElementById('qrcodeCanvas');

    if (qrContainer && qrCanvas) {
      qrCanvas.innerHTML = '';

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

  document.getElementById('onboardingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullNameInput = document.getElementById('onboardFullName');
    const nicknameInput = document.getElementById('onboardNickname');

    if (currentUser && fullNameInput && nicknameInput) {
      const created = await createApplicantProfile(currentUser.id, fullNameInput.value, nicknameInput.value);
      if (created) {
        await handleAuthState();
      }
    }
  });

  document.getElementById('loginGoogleBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);

  document.getElementById('buyDeadlineBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(30, 'Deadline Extension (+2 Days)')) {
      await handleAuthState();
    }
  });

  document.getElementById('buyTaskSwapBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(50, 'Signatory Task Swap')) {
      await handleAuthState();
    }
  });

  document.getElementById('resetHoursBtn')?.addEventListener('click', async () => {
    await resetTambayHours();
    await render();
  });

  document.getElementById('signatoryList')?.addEventListener('change', async (e) => {
    if (e.target.classList.contains('sig-checkbox')) {
      const taskId = e.target.dataset.id;
      const currentStatus = e.target.dataset.completed === 'true';
      await toggleSignatoryTask(taskId, currentStatus);
      await render();
    }
  });

  document.getElementById('eventList')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-checkin')) {
      const eventId = e.target.dataset.eventId;
      const passInput = document.getElementById(`pass-${eventId}`);
      if (passInput && await checkInToEvent(eventId, passInput.value)) {
        await render();
      }
    }
  });

  document.getElementById('addRequirementBtn')?.addEventListener('click', async () => {
    const roleInput = document.getElementById('adminRoleInput');
    const taskInput = document.getElementById('adminTaskInput');
    if (roleInput && taskInput && await handleAddSignatoryRequirement(roleInput.value, taskInput.value)) {
      roleInput.value = '';
      taskInput.value = '';
      await render();
    }
  });

  document.getElementById('addEventBtn')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('adminEventNameInput');
    const passkeyInput = document.getElementById('adminEventPasskeyInput');
    if (nameInput && await handleCreateEvent(nameInput.value, passkeyInput ? passkeyInput.value : '')) {
      nameInput.value = '';
      if (passkeyInput) passkeyInput.value = '';
      await render();
    }
  });

  document.getElementById('btnRoleApplicant')?.addEventListener('click', async () => {
    switchRole('applicant');
    await render();
  });

  document.getElementById('btnRoleAdmin')?.addEventListener('click', async () => {
    switchRole('admin');
    await render();
  });
});