import { supabase } from './storage.js';

// Allowed test bypass emails
const TEST_BYPASS_EMAILS = ['ejhayignacio889@gmail.com'];

export async function signInWithGoogle() {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) console.error('Error signing in:', error.message);
}

export async function signOutUser() {
  if (!supabase) return;
  await supabase.auth.signOut();
  window.location.reload();
}

export async function getCurrentUser() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user || null;

  if (user) {
    const email = user.email || '';
    const isUpEmail = email.endsWith('@up.edu.ph') || email.endsWith('@upd.edu.ph');
    const isBypassEmail = TEST_BYPASS_EMAILS.includes(email.toLowerCase());

    if (!isUpEmail && !isBypassEmail) {
      alert(`Access Restricted: ${email} is not a valid @up.edu.ph address.`);
      await signOutUser();
      return null;
    }
  }

  return user;
}

export async function getUserProfileData(userId) {
  if (!supabase || !userId) return null;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

export async function createApplicantProfile(userId, fullName, nickname) {
  if (!supabase || !userId) return false;
  
  const buddyGroups = ['Alpha Geods', 'Beta Mapping', 'Gamma Surveyors', 'Delta Spatial'];
  const randomGroup = buddyGroups[Math.floor(Math.random() * buddyGroups.length)];

  const { error } = await supabase
    .from('profiles')
    .insert([{
      id: userId,
      full_name: fullName,
      nickname: nickname,
      buddy_group_name: randomGroup,
      currency: 100
    }]);

  if (error) {
    console.error('Error creating profile:', error.message);
    return false;
  }
  return true;
}
