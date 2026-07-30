import { supabase } from './storage.js';

// Allowed University Domains
const ALLOWED_DOMAINS = ['up.edu.ph', 'upd.edu.ph'];

// Trigger Google OAuth Login Flow
export async function signInWithGoogle() {
  if (!supabase) return;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href
    }
  });

  if (error) {
    console.error('Error logging in with Google:', error.message);
    alert('Failed to initiate Google login. Please try again.');
  }
}

// Sign Out Current User
export async function signOutUser() {
  if (!supabase) return;

  const { error } = await supabase.auth.signOut();
  if (!error) {
    window.location.reload();
  } else {
    console.error('Error signing out:', error.message);
  }
}

// Seed default tasks for new applicants on first login
export async function initializeApplicantData(userId) {
  if (!supabase || !userId) return;

  try {
    const { data: existingSignatories } = await supabase
      .from('signatories')
      .select('id')
      .eq('user_id', userId);

    if (!existingSignatories || existingSignatories.length === 0) {
      await supabase.from('signatories').insert([
        { role: 'Executive Board Member', task: 'Get signature during EB tambay', completed: false, user_id: userId },
        { role: 'Academics Committee Member', task: 'Attend 1 acad consultation', completed: false, user_id: userId },
        { role: 'Events Committee Member', task: 'Help setup for 1 org event', completed: false, user_id: userId }
      ]);

      await supabase.from('events').insert([
        { name: 'General Assembly & Orientation', passkey: 'GA2026', attended: false, user_id: userId },
        { name: 'Recruitment Workshop', passkey: 'WORKSHOP101', attended: false, user_id: userId }
      ]);
    }
  } catch (err) {
    console.warn('Initial data seeding skipped or failed:', err.message);
  }
}

// Check if user profile exists in database
export async function getUserProfileData(userId) {
  if (!supabase || !userId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  return profile;
}

// Create new profile from inline onboarding submission
export async function createApplicantProfile(userId, fullName, nickname) {
  if (!supabase || !userId) return null;

  const { data: newProfile, error } = await supabase
    .from('profiles')
    .insert([{
      id: userId,
      full_name: fullName.trim(),
      nickname: nickname.trim(),
      currency: 100, // Starting applicant tokens
      buddy_group_name: 'Alpha Geods' // Default placeholder group
    }])
    .select()
    .single();

  if (error) {
    console.error("Error creating profile:", error.message);
    return null;
  }

  return newProfile;
}

// Retrieve Logged-in User & Enforce Domain Check
export async function getCurrentUser() {
  if (!supabase) return null;

  const { data: { session }, error } = await supabase.auth.getSession();

  if (error || !session) return null;

  const user = session.user;
  const userEmail = user.email || '';

  const isAllowedDomain = ALLOWED_DOMAINS.some(domain => userEmail.endsWith(`@${domain}`));

  if (!isAllowedDomain) {
    alert(`Access Denied: You logged in as ${userEmail}.\nOnly official @up.edu.ph or @upd.edu.ph email addresses are allowed.`);
    await supabase.auth.signOut();
    return null;
  }

  await initializeApplicantData(user.id);

  return user;
}