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
  getGlobalSettings,
  updateGlobalSettings,
  getAllApplicantsProgress,
  getApplicantFullDetails,
  deleteApplicantProfile,
  adminAdjustTambayHours,
  adminAdjustTokens,
  adminToggleApplicantSignatory,
  spendCurrency,
  getBuddyGroupMembers,
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  getAvailabilitySlots,
  toggleUserAvailabilitySlot,
  getBiddingState,
  getBuddyFams,
  getTopBidsForFam,
  getAvailableAC,
  placeBid,
  adminUpdateBiddingState,
  adminResolveBidding
} from './storage.js';

import { renderSignatoriesTab } from './signatories.js';
import { getEvents, checkInToEvent, createEvent, generateGoogleCalendarUrl } from './events.js';
import { signInWithGoogle, signOutUser, getCurrentUser, getUserProfileData, createApplicantProfile } from './auth.js';

let currentUser = null;
let timerInterval = null;
let inspectedApplicantId = null;
let currentMonday = getMonday(new Date());

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
  toast.innerHTML = `<span>${message}</span><button style="background:none; border:none; font-size:1.1rem; cursor:pointer;">&times;</button>`;
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
  const map = {};
  const userSlots = new Set();

  allSlots.forEach(s => {
    if (!map[s.time_slot]) map[s.time_slot] = [];
    map[s.time_slot].push(s.user_name || 'User');
    if (s.user_id === currentUser.id) userSlots.add(s.time_slot);
  });

  tbody.innerHTML = times.map(time => {
    let row = `<tr><td style="font-weight:600; background:var(--surface-subtle);">${time}</td>`;
    dates.forEach(d => {
      const key = `${formatDate(d)}-${time}`;
      const people = map[key] || [];
      const count = people.length;
      const isMine = userSlots.has(key);
      const intensity = Math.min(count * 25, 100);
      const bg = count > 0 ? `hsl(123, 45%, ${85 - (intensity * 0.4)}%)` : 'transparent';

      row += `
        <td class="w2m-cell" data-slot="${key}" data-mine="${isMine}" style="background-color: ${bg}; cursor:pointer; text-align:center; padding:4px;" title="${people.join(', ')}">
          <small style="font-weight:${isMine ? '700' : 'normal'}; font-size:0.75rem;">${count > 0 ? `${count} free` : ''}</small>
        </td>
      `;
    });
    return row + '</tr>';
  }).join('');
}

async function renderBidding() {
  const container = document.getElementById('biddingFamiliesContainer');
  const banner = document.getElementById('biddingStatusBanner');
  if (!container || !currentUser) return;

  const state = await getBiddingState();
  if (banner) banner.style.display = state.is_active ? 'none' : 'flex';
  container.style.opacity = state.is_active ? '1' : '0.6';
  container.style.pointerEvents = state.is_active ? 'auto' : 'none';

  const { totalAC, availableAC } = await getAvailableAC(currentUser.id);
  const availElem = document.getElementById('biddingAvailableAC');
  if (availElem) availElem.textContent = availableAC;

  const families = await getBuddyFams();
  container.innerHTML = '';

  for (const f of families) {
    const top = await getTopBidsForFam(f.id);
    const topStr = top.length ? top.map((b, i) => `#${i + 1}: ${b.amount} AC`).join(', ') : 'No bids yet';

    const card = document.createElement('div');
    card.className = 'card';
    card.style.margin = '0';
    card.innerHTML = `
      <h3>${f.name}</h3>
      <p class="subtext" style="font-style:italic;">"${f.description}"</p>
      <div style="background:var(--surface-subtle); padding:8px; border-radius:4px; font-size:0.75rem; margin-bottom:10px;">
        <strong>Top Bids:</strong> ${topStr}
      </div>
      ${f.is_locked ? '<div class="badge">Round Finalized</div>' : `
        <div style="display:flex; gap:6px;">
          <input type="number" id="bid-in-${f.id}" placeholder="Bid AC" style="flex:1; min-height:36px;" />
          <button class="btn btn-checkin bid-submit-btn" data-id="${f.id}" style="min-height:36px; padding:4px 12px; font-size:0.8rem;">Bid</button>
        </div>
      `}
    `;
    container.appendChild(card);
  }
}

