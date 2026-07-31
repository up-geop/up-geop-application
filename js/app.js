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
}

// Setup Supabase Realtime Subscriptions for Dynamic Live Updates
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
  const userProfileBar = document.getElementById('userProfileBar');
  const userEmailText = document.getElementById('userEmailText');

  if (currentUser) {
    if (authSection) authSection.style.display = 'none';
    if (userProfileBar) userProfileBar.style.display = 'flex';
    if (userEmailText) userEmailText.textContent = currentUser.email;

    await checkAndProcessUrlValidation(currentUser);

    const isMember = await checkIfResidentMember(currentUser.email);
    const isRAComm = await checkIfRAComm(currentUser.email);

    if (isMember || isRAComm) {
      if (onboardingSection) onboardingSection.style.display = 'none';
      if (memberDashboard) memberDashboard.style.display = 'block';
    } else {
      if (memberDashboard) memberDashboard.style.display = 'none';

      const profile = await getUserProfileData(currentUser.id);

      if (!profile) {
        if (onboardingSection) onboardingSection.style.display = 'block';
        if (applicantDashboard) applicantDashboard.style.display = 'none';
      } else {
        if (onboardingSection) onboardingSection.style.display = 'none';
        if (applicantDashboard) applicantDashboard.style.display = 'block';

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

  // Tab Navigation Listener
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetTabId = btn.dataset.tab;

      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'transparent';
        b.style.color = '#374151';
        b.style.fontWeight = '500';
      });

      btn.classList.add('active');
      btn.style.background = '#ffffff';
      btn.style.color = '#064e3b';
      btn.style.fontWeight = '700';
      btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';

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

  // Universal Verification Button inside Resident Member Hub
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

  // Tambay QR Modal for Applicants
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

  // Event Check-ins
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

  document.getElementById('loginGoogleBtn')?.addEventListener('click', signInWithGoogle);
  document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);
});
