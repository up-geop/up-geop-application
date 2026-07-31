import { 
  getSignatories, 
  selectTaskForSignatory, 
  generateApplicantShortCode, 
  COMMITTEES_LIST,
  supabase 
} from './storage.js';

export async function renderSignatoriesTab(container) {
  const signatories = await getSignatories();

  const completedCount = signatories.filter(s => s.completed).length;
  const totalCount = signatories.length || 18;

  // Collect all tasks that have already been chosen across all cards
  const usedTasks = new Set(
    signatories
      .map(s => s.selected_task)
      .filter(t => t && t.trim().length > 0)
  );

  container.innerHTML = `
    <div class="card space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h2 class="text-2xl font-bold text-emerald-950 font-serif">Signatories Matrix</h2>
          <p class="text-sm text-gray-600">Fulfill member tasks and receive official endorsement signatures from VPs.</p>
        </div>
        <div class="bg-emerald-100 text-emerald-800 text-sm font-semibold px-4 py-2 rounded-full text-center">
          ${completedCount} / ${totalCount} Signed
        </div>
      </div>

      <!-- Committee Filter Tabs -->
      <div class="flex flex-wrap gap-2">
        <button class="comm-filter-btn active px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-800 text-white" data-filter="ALL">All (${totalCount})</button>
        ${COMMITTEES_LIST.map(c => `
          <button class="comm-filter-btn px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200" data-filter="${c.name}">
            ${c.name}
          </button>
        `).join('')}
      </div>

      <!-- Committee Accordions -->
      <div class="space-y-6" id="committeesContainer">
        ${COMMITTEES_LIST.map(comm => {
          const commSigs = signatories.filter(s => s.committee_name?.toLowerCase() === comm.name.toLowerCase());
          return renderCommitteeGroup(comm, commSigs, usedTasks);
        }).join('')}
      </div>
    </div>

    <!-- Verification Modal -->
    <div id="verifyModal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl border border-emerald-100">
        <div class="flex justify-between items-center border-b pb-2">
          <h3 class="text-lg font-bold text-gray-800 font-serif" id="modalTitle">Member Verification</h3>
          <button id="closeModalBtn" class="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
        </div>
        
        <p class="text-xs text-gray-500">Show this QR code or 6-digit verification code to the resident member or VP to get signed!</p>

        <!-- QR Code Container -->
        <div class="bg-gray-50 p-4 rounded-xl border flex flex-col items-center justify-center min-h-[180px]">
          <div id="qrcode" class="p-2 bg-white rounded-lg shadow-sm"></div>
          <p class="text-[11px] text-gray-400 mt-2">Scan with Member Scanner</p>
        </div>

        <!-- Short Code Fallback -->
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <span class="text-xs font-semibold text-emerald-800 uppercase tracking-wider block">Verification Code</span>
          <span id="modalShortCode" class="text-2xl font-mono font-bold text-emerald-950 tracking-widest">------</span>
          <span class="text-[10px] text-emerald-600 block mt-1">Expires in 10 minutes</span>
        </div>

        <button id="doneVerifyBtn" class="w-full py-2.5 bg-emerald-800 text-white text-sm font-semibold rounded-xl hover:bg-emerald-900 transition">
          Close Window
        </button>
      </div>
    </div>
  `;

  attachSignatoryEvents(container, signatories);
}

function renderCommitteeGroup(comm, sigs, usedTasks) {
  return `
    <div class="committee-card border border-gray-200 rounded-xl p-5 bg-gray-50/50 space-y-4" data-committee="${comm.name}">
      <h3 class="text-lg font-bold text-emerald-900 font-serif border-b pb-2 flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
        ${comm.name} Committee
      </h3>

      <div class="space-y-4">
        ${sigs.map((sig, idx) => renderSignatoryCard(sig, idx, usedTasks)).join('')}
      </div>
    </div>
  `;
}