async function renderDashboard() {
  const signatories = await getSignatories();
  const tambayHours = await getTambayHours();
  const events = await getEvents();

  const totalSigs = signatories.length || 18;
  const completedSigs = signatories.filter(s => s.completed).length;
  const sigRatio = totalSigs > 0 ? (completedSigs / totalSigs) : 0;
  const tambayRatio = Math.min(tambayHours / CONFIG.TARGET_TAMBAY_HOURS, 1);
  const attendedEvents = events.filter(e => e.attended).length;
  const eventRatio = events.length > 0 ? (attendedEvents / events.length) : 0;

  const totalPercent = Math.round(
    (sigRatio * CONFIG.WEIGHTS.SIGNATORIES +
     tambayRatio * CONFIG.WEIGHTS.TAMBAY +
     eventRatio * CONFIG.WEIGHTS.EVENTS) * 100
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
  if (tambayBadge) tambayBadge.textContent = `${tambayHours.toFixed(1)} / ${CONFIG.TARGET_TAMBAY_HOURS} hrs`;

  const eventBadge = document.getElementById('eventBadge');
  if (eventBadge) eventBadge.textContent = `${attendedEvents} Attended`;

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
      <li class="task-item" style="flex-wrap: wrap; gap: 8px;">
        <div>
          <strong>${evt.name}</strong>
          <div><small style="color:var(--text-muted);">${evt.attended ? 'Status: Attended' : 'Status: Pending'}</small></div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <a href="${generateGoogleCalendarUrl(evt.name)}" target="_blank" class="btn btn-secondary" style="min-height:36px; padding:4px 8px; font-size:0.75rem;">📅 Google Calendar</a>
          ${!evt.attended ? `
            <input type="text" id="pass-${evt.id}" placeholder="Passcode" style="width:90px; min-height:36px; padding:4px 8px; font-size:0.8rem;" />
            <button class="btn btn-checkin event-checkin-btn" data-id="${evt.id}" style="min-height:36px; padding:4px 10px; font-size:0.8rem;">Check In</button>
          ` : '<span class="badge" style="background:var(--brand-mint); color:white;">Attended</span>'}
        </div>
      </li>
    `).join('');
  }
}

async function renderRoster() {
  const tbody = document.getElementById('applicantRosterTbody');
  if (!tbody) return;

  const applicants = await getAllApplicantsProgress();
  if (applicants.length === 0) {
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
      <td><button class="btn btn-secondary inspect-btn" data-id="${app.id}" style="min-height:32px; padding:2px 8px; font-size:0.75rem;">Inspect</button></td>
    </tr>
  `).join('');
}

