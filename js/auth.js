import { supabase, getAvailableTraitsPool } from './storage.js';

export async function getCurrentUser() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

export async function getUserProfileData(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
  return data;
}

export async function createApplicantProfile(userId, fullName, nickname) {
  if (!supabase || !userId) return false;

  // 1. Create the base profile
  const { error: profileErr } = await supabase
    .from('profiles')
    .insert([
      {
        id: userId,
        full_name: fullName.trim(),
        nickname: nickname.trim(),
        buddy_group_name: 'Unassigned',
        currency: 100
      }
    ]);

  if (profileErr) {
    console.error('Error creating profile:', profileErr);
    return false;
  }

  // 2. Fetch and shuffle the Traits Pool
  const traitsPool = await getAvailableTraitsPool();
  let shuffledTraits = [...traitsPool].sort(() => 0.5 - Math.random());
  
  // Fallback just in case the Google Sheet fails to load
  if (shuffledTraits.length < 12) {
     const filler = Array(12).fill('Unique Member Trait');
     shuffledTraits = [...shuffledTraits, ...filler];
  }

  let traitIdx = 0;
  const sigsToInsert = [];

  // 3. Generate the 3 PES Slots
  const pesRoles = ['President', 'Executive Vice President', 'Secretary-General'];
  pesRoles.forEach(r => {
     sigsToInsert.push({ user_id: userId, role: 'PES', type: 'PES', committee_name: 'PES', task: r, trait: r });
  });

  // 4. Generate the 6 VPs and 12 Member Slots
  const comms = [
    { name: 'Academics', vp: 'Vice President for Academic Affairs' },
    { name: 'Publicity', vp: 'Vice President for Publicity' },
    { name: 'RAComm', vp: 'Vice President for Recruitment and Applications' },
    { name: 'Internal', vp: 'Vice President for Internal Affairs' },
    { name: 'External', vp: 'Vice President for External Affairs' },
    { name: 'Finance', vp: 'Vice President for Finance' }
  ];

  comms.forEach(c => {
     // 1 VP per committee
     sigsToInsert.push({ user_id: userId, role: 'VP', type: 'VP', committee_name: c.name, task: c.vp, trait: c.vp });
     // 2 Members per committee with unique traits
     sigsToInsert.push({ user_id: userId, role: 'Member', type: 'Member', committee_name: c.name, task: 'Committee Member', trait: shuffledTraits[traitIdx++] });
     sigsToInsert.push({ user_id: userId, role: 'Member', type: 'Member', committee_name: c.name, task: 'Committee Member', trait: shuffledTraits[traitIdx++] });
  });

  // 5. Insert all 21 slots into the database
  const { error: sigErr } = await supabase.from('signatories').insert(sigsToInsert);
  if (sigErr) {
    console.error('Error creating signatories:', sigErr);
  }

  return true;
}

export async function signInWithGoogle() {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) console.error('Sign-in error:', error);
}

export async function signOutUser() {
  if (!supabase) return;
  await supabase.auth.signOut();
  window.location.reload();
}
