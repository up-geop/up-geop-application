export const CONFIG = {
  SUPABASE_URL: 'https://cwbrzxqmlzgedaisaour.supabase.co',
  // Note: Once you roll your keys in Supabase, update this string!
  SUPABASE_ANON_KEY: 'sb_publishable_oZ1RQOpJ4BoIAq_vDAqHWw_lOnoqFo0',
  TARGET_TAMBAY_HOURS: 10,
  WEIGHTS: {
    EVENTS: 0.25,        // 25% (5 events x 5%)
    SIGNATORIES: 0.15,   // 15%
    TAMBAY: 0.05,        // 5%
    INTERVIEW: 0.15,     // 15%
    OGT: 0.20,           // 20%
    CONSTI_QUIZ: 0.10,   // 10%
    BUDDY_TASKS: 0.10    // 10%
  },
  SHEETS: {
    // Explicitly select Column B from Traits_Pool to extract trait descriptions
    TRAITS_CSV_URL: 'https://docs.google.com/spreadsheets/d/1FOLXlBFMwV9gv2GcTmMZqfOrjU8GJNFwgwgV4a7ZBnc/gviz/tq?tqx=out:csv&sheet=Traits_Pool&tq=select%20B',
    // Tasks_Pool endpoint
    TASKS_CSV_URL: 'https://docs.google.com/spreadsheets/d/1FOLXlBFMwV9gv2GcTmMZqfOrjU8GJNFwgwgV4a7ZBnc/gviz/tq?tqx=out:csv&sheet=Tasks_Pool'
  }
};

export const OFFICIAL_EVENTS_LIST = [
  { name: "Applicants’ Orientation", weightPercent: 5 },
  { name: "Buddy Bidding", weightPercent: 5 },
  { name: "Apps Mems Bonding 1", weightPercent: 5 },
  { name: "Apps Mems Bonding 2", weightPercent: 5 },
  { name: "Apps Only Bonding", weightPercent: 5 }
];
