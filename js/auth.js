import { supabase } from './storage.js';

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

  const { error } = await supabase
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

  if (error) {
    console.error('Error creating profile:', error);
    return false;
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
