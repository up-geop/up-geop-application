export const CONFIG = {
  TARGET_TAMBAY_HOURS: 10,
  WEIGHTS: {
    SIGNATORIES: 0.4, // 40%
    TAMBAY: 0.3,      // 30%
    EVENTS: 0.3       // 30%
  }
};

export const DEFAULT_SIGNATORIES = [
  { id: "sig-1", role: "Executive Board Member", task: "Play a quick card or board game", completed: false },
  { id: "sig-2", role: "Academics Committee Member", task: "Ask for course or study tips", completed: false },
  { id: "sig-3", role: "Events Committee Member", task: "Help set up or clean after an event", completed: false }
];

export const DEFAULT_EVENTS = [
  { id: "evt-101", name: "General Assembly & Orientation", passkey: "GA2026", attended: false },
  { id: "evt-102", name: "Recruitment Workshop", passkey: "WORKSHOP101", attended: false }
];