function renderSignatoryCard(sig, index, usedTasks) {
  const isVP = sig.type === 'VP';
  const isCompleted = sig.completed;
  const taskPool = sig.task_pool || [];

  return `
    <div class="bg-white border ${isCompleted ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-200'} rounded-xl p-4 space-y-4 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <span class="inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded-md ${isVP ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'} mb-1">
            ${isVP ? 'VP Endorsement' : `Member Task #${index + 1}`}
          </span>
          <h4 class="text-sm font-bold text-gray-800">${sig.trait_description || sig.task}</h4>
        </div>
        <span class="px-2.5 py-1 text-xs font-semibold rounded-full ${isCompleted ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
          ${isCompleted ? '✓ Signed' : 'Pending Sign'}
        </span>
      </div>

      ${!isVP ? `
        <!-- Task Pool Selection -->
        <div class="space-y-1">
          <label class="text-xs font-semibold text-gray-600 block">Choose 1 Task from your 25-Task Pool:</label>
          <select class="task-select w-full text-xs p-2.5 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500" data-id="${sig.id}" ${isCompleted ? 'disabled' : ''}>
            <option value="">-- Select a Task --</option>
            ${taskPool.map(task => {
              const isSelectedByThisCard = sig.selected_task === task;
              const isUsedElsewhere = usedTasks.has(task) && !isSelectedByThisCard;
              
              return `
                <option value="${task}" ${isSelectedByThisCard ? 'selected' : ''} ${isUsedElsewhere ? 'disabled class="text-gray-300 bg-gray-100"' : ''}>
                  ${task} ${isUsedElsewhere ? ' (Already Claimed)' : ''}
                </option>
              `;
            }).join('')}
          </select>
        </div>
      ` : ''}

      <!-- Interactive Q&A Input Fields -->
      <div class="bg-gray-50 border border-gray-100 rounded-lg p-3 space-y-3">
        <span class="text-xs font-bold text-gray-700 flex items-center gap-1">
          <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
          Interview Details & Answers:
        </span>
        
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div>
            <label class="text-[11px] text-gray-500 block">Member/VP Name:</label>
            <input type="text" class="qa-input w-full p-2 border rounded-md" placeholder="e.g. Juan Dela Cruz" data-sig-id="${sig.id}" data-field="member_name" value="${sig.member_name || ''}" ${isCompleted ? 'disabled' : ''} />
          </div>
          <div>
            <label class="text-[11px] text-gray-500 block">Nickname:</label>
            <input type="text" class="qa-input w-full p-2 border rounded-md" placeholder="e.g. Juan" data-sig-id="${sig.id}" data-field="nickname" value="${sig.nickname || ''}" ${isCompleted ? 'disabled' : ''} />
          </div>
          <div>
            <label class="text-[11px] text-gray-500 block">Favorite Spot in UP:</label>
            <input type="text" class="qa-input w-full p-2 border rounded-md" placeholder="e.g. Sunken Garden / CS Lib" data-sig-id="${sig.id}" data-field="fav_spot" value="${sig.fav_spot || ''}" ${isCompleted ? 'disabled' : ''} />
          </div>
          <div>
            <label class="text-[11px] text-gray-500 block">Least Liked Major Sub:</label>
            <input type="text" class="qa-input w-full p-2 border rounded-md" placeholder="e.g. GE 10 / Math 21" data-sig-id="${sig.id}" data-field="least_sub" value="${sig.least_sub || ''}" ${isCompleted ? 'disabled' : ''} />
          </div>
        </div>
      </div>

      <!-- Verification / Sign Button -->
      ${!isCompleted ? `
        <button class="request-sign-btn w-full py-2.5 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition" data-id="${sig.id}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
          Request Signature (Show QR / Code)
        </button>
      ` : `
        <div class="text-[11px] text-emerald-800 bg-emerald-100/60 p-2 rounded-lg flex items-center justify-between">
          <span>Signed by: <strong>${sig.signed_by || 'Verified Member'}</strong></span>
          <span class="text-[10px] text-emerald-600">${sig.signed_at ? new Date(sig.signed_at).toLocaleDateString() : 'Verified'}</span>
        </div>
      `}
    </div>
  `;
}

function attachSignatoryEvents(container, signatories) {
  // Filter buttons
  const filterBtns = container.querySelectorAll('.comm-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active', 'bg-emerald-800', 'text-white'));
      filterBtns.forEach(b => b.classList.add('bg-gray-100', 'text-gray-700'));
      btn.classList.add('active', 'bg-emerald-800', 'text-white');

      const filter = btn.dataset.filter;
      container.querySelectorAll('.committee-card').forEach(card => {
        if (filter === 'ALL' || card.dataset.committee === filter) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    });
  });

  // Task selection dropdown - re-renders UI on selection so other dropdowns lock out claimed tasks
  container.querySelectorAll('.task-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const sigId = e.target.dataset.id;
      const selectedTask = e.target.value;
      await selectTaskForSignatory(sigId, selectedTask);
      renderSignatoriesTab(container); // Refresh UI to lock claimed tasks in other dropdowns
    });
  });

  // Save Q&A inputs
  container.querySelectorAll('.qa-input').forEach(input => {
    input.addEventListener('blur', async (e) => {
      const sigId = e.target.dataset.sigId;
      const field = e.target.dataset.field;
      const val = e.target.value.trim();

      await supabase.from('signatories').update({ [field]: val }).eq('id', sigId);
    });
  });

  // Verification Modal
  const verifyModal = container.querySelector('#verifyModal');
  const closeModalBtn = container.querySelector('#closeModalBtn');
  const doneVerifyBtn = container.querySelector('#doneVerifyBtn');
  const modalShortCode = container.querySelector('#modalShortCode');

  container.querySelectorAll('.request-sign-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sigCard = e.target.closest('.bg-white');
      const selectElem = sigCard?.querySelector('.task-select');

      // Validation: Check if task was selected before allowing signature request
      if (selectElem && !selectElem.value) {
        alert('Please choose 1 task from your dropdown pool before requesting a signature!');
        return;
      }

      const code = await generateApplicantShortCode();
      if (!code) {
        alert('Error generating verification code.');
        return;
      }

      modalShortCode.textContent = code;

      const qrContainer = container.querySelector('#qrcode');
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(code)}" alt="Verification QR Code" class="w-36 h-36" />`;

      verifyModal.classList.remove('hidden');
    });
  });

  closeModalBtn?.addEventListener('click', () => verifyModal.classList.add('hidden'));
  doneVerifyBtn?.addEventListener('click', () => verifyModal.classList.add('hidden'));
}