async function openInspection(appId) {
  inspectedApplicantId = appId;
  const modal = document.getElementById('adminInspectionModal');
  const details = await getApplicantFullDetails(appId);
  if (!details || !modal) return;

  document.getElementById('inspectApplicantName').textContent = `${details.profile.full_name} ("${details.profile.nickname}")`;
  document.getElementById('inspectApplicantEmail').textContent = `ID: ${details.profile.id} | Balance: ${details.profile.currency} AC`;

  const sigList = document.getElementById('inspectSignatoriesList');
  sigList.innerHTML = (details.signatories || []).map(s => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid var(--border-subtle); font-size:0.8rem;">
      <span>[${s.committee_name}] ${s.task}</span>
      <input type="checkbox" class="admin-sig-check" data-id="${s.id}" ${s.completed ? 'checked' : ''} />
    </div>
  `).join('');

  const logList = document.getElementById('inspectTambayLogsList');
  logList.innerHTML = (details.tambayLogs || []).map(l => `
    <div style="font-size:0.78rem; padding:2px 0;">+${l.hours} hrs on ${new Date(l.created_at).toLocaleString()}</div>
  `).join('') || '<small class="subtext">No logs recorded.</small>';

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

    // Scan-to-link QR verification handler
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

      if (isRAComm) {
        const settings = await getGlobalSettings();
        const multText = document.getElementById('currentMultiplierText');
        const capText = document.getElementById('currentCapText');
        if (multText) multText.textContent = `${settings.multiplier}x`;
        if (capText) capText.textContent = settings.dailyCapEnabled ? 'Active' : 'Disabled';
        await renderRoster();
      }
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
        const group = document.getElementById('buddyGroupName');

        if (greeting) greeting.textContent = `Good day, ${profile.nickname || profile.full_name}!`;
        if (curr) curr.textContent = profile.currency ?? 100;
        if (group) group.textContent = profile.buddy_group_name || 'Unassigned';

        const buddies = await getBuddyGroupMembers(profile.buddy_group_name);
        const buddyList = document.getElementById('buddyList');
        const countBadge = document.getElementById('buddyCountBadge');

        if (countBadge) countBadge.textContent = `${buddies.length} Members`;
        if (buddyList) {
          buddyList.innerHTML = buddies.map(b => `
            <li class="task-item">
              <div><strong>${b.full_name}</strong> ("${b.nickname}")</div>
              <span class="badge">Buddy</span>
            </li>
          `).join('') || '<li class="subtext">No buddies assigned yet.</li>';
        }

        await renderDashboard();
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

document.addEventListener('DOMContentLoaded', async () => {
  await handleAuth();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW Error:', err));
  }

  // Realtime Subscriptions
  if (supabase) {
    supabase.channel('app-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signatories' }, async () => {
        showToast('Signatory verified!', 'success');
        await renderDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, async () => {
        showToast('New announcement posted.', 'info');
        await renderAnnouncementsBoard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tambay_sessions' }, async () => {
        await renderDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bids' }, async () => {
        if (document.getElementById('tab-bidding')?.classList.contains('active')) await renderBidding();
      })
      .subscribe();
  }

  // Delegated Clipboard Handler
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

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
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
          await renderAnnouncementsBoard();
          await renderWhen2Meet();
        } else if (tabId === 'tab-bidding') {
          await renderBidding();
        }
      }
    });
  });

  // Universal Manual Code Validator Modal
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

  // Automated Time-In / Time-Out QR Trigger
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

  // Perks
  document.getElementById('buyDeadlineBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(30)) {
      showToast('Redeemed +2 days deadline extension.', 'success');
      await handleAuth();
    } else {
      showToast('Insufficient AC balance.', 'error');
    }
  });

  document.getElementById('buyTaskSwapBtn')?.addEventListener('click', async () => {
    if (await spendCurrency(50)) {
      showToast('Redeemed task swap perk.', 'success');
      await handleAuth();
    } else {
      showToast('Insufficient AC balance.', 'error');
    }
  });

  // Events
  document.getElementById('eventList')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('event-checkin-btn')) {
      const id = e.target.dataset.id;
      const inp = document.getElementById(`pass-${id}`);
      if (inp && await checkInToEvent(id, inp.value)) {
        showToast('Attendance recorded! +2.0 hrs credited.', 'success');
        await renderDashboard();
      } else {
        showToast('Invalid passcode.', 'error');
      }
    }
  });

  // RAComm Policies
  document.getElementById('set1xBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('hourly_multiplier', '1.0')) {
      showToast('Multiplier set to 1.0x', 'info');
      await handleAuth();
    }
  });

  document.getElementById('set2xBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('hourly_multiplier', '2.0')) {
      showToast('Multiplier set to 2.0x', 'success');
      await handleAuth();
    }
  });

  document.getElementById('enableCapBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('daily_cap_enabled', 'true')) {
      showToast('Daily cap enabled', 'info');
      await handleAuth();
    }
  });

  document.getElementById('disableCapBtn')?.addEventListener('click', async () => {
    if (await updateGlobalSettings('daily_cap_enabled', 'false')) {
      showToast('Daily cap removed', 'info');
      await handleAuth();
    }
  });

  document.getElementById('addEventBtn')?.addEventListener('click', async () => {
    const nameIn = document.getElementById('adminEventNameInput');
    const passIn = document.getElementById('adminEventPasskeyInput');
    if (nameIn && passIn && await createEvent(nameIn.value.trim(), passIn.value.trim())) {
      nameIn.value = '';
      passIn.value = '';
      showToast('Event created successfully.', 'success');
      await handleAuth();
    }
  });

  // Buddy Bidding Actions
  document.getElementById('biddingFamiliesContainer')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('bid-submit-btn')) {
      const famId = e.target.dataset.id;
      const input = document.getElementById(`bid-in-${famId}`);
      const val = parseInt(input?.value, 10);
      if (isNaN(val)) return;
      const res = await placeBid(famId, val);
      showToast(res.message, res.success ? 'success' : 'error');
      if (res.success) await renderBidding();
    }
  });

  document.getElementById('startBiddingBtn')?.addEventListener('click', async () => {
    if (await adminUpdateBiddingState(true)) {
      showToast('Bidding round opened.', 'success');
      await renderBidding();
    }
  });

  document.getElementById('stopBiddingBtn')?.addEventListener('click', async () => {
    if (await adminUpdateBiddingState(false)) {
      showToast('Bidding round paused.', 'info');
      await renderBidding();
    }
  });

  document.getElementById('finalizeWinnersBtn')?.addEventListener('click', async () => {
    if (confirm('Finalize bidding round and assign families?')) {
      if (await adminResolveBidding()) {
        showToast('Bidding round resolved and locked.', 'success');
        await handleAuth();
      }
    }
  });

  // Announcements
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

  // When2Meet Date & Cell Selection
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
    const name = currentUser.email.split('@')[0];
    await toggleUserAvailabilitySlot(currentUser.id, name, slot, isMine);
    await renderWhen2Meet();
  });

  // Roster Search
  document.getElementById('searchApplicantInput')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#applicantRosterTbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(term) ? '' : 'none';
    });
  });

  // Inspection Modal Controls
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
      await deleteApplicantProfile(inspectedApplicantId);
      document.getElementById('adminInspectionModal').style.display = 'none';
      showToast('Profile deleted.', 'info');
      await renderRoster();
    }
  });

  document.getElementById('adminExportPdfBtn')?.addEventListener('click', async () => {
    const details = await getApplicantFullDetails(inspectedApplicantId);
    if (!details) return;
    const p = details.profile;
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
        <head>
          <title>Applicant Report - ${p.full_name}</title>
          <style>
            body { font-family: sans-serif; padding: 24px; color: #2a2016; }
            h2 { color: #1b382b; border-bottom: 2px solid #b5702f; padding-bottom: 6px; }
            table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 0.85rem; }
            th, td { border: 1px solid #d8c8a8; padding: 8px; text-align: left; }
            th { background: #f3ecdd; }
          </style>
        </head>
        <body>
          <h2>UP GEOP Applicant Summary</h2>
          <p><strong>Full Name:</strong> ${p.full_name} (${p.nickname})</p>
          <p><strong>Buddy Family:</strong> ${p.buddy_group_name}</p>
          <p><strong>Available Tokens:</strong> ${p.currency} AC</p>
          <h3>Signatory Tasks</h3>
          <table>
            <thead><tr><th>Committee</th><th>Task Description</th><th>Status</th><th>Signed By</th></tr></thead>
            <tbody>
              ${(details.signatories || []).map(s => `
                <tr><td>${s.committee_name}</td><td>${s.task}</td><td>${s.completed ? 'Completed' : 'Pending'}</td><td>${s.signed_by || '-'}</td></tr>
              `).join('')}
            </tbody>
          </table>
          <script>window.onload = function() { window.print(); }<\/script>
        </body>
      </html>
    `);
    win.document.close();
  });

  // Onboarding Form
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